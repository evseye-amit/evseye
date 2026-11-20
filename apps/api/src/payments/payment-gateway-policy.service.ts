import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import { ConflictException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutoPayAvailabilityService } from './autopay-availability.service.js';
import type { Prisma, ClientPaymentProvider } from '@prisma/client';

export type PaymentPurpose = 'DEPLOYMENT' | 'SUBMISSION_PENALTY' | 'INVOICE' | 'OUTSTANDING' | 'SECURITY_DEPOSIT' | 'TOP_UP' | 'UPI_AUTOPAY' | 'ENACH';

// Advertise only capabilities implemented by the registered adapters.
export const gatewayCapabilities: Readonly<Record<string, readonly PaymentPurpose[]>> = {
  RAZORPAY: ['DEPLOYMENT', 'SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY'],
  CASHFREE: ['SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY', 'ENACH'],
  MOCK: ['SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP', 'UPI_AUTOPAY', 'ENACH'],
};

@Injectable()
export class PaymentGatewayPolicyService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService, private readonly deploymentPolicy: AutoPayAvailabilityService) {}

  deploymentAutoPay(clientId: string, db?: Prisma.TransactionClient) {
    return this.deploymentPolicy.availability(clientId, db);
  }

  async capabilities(clientId: string, version = 2) {
    const purposes: Record<string, { enabled: boolean; provider: string | null; platforms: string[]; reason?: string }> = {};
    const environment = (this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'TEST').toUpperCase();
    const merchants = await this.db.clientPaymentProvider.findMany({ where: { clientId, environment } });
    const checkoutPurposes: PaymentPurpose[] = ['DEPLOYMENT', 'SUBMISSION_PENALTY', 'INVOICE', 'OUTSTANDING', 'SECURITY_DEPOSIT', 'TOP_UP'];
    if (version !== 2) throw new ConflictException('UNSUPPORTED_CONTRACT_VERSION');
    for (const purpose of checkoutPurposes) {
      try {
        const provider = await this.resolve(clientId, purpose, undefined, merchants);
        const enabled = ['RAZORPAY', 'CASHFREE'].includes(provider);
        purposes[purpose] = { enabled, provider, platforms: enabled ? ['ANDROID', 'IOS'] : [] };
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const response = error.getResponse();
        const reason = typeof response === 'object' && 'code' in response ? String(response.code) : 'PAYMENT_UNAVAILABLE';
        purposes[purpose] = { enabled: false, provider: null, platforms: [], reason };
      }
    }
    const setup = await this.deploymentAutoPay(clientId);
    const supported = unifiedAutoPayEnabled(this.config, clientId) && setup.effectiveEnabled;
    return { contractVersion: 2, availabilityBasis: 'POLICY', purposes,
      autoPay: { supported, enrollmentEntryPoints: supported ? ['STANDALONE', 'ONBOARDING'] : [], reasonCode: supported ? null : setup.reason ?? 'AUTOPAY_UNAVAILABLE' } };
  }

  async resolve(clientId: string, purpose: PaymentPurpose, requested?: string, merchants?: ClientPaymentProvider[]) {
    const environment = (this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'TEST').toUpperCase();
    const rows = merchants ?? await this.db.clientPaymentProvider.findMany({ where: { clientId, environment } });
    const now = new Date();
    const active = rows.filter(row => row.status === 'ACTIVE' && row.validFrom <= now && (!row.validUntil || row.validUntil >= now));
    let provider: string;
    if (rows.length) {
      if (active.length !== 1) throw new ServiceUnavailableException({ code: 'PAYMENT_POLICY_UNAVAILABLE', message: 'Exactly one active merchant must be configured for this workspace and environment.' });
      provider = active[0].provider.toUpperCase();
      if (!['RAZORPAY', 'CASHFREE'].includes(provider)) throw new ServiceUnavailableException({ code: 'PAYMENT_MERCHANT_UNSUPPORTED', message: 'This provider does not support client-specific merchant credentials.' });
    } else {
      const recurring = purpose === 'UPI_AUTOPAY' ? this.config.get<string>('AUTOPAY_PROVIDER') : undefined;
      provider = (recurring && recurring !== 'configured' ? recurring : this.config.get<string>('PAYMENT_PROVIDER') ?? 'disabled').toUpperCase();
      if (purpose === 'DEPLOYMENT') provider = 'DISABLED';
      if (provider === 'CASHFREE' && this.config.get<string>('NODE_ENV') === 'production' && this.config.get<string>('CASHFREE_ENVIRONMENT') !== 'PRODUCTION')
        throw new ServiceUnavailableException({ code: 'PAYMENT_MERCHANT_UNAVAILABLE', message: 'Legacy Cashfree processing requires production credentials in this environment.' });
      if (provider === 'CASHFREE' && (!this.config.get<string>('CASHFREE_CLIENT_ID')?.trim() || !this.config.get<string>('CASHFREE_CLIENT_SECRET')?.trim()))
        throw new ServiceUnavailableException({ code: 'PAYMENT_MERCHANT_UNAVAILABLE', message: 'Cashfree is not configured for this workspace.' });
    }
    if (requested && requested.toUpperCase() !== provider)
      throw new ConflictException({ code: 'PAYMENT_PROVIDER_POLICY_MISMATCH', message: 'The requested gateway differs from the workspace payment policy.' });
    if (!gatewayCapabilities[provider]?.includes(purpose))
      throw new ServiceUnavailableException({ code: 'PAYMENT_CAPABILITY_UNAVAILABLE', message: 'The configured gateway does not support this payment purpose.' });
    return provider;
  }
}
