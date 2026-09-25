import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  CreateMandateInput,
  MandateResult,
  PaymentInput,
  PaymentProvider,
  PaymentResult,
  RefundInput,
  RefundResult,
  VerifiedWebhook,
} from './payment-provider.interface.js';

/** Deterministic provider for automated tests and local development only. */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly mandates = new Map<string, MandateResult>();
  private readonly payments = new Map<string, PaymentResult>();
  private readonly refunds = new Map<string, RefundResult>();
  async createMandate(input: CreateMandateInput): Promise<MandateResult> {
    const result: MandateResult = {
      providerMandateId: input.providerMandateId,
      status: 'CREATED',
      rawStatus: 'CREATED',
      sessionId: `mock_${input.providerMandateId}`,
    };
    this.mandates.set(input.providerMandateId, result);
    return result;
  }
  async fetchMandate(id: string) {
    return (
      this.mandates.get(id) ?? {
        providerMandateId: id,
        status: 'UNKNOWN' as const,
        rawStatus: 'UNKNOWN',
      }
    );
  }
  private async manage(id: string, status: MandateResult['status']) {
    const result = { providerMandateId: id, status, rawStatus: status };
    this.mandates.set(id, result);
    return result;
  }
  pauseMandate(id: string) {
    return this.manage(id, 'PAUSED');
  }
  resumeMandate(id: string) {
    return this.manage(id, 'ACTIVE');
  }
  cancelMandate(id: string) {
    return this.manage(id, 'CANCELLED');
  }
  private async pay(input: PaymentInput): Promise<PaymentResult> {
    const result: PaymentResult = {
      providerMandateId: input.providerMandateId,
      providerPaymentId: input.providerPaymentId,
      status: 'PENDING',
      rawStatus: 'PENDING',
      amount: input.amount,
      paymentType: 'CHARGE',
    };
    this.payments.set(input.providerPaymentId, result);
    return result;
  }
  authorizeMandate(input: PaymentInput) {
    return this.pay(input);
  }
  createPayment(input: PaymentInput) {
    return this.pay(input);
  }
  async fetchPayment(_mandateId: string, paymentId: string) {
    return (
      this.payments.get(paymentId) ?? {
        providerMandateId: _mandateId,
        providerPaymentId: paymentId,
        status: 'UNKNOWN' as const,
        rawStatus: 'UNKNOWN',
      }
    );
  }
  retryPayment(mandateId: string, paymentId: string) {
    return this.fetchPayment(mandateId, paymentId);
  }
  async createRefund(input: RefundInput) {
    const result: RefundResult = {
      providerRefundId: input.providerRefundId,
      status: 'PENDING',
      rawStatus: 'PENDING',
    };
    this.refunds.set(input.providerRefundId, result);
    return result;
  }
  async fetchRefund(_mandateId: string, refundId: string) {
    return (
      this.refunds.get(refundId) ?? {
        providerRefundId: refundId,
        status: 'UNKNOWN' as const,
        rawStatus: 'UNKNOWN',
      }
    );
  }
  verifyWebhook(
    rawBody: Buffer,
    _timestamp: string,
    signature: string,
  ): VerifiedWebhook {
    if (signature !== 'mock-valid-signature')
      throw new UnauthorizedException('Invalid mock webhook signature.');
    return { payload: JSON.parse(rawBody.toString('utf8')) as unknown };
  }
}
