import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SendSmsInput, SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class FailoverSmsProvider implements SmsProvider {
  constructor(private readonly primary: SmsProvider, private readonly fallback?: SmsProvider) {}

  async send(input: SendSmsInput): Promise<void> {
    try { await this.primary.send(input); return; } catch (primaryError) {
      if (!this.fallback) throw primaryError;
      try { await this.fallback.send(input); } catch { throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.'); }
    }
  }
}
