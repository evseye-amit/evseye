import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';

const BASE_URL = 'https://test-api.sandbox.co.in';

export class SandboxHttpError extends Error {
  constructor(readonly category: string, readonly status?: number) {
    super(category);
  }
}

@Injectable()
export class SandboxHttpService {
  private token?: { value: string; expiresAt: number };
  private authPromise?: Promise<string>;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  circuitOpen() { return this.openUntil > Date.now(); }

  private credentials() {
    if (!this.config.get('KYC_ENABLED') || this.config.get('KYC_SANDBOX_ENVIRONMENT') !== 'TEST')
      throw new ServiceUnavailableException('KYC_FEATURE_NOT_ENABLED');
    const key = this.config.get('KYC_SANDBOX_API_KEY');
    const secret = this.config.get('KYC_SANDBOX_API_SECRET');
    if (!key || !secret) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    return { key, secret };
  }

  private async authenticate(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.authPromise) return this.authPromise;
    this.authPromise = (async () => {
      const { key, secret } = this.credentials();
      const response = await fetch(`${BASE_URL}/authenticate`, {
        method: 'POST', headers: { 'x-api-key': key, 'x-api-secret': secret }, signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new SandboxHttpError('AUTHENTICATION_FAILED', response.status);
      const body: unknown = await this.jsonBounded(response, 16384);
      if (!isRecord(body) || !isRecord(body.data) || typeof body.data.access_token !== 'string')
        throw new SandboxHttpError('PROVIDER_ERROR');
      this.token = { value: body.data.access_token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
      return this.token.value;
    })();
    try { return await this.authPromise; } finally { this.authPromise = undefined; }
  }

  async request(path: string, method: 'GET' | 'POST', body?: Record<string, string>, timeoutMs = 10000, allowAuthRefresh = true): Promise<unknown> {
    if (this.openUntil > Date.now()) throw new SandboxHttpError('PROVIDER_UNAVAILABLE');
    const { key } = this.credentials();
    try {
      const token = await this.authenticate();
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: token, 'x-api-key': key, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1000), 30000)),
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 401) {
          this.token = undefined;
          if (allowAuthRefresh) return this.request(path, method, body, timeoutMs, false);
        }
        const category = response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED' : path.endsWith('/otp/verify') ? 'OTP_FAILED' : 'DOCUMENT_INVALID';
        throw new SandboxHttpError(category, response.status);
      }
      const result: unknown = await this.jsonBounded(response, 65536);
      if (isRecord(result) && typeof result.code === 'number' && result.code >= 400)
        throw new SandboxHttpError(result.code === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR', result.code);
      this.consecutiveFailures = 0;
      return result;
    } catch (error) {
      const normalized = error instanceof SandboxHttpError ? error : new SandboxHttpError(error instanceof Error && error.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE');
      if (['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'].includes(normalized.category)) {
        if (++this.consecutiveFailures >= 3) this.openUntil = Date.now() + 30000;
      }
      throw normalized;
    }
  }

  async health(): Promise<'AVAILABLE' | 'UNAVAILABLE'> {
    if (this.openUntil > Date.now()) return 'UNAVAILABLE';
    try { await this.authenticate(); return 'AVAILABLE'; } catch { return 'UNAVAILABLE'; }
  }

  private async jsonBounded(response: Response, maxChars: number): Promise<unknown> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxChars) throw new SandboxHttpError('MALFORMED_RESPONSE');
    const raw = await response.text();
    if (raw.length > maxChars) throw new SandboxHttpError('MALFORMED_RESPONSE');
    try { return JSON.parse(raw) as unknown; } catch { throw new SandboxHttpError('MALFORMED_RESPONSE'); }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
