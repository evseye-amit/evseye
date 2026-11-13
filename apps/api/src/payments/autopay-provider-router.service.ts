import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.interface.js';
import type { AutoPayProvider } from './autopay-provider.interface.js';
import { CashfreePaymentProvider } from './cashfree/cashfree-payment.provider.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { RazorpayAutoPayProvider } from './razorpay/razorpay-autopay.provider.js';
@Injectable()
export class AutoPayProviderRouter {
  constructor(
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly configured: PaymentProvider,
    private readonly cashfree: CashfreePaymentProvider,
    private readonly razorpay: RazorpayAutoPayProvider,
    private readonly mock?: MockPaymentProvider,
  ) {}
  verifyCashfreeWebhook(raw: Buffer, timestamp: string, signature: string) {
    return this.cashfree.verifyWebhook(raw, timestamp, signature);
  }
  selected(method = 'UPI_AUTOPAY') {
    const requested =
      method === 'ENACH'
        ? 'configured'
        : (this.config.get<string>('AUTOPAY_PROVIDER') ?? 'configured');
    const name =
      requested === 'configured'
        ? this.config.getOrThrow<string>('PAYMENT_PROVIDER')
        : requested;
    return name.toUpperCase();
  }
  forProvider(name?: string): AutoPayProvider {
    const resolved =
      name?.toUpperCase() ??
      this.config.getOrThrow<string>('PAYMENT_PROVIDER').toUpperCase();
    if (resolved === 'RAZORPAY') return this.razorpay;
    if (resolved === 'CASHFREE') return this.cashfree;
    if (resolved === 'MOCK' && this.mock) return this.mock;
    if (
      resolved ===
        this.config.getOrThrow<string>('PAYMENT_PROVIDER').toUpperCase() &&
      resolved !== 'DISABLED'
    )
      return this.configured;
    throw new ServiceUnavailableException(
      'The saved AutoPay provider is unavailable; restore its configuration before reconciliation.',
    );
  }
}
