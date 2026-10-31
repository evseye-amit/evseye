import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SendSmsInput, SmsProvider } from './sms-provider.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class FailoverSmsProvider implements SmsProvider {
  constructor(private readonly primary: SmsProvider, private readonly fallback?: SmsProvider, private readonly prisma?: PrismaService, private readonly providers: Record<string, SmsProvider> = {}) {}

  async send(input: SendSmsInput): Promise<void> {
    let primary = this.primary;
    let fallback = this.fallback;
    const policy = await this.prisma?.smsProviderPolicy.findUnique({ where: { id: 'default' } }).catch(() => null);
    if (policy) { primary = this.providers[policy.primaryProvider] ?? primary; fallback = policy.fallbackProvider ? this.providers[policy.fallbackProvider] : undefined; }
    try { await primary.send(input); return; } catch (primaryError) {
      if (!fallback) throw primaryError;
      try { await fallback.send(input); } catch { throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.'); }
    }
  }
}
