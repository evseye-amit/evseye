import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SmsProvider, SendSmsInput } from './sms-provider.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type SmsPolicy = {
  primaryProvider: string;
  fallbackProvider: string | null;
  maxAttempts: number;
};

const SMS_UNAVAILABLE = 'SMS delivery is temporarily unavailable.';

@Injectable()
export class FailoverSmsProvider implements SmsProvider {
  constructor(
    private readonly primary: SmsProvider,
    private readonly fallback?: SmsProvider,
    private readonly prisma?: PrismaService,
    private readonly providers: Record<string, SmsProvider> = {},
    private readonly production = false,
  ) {}

  async send(input: SendSmsInput): Promise<void> {
    const policy = await this.resolvePolicy();
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      const providerName = attempt === 1
        ? policy.primaryProvider
        : policy.fallbackProvider ?? policy.primaryProvider;
      const provider = this.providerFor(providerName);
      if (!provider) throw new ServiceUnavailableException(SMS_UNAVAILABLE);

      const delivery = await this.createPending(input, providerName, attempt);
      try {
        await provider.send(input);
      } catch (error) {
        try {
          await this.complete(delivery, 'FAILED', this.errorCode(error));
        } catch {
          throw new ServiceUnavailableException(SMS_UNAVAILABLE);
        }
        continue;
      }

      // Provider success wins. A failed completion update must not resend the OTP.
      try {
        await this.complete(delivery, 'DELIVERED');
      } catch {
        // The delivery row can remain PENDING when its completion update fails.
      }
      return;
    }
    throw new ServiceUnavailableException(SMS_UNAVAILABLE);
  }

  private async resolvePolicy(): Promise<SmsPolicy> {
    const defaults: SmsPolicy = {
      primaryProvider: this.providerName(this.primary, 'primary'),
      fallbackProvider: this.fallback ? this.providerName(this.fallback, 'fallback') : null,
      maxAttempts: 2,
    };
    if (!this.prisma) return this.validatePolicy(defaults);

    let stored: SmsPolicy | null;
    try {
      stored = await this.prisma.smsProviderPolicy.findUnique({ where: { id: 'default' } });
    } catch {
      throw new ServiceUnavailableException(SMS_UNAVAILABLE);
    }
    return this.validatePolicy(stored ? {
      primaryProvider: stored.primaryProvider,
      fallbackProvider: stored.fallbackProvider,
      maxAttempts: stored.maxAttempts,
    } : defaults);
  }

  private validatePolicy(policy: SmsPolicy): SmsPolicy {
    if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 5 ||
      !this.providerFor(policy.primaryProvider) ||
      (policy.fallbackProvider !== null &&
        (!this.providerFor(policy.fallbackProvider) || policy.fallbackProvider === policy.primaryProvider)) ||
      (this.production && (policy.primaryProvider === 'console' || policy.fallbackProvider === 'console'))) {
      throw new ServiceUnavailableException(SMS_UNAVAILABLE);
    }
    return policy;
  }

  private providerFor(name: string): SmsProvider | undefined {
    const mapped = this.providers[name];
    if (mapped) return mapped;
    if (name === this.providerName(this.primary, 'primary')) return this.primary;
    if (this.fallback && name === this.providerName(this.fallback, 'fallback')) return this.fallback;
    return undefined;
  }

  private providerName(provider: SmsProvider, fallback: string): string {
    return Object.entries(this.providers).find(([, candidate]) => candidate === provider)?.[0] ?? fallback;
  }

  private async createPending(input: SendSmsInput, provider: string, attempt: number): Promise<string | null> {
    if (!input.otpRequestId || !this.prisma) return null;
    try {
      const row = await this.prisma.smsDelivery.create({
        data: { otpRequestId: input.otpRequestId, provider, status: 'PENDING', attempt },
        select: { id: true },
      });
      return row.id;
    } catch {
      throw new ServiceUnavailableException(SMS_UNAVAILABLE);
    }
  }

  private async complete(id: string | null, status: string, errorCode?: string): Promise<void> {
    if (!id || !this.prisma) return;
    await this.prisma.smsDelivery.update({
      where: { id },
      data: { status, ...(errorCode ? { errorCode } : {}), completedAt: new Date() },
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof ServiceUnavailableException) return 'SERVICE_UNAVAILABLE';
    return error instanceof Error ? 'PROVIDER_ERROR' : 'SMS_ERROR';
  }
}
