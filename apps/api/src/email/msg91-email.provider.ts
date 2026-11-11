import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import type { EmailProvider, WelcomeEmailInput } from './email-provider.interface.js';

@Injectable()
export class Msg91EmailProvider implements EmailProvider {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('MSG91_AUTH_KEY') &&
      this.config.get('MSG91_EMAIL_DOMAIN') &&
      this.config.get('MSG91_EMAIL_FROM') &&
      this.config.get('MSG91_WELCOME_TEMPLATE_ID'),
    );
  }

  async sendWelcome(input: WelcomeEmailInput): Promise<void> {
    if (!this.isConfigured()) throw new Error('Email provider is not configured.');
    const response = await fetch('https://control.msg91.com/api/v5/email/send', {
      method: 'POST',
      headers: {
        authkey: this.config.getOrThrow('MSG91_AUTH_KEY'),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        recipients: [{
          to: [{ email: input.recipientEmail, name: input.recipientName }],
          variables: {
            client_name: input.recipientName,
            company_name: input.companyName,
            company_code: input.companyCode,
            registered_mobile_number: input.registeredMobileNumber,
            login_url: input.loginUrl,
          },
        }],
        from: { email: this.config.getOrThrow('MSG91_EMAIL_FROM') },
        domain: this.config.getOrThrow('MSG91_EMAIL_DOMAIN'),
        template_id: this.config.getOrThrow('MSG91_WELCOME_TEMPLATE_ID'),
      }),
    });
    if (!response.ok) throw new Error('Email provider rejected the request.');
    const body = await response.text();
    if (isExplicitFailure(body)) throw new Error('Email provider rejected the request.');
  }
}

function isExplicitFailure(body: string): boolean {
  const trimmed = body.trim();
  if (/^(error|fail|failed|failure|invalid)\b/i.test(trimmed)) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return false;
    const fields = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), value]));
    if (fields.success === false || fields.haserror === true || fields.error || fields.errors) return true;
    return ['status', 'type'].some((key) => typeof fields[key] === 'string' && /^(error|fail|failed|failure|invalid)$/i.test(fields[key]));
  } catch {
    return false;
  }
}
