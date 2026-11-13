import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';

export type RazorpayCredentials = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantAccountId?: string | null;
  environment: string;
};

/** Resolves credentials for one client without exposing secrets to callers. */
@Injectable()
export class RazorpayConfigurationService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(clientId: string, environment?: string): Promise<RazorpayCredentials> {
    environment ??= this.config.get<string>('RAZORPAY_ENVIRONMENT')?.toUpperCase();
    const configured = await this.db.clientPaymentProvider.findFirst({
      where: { clientId, provider: 'RAZORPAY', ...(environment ? { environment } : {}), status: 'ACTIVE', validFrom: { lte: new Date() }, OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
      orderBy: { validFrom: 'desc' },
    });
    if (configured) {
      const secret = this.readSecretReference(configured.secretReference);
      if (secret) return { keyId: configured.keyId, merchantAccountId: configured.merchantAccountId, environment: configured.environment, ...secret };
    }

    const allowlist = (this.config.get<string>('RAZORPAY_CLIENT_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (allowlist.includes(clientId)) {
      const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
      const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
      const webhookSecret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
      if (keyId && keySecret && webhookSecret) return { keyId, keySecret, webhookSecret, environment: 'LEGACY' };
    }
    throw new ServiceUnavailableException({ code: 'RAZORPAY_UNAVAILABLE', message: 'Online payment is unavailable for this workspace or merchant account.' });
  }

  private readSecretReference(reference: string): Pick<RazorpayCredentials, 'keySecret' | 'webhookSecret'> | null {
    if (!reference.startsWith('env:')) return null;
    try {
      const value = JSON.parse(this.config.get<string>(reference.slice(4)) ?? '{}') as { keySecret?: string; webhookSecret?: string };
      return value.keySecret && value.webhookSecret ? { keySecret: value.keySecret, webhookSecret: value.webhookSecret } : null;
    } catch { return null; }
  }
}
