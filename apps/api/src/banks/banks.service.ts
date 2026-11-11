import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

const IFSC_PROVIDER_URL = 'https://ifsc.razorpay.com';
export const IFSC_REQUEST_TIMEOUT_MS = 5_000;
export const BANK_CACHE_TTL_MS = 5 * 60_000;
export const BANK_CACHE_MAX_ENTRIES = 256;
const MAX_PROVIDER_RESPONSE_CHARS = 16 * 1024;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type IfscBankDetails = {
  ifsc: string;
  bankName: string | null;
  branch: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  micr: string | null;
};

type CacheEntry = {
  value: IfscBankDetails;
  expiresAt: number;
};

function normalizeIfsc(value: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Invalid IFSC code.');
  }
  const normalized = value.trim().toUpperCase();
  if (!IFSC_PATTERN.test(normalized)) {
    throw new BadRequestException('Invalid IFSC code.');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  if (!Object.hasOwn(payload, key)) {
    throw new BadGatewayException('IFSC provider returned an invalid response.');
  }
  const value = payload[key];
  if (value !== null && typeof value !== 'string') {
    throw new BadGatewayException('IFSC provider returned an invalid response.');
  }
  return value === null ? null : value;
}

function parseProviderResponse(
  payload: unknown,
  expectedIfsc: string,
): IfscBankDetails {
  if (!isRecord(payload)) {
    throw new BadGatewayException('IFSC provider returned an invalid response.');
  }

  const providerIfsc = payload.IFSC;
  if (typeof providerIfsc !== 'string' || providerIfsc.trim().toUpperCase() !== expectedIfsc) {
    throw new BadGatewayException('IFSC provider returned an invalid response.');
  }

  return {
    ifsc: expectedIfsc,
    bankName: nullableString(payload, 'BANK'),
    branch: nullableString(payload, 'BRANCH'),
    address: nullableString(payload, 'ADDRESS'),
    city: nullableString(payload, 'CITY'),
    district: nullableString(payload, 'DISTRICT'),
    state: nullableString(payload, 'STATE'),
    micr: Object.hasOwn(payload, 'MICR') ? nullableString(payload, 'MICR') : null,
  };
}

@Injectable()
export class IfscBankService {
  private readonly cache = new Map<string, CacheEntry>();

  async lookup(value: string): Promise<IfscBankDetails> {
    const ifsc = normalizeIfsc(value);
    const cached = this.cached(ifsc);
    if (cached) return cached;

    const details = await this.fetchDetails(ifsc);
    this.store(ifsc, details);
    return details;
  }

  private cached(ifsc: string): IfscBankDetails | undefined {
    const entry = this.cache.get(ifsc);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(ifsc);
      return undefined;
    }
    return entry.value;
  }

  private store(ifsc: string, value: IfscBankDetails): void {
    this.cache.delete(ifsc);
    this.cache.set(ifsc, { value, expiresAt: Date.now() + BANK_CACHE_TTL_MS });
    while (this.cache.size > BANK_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }

  private async fetchDetails(ifsc: string): Promise<IfscBankDetails> {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('IFSC_PROVIDER_TIMEOUT'));
      }, IFSC_REQUEST_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([
        fetch(`${IFSC_PROVIDER_URL}/${ifsc}`, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (response.status === 404) {
        throw new NotFoundException('Bank details not found for this IFSC code.');
      }
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new ServiceUnavailableException(
            'IFSC provider is temporarily unavailable.',
          );
        }
        throw new BadGatewayException('IFSC provider rejected the request.');
      }

      const declaredLength = Number(
        response.headers?.get?.('content-length'),
      );
      if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_CHARS) {
        throw new BadGatewayException('IFSC provider returned an invalid response.');
      }
      const raw = await Promise.race([response.text(), timeout]);
      if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) {
        throw new BadGatewayException('IFSC provider returned an invalid response.');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        throw new BadGatewayException('IFSC provider returned an invalid response.');
      }
      return parseProviderResponse(payload, ifsc);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        throw new ServiceUnavailableException('IFSC provider timed out.');
      }
      throw new ServiceUnavailableException('IFSC provider is temporarily unavailable.');
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}
