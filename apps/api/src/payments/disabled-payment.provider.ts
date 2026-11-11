import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentProvider } from './payment-provider.interface.js';

@Injectable()
export class DisabledPaymentProvider {
  assertChargeEligible(): void {
    this.unavailable();
  }
  private unavailable(): never {
    throw new ServiceUnavailableException('Payment provider is disabled.');
  }
  createCheckoutOrder(): ReturnType<PaymentProvider['createCheckoutOrder']> {
    return this.unavailable();
  }
  fetchCheckoutPayments(): ReturnType<
    PaymentProvider['fetchCheckoutPayments']
  > {
    return this.unavailable();
  }
  fetchCheckoutOrder(): ReturnType<PaymentProvider['fetchCheckoutOrder']> {
    return this.unavailable();
  }
  verifyCheckoutWebhook(): ReturnType<
    PaymentProvider['verifyCheckoutWebhook']
  > {
    return this.unavailable();
  }
  createCheckoutRefund(): ReturnType<PaymentProvider['createCheckoutRefund']> {
    return this.unavailable();
  }
  fetchCheckoutRefund(): ReturnType<PaymentProvider['fetchCheckoutRefund']> {
    return this.unavailable();
  }
  createMandate(): ReturnType<PaymentProvider['createMandate']> {
    return this.unavailable();
  }
  fetchMandate(): ReturnType<PaymentProvider['fetchMandate']> {
    return this.unavailable();
  }
  pauseMandate(): ReturnType<PaymentProvider['pauseMandate']> {
    return this.unavailable();
  }
  resumeMandate(): ReturnType<PaymentProvider['resumeMandate']> {
    return this.unavailable();
  }
  cancelMandate(): ReturnType<PaymentProvider['cancelMandate']> {
    return this.unavailable();
  }
  authorizeMandate(): ReturnType<PaymentProvider['authorizeMandate']> {
    return this.unavailable();
  }
  createPayment(): ReturnType<PaymentProvider['createPayment']> {
    return this.unavailable();
  }
  fetchPayment(): ReturnType<PaymentProvider['fetchPayment']> {
    return this.unavailable();
  }
  retryPayment(): ReturnType<PaymentProvider['retryPayment']> {
    return this.unavailable();
  }
  createRefund(): ReturnType<PaymentProvider['createRefund']> {
    return this.unavailable();
  }
  fetchRefund(): ReturnType<PaymentProvider['fetchRefund']> {
    return this.unavailable();
  }
  verifyWebhook(): ReturnType<PaymentProvider['verifyWebhook']> {
    return this.unavailable();
  }
}
