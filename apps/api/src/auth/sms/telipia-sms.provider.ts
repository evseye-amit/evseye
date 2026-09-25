import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import type { Environment } from '../../config/environment.js';
import { normalizeIndianMobile } from '../../common/phone.js';
import type { SendSmsInput, SmsProvider } from './sms-provider.interface.js';

/** Telipia's HTTP API adapter. No credentials, request URLs, or OTPs are logged. */
@Injectable()
export class TelipiaSmsProvider implements SmsProvider {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async send(input: SendSmsInput): Promise<void> {
    const templateId = input.purpose === OtpPurpose.LOGIN
      ? this.config.getOrThrow('TELIPIA_LOGIN_TEMPLATE_ID')
      : this.config.get('TELIPIA_DEALLOCATION_TEMPLATE_ID');
    if (!templateId) throw new ServiceUnavailableException('SMS delivery is not configured for this purpose.');
    const message = input.purpose === OtpPurpose.LOGIN
      ? `One Time Password (OTP) for your login is ${input.code}. Please enter it to proceed with the process. EV SPARES INDIA PRIVATE LIMITED`
      : `Your EVs Eye deallocation code is ${input.code}.`;

    const mobile = normalizeIndianMobile(input.phone).slice(3);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      throw new ServiceUnavailableException('SMS destination is invalid.');
    }
    const url = new URL(this.config.getOrThrow('TELIPIA_API_URL'));
    url.searchParams.set('username', this.config.getOrThrow('TELIPIA_USERNAME'));
    url.searchParams.set('apikey', this.config.getOrThrow('TELIPIA_API_KEY'));
    url.searchParams.set('apirequest', 'Text');
    url.searchParams.set('sender', this.config.getOrThrow('TELIPIA_SENDER'));
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('message', message);
    url.searchParams.set('route', this.config.getOrThrow('TELIPIA_ROUTE'));
    url.searchParams.set('TemplateID', templateId);
    url.searchParams.set('format', 'JSON');

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('SMS gateway HTTP error');
      const body = await response.text();
      if (isExplicitFailure(body)) throw new Error('SMS gateway rejected request');
    } catch {
      // Never include the provider response or URL: either may contain an OTP or key.
      throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.');
    }
  }
}

function isExplicitFailure(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/^(error|failed|failure|invalid|unauthorized)\b/i.test(trimmed)) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return false;
    const result = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), value]));
    if (result.success === false || result.status === false) return true;
    if (typeof result.status === 'string' && /^(error|failed|failure|invalid)$/i.test(result.status)) return true;
    if (result.error || result.errors) return true;
    return false;
  } catch {
    return false;
  }
}
