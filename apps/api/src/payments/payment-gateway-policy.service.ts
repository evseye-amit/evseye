import { ConflictException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

export type PaymentPurpose = 'DEPLOYMENT' | 'SUBMISSION_PENALTY' | 'INVOICE' | 'OUTSTANDING' | 'SECURITY_DEPOSIT' | 'TOP_UP' | 'UPI_AUTOPAY' | 'ENACH';

// Advertise only capabilities implemented by the registered adapters.
export const gatewayCapabilities: Readonly<Record<string, readonly PaymentPurpose[]>> = {
  RAZORPAY: ['DEPLOYMENT', 'SUBMISSION_PENALTY', 'INVOICE', 'UPI_AUTOPAY'],
  CASHFREE: ['SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY', 'ENACH'],
  MOCK: ['SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY', 'ENACH'],
};

@Injectable()
export class PaymentGatewayPolicyService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}

  async capabilities(clientId: string) {
    const purposes: Record<string, { enabled: boolean; provider: string | null; platforms: string[]; reason?: string }> = {};
    for (const purpose of ['DEPLOYMENT', 'SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY', 'ENACH'] as const) {
      try {
        const provider = await this.resolve(clientId, purpose);
        const enabled = ['RAZORPAY', 'CASHFREE'].includes(provider);
        purposes[purpose] = { enabled, provider, platforms: enabled ? ['ANDROID', 'IOS'] : [] };
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const response = error.getResponse();
        const reason = typeof response === 'object' && 'code' in response ? String(response.code) : 'PAYMENT_UNAVAILABLE';
        purposes[purpose] = { enabled: false, provider: null, platforms: [], reason };
      }
    }
    return { contractVersion: 1, availabilityBasis: 'POLICY', connectivityVerified: false, purposes };
  }

  async resolve(clientId: string, purpose: PaymentPurpose, requested?: string) {
    const environment = (this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'TEST').toUpperCase();
    const rows = await this.db.clientPaymentProvider.findMany({ where: { clientId, environment } });
    const now = new Date();
    const active = rows.filter(row => row.status === 'ACTIVE' && row.validFrom <= now && (!row.validUntil || row.validUntil >= now));
    let provider: string;
    if (rows.length) {
      if (active.length !== 1) throw new ServiceUnavailableException({ code: 'PAYMENT_POLICY_UNAVAILABLE', message: 'Exactly one active merchant must be configured for this workspace and environment.' });
      provider = active[0].provider.toUpperCase();
      // Cashfree currently uses shared credentials. Never route a tenant merchant to that shared account.
      if (provider !== 'RAZORPAY') throw new ServiceUnavailableException({ code: 'PAYMENT_MERCHANT_UNSUPPORTED', message: 'This provider does not yet support client-specific merchant credentials.' });
    } else {
      const recurring = purpose === 'UPI_AUTOPAY' ? this.config.get<string>('AUTOPAY_PROVIDER') : undefined;
      provider = (recurring && recurring !== 'configured' ? recurring : this.config.get<string>('PAYMENT_PROVIDER') ?? 'disabled').toUpperCase();
      if (purpose === 'DEPLOYMENT') provider = 'DISABLED';
    }
    if (requested && requested.toUpperCase() !== provider)
      throw new ConflictException({ code: 'PAYMENT_PROVIDER_POLICY_MISMATCH', message: 'The requested gateway differs from the workspace payment policy.' });
    if (!gatewayCapabilities[provider]?.includes(purpose))
      throw new ServiceUnavailableException({ code: 'PAYMENT_CAPABILITY_UNAVAILABLE', message: 'The configured gateway does not support this payment purpose.' });
    return provider;
  }
}
