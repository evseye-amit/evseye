import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type PaymentRefund } from '@prisma/client';
import { RazorpayClient } from './razorpay.client.js';
import type { RefundResult } from '../payment-provider.interface.js';

export type RazorpayRefundSource = { kind: 'RAZORPAY'; provider: 'RAZORPAY'; paymentId: string; orderId: string; configurationVersionId: string; amount: Prisma.Decimal; refundedAmount: Prisma.Decimal; currency: string };

@Injectable()
export class RazorpayRefundService {
  constructor(private readonly gateway: RazorpayClient) {}
  async external(clientId: string, reference: string, source: RazorpayRefundSource) {
    if (!/^rfnd_[A-Za-z0-9]+$/.test(reference)) throw new ConflictException('INVALID_EXTERNAL_REFUND');
    const remote = await this.gateway.fetchRefund(reference, clientId, source.configurationVersionId);
    if (remote.id !== reference || remote.payment_id !== source.paymentId || remote.status !== 'processed' || !Number.isSafeInteger(remote.amount) || remote.amount <= 0)
      throw new ConflictException('EXTERNAL_REFUND_NOT_VERIFIED');
    const candidate = { clientId, id: '', providerRefundId: reference, providerReference: reference, origin: 'EXTERNAL', externalReference: reference, amount: new Prisma.Decimal(remote.amount).div(100), currency: source.currency } as PaymentRefund;
    const result = await this.observe(candidate, source);
    if (result.status !== 'SUCCESS') throw new ConflictException('EXTERNAL_REFUND_NOT_VERIFIED');
    return { amount: candidate.amount.toFixed(2), receipt: remote.receipt };
  }
  async observe(refund: PaymentRefund, source: RazorpayRefundSource, create = false): Promise<RefundResult & { gatewayRefundId?: string; totalRefundedPaise?: number }> {
    const payment = await this.gateway.fetchPayment(source.paymentId, refund.clientId, source.configurationVersionId);
    if (payment.id !== source.paymentId || payment.order_id !== source.orderId || !payment.captured ||
        !['captured', 'refunded'].includes(payment.status) || payment.currency !== refund.currency ||
        source.currency !== refund.currency || !new Prisma.Decimal(payment.amount).eq(source.amount.mul(100)))
      throw new ConflictException('REFUND_SOURCE_PAYMENT_MISMATCH');
    if (create && !new Prisma.Decimal(payment.amount_refunded).eq(source.refundedAmount.mul(100)))
      throw new ConflictException('UNRECORDED_EXTERNAL_REFUND_REQUIRES_REVIEW');
    let remote;
    if (refund.providerReference) remote = await this.gateway.fetchRefund(refund.providerReference, refund.clientId, source.configurationVersionId);
    else if (create) remote = await this.gateway.createPaymentRefund(source.paymentId, refund.amount.mul(100).toNumber(), refund.id, refund.clientId, source.configurationVersionId);
    else {
      // Recover the original request by receipt. Never infer failure or create a replacement on an empty lookup.
      for (let skip = 0; skip < 10000; skip += 100) {
        const batch = await this.gateway.findRefunds(source.paymentId, refund.clientId, source.configurationVersionId, skip);
        const matches = batch.filter(item => item.receipt === refund.id);
        if (matches.length > 1) throw new ConflictException('AMBIGUOUS_PROVIDER_REFUND');
        if (matches.length) { remote = matches[0]; break; }
        if (batch.length < 100) break;
      }
    }
    if (!remote) return { providerRefundId: refund.providerRefundId, status: 'UNKNOWN', rawStatus: 'NOT_OBSERVED' };
    if (!/^rfnd_[A-Za-z0-9]+$/.test(remote.id) || remote.payment_id !== source.paymentId || (refund.origin !== 'EXTERNAL' && remote.receipt !== refund.id) ||
        (refund.origin === 'EXTERNAL' && remote.id !== refund.externalReference) ||
        !Number.isSafeInteger(remote.amount) || !new Prisma.Decimal(remote.amount).eq(refund.amount.mul(100)))
      throw new ConflictException('PROVIDER_REFUND_IDENTITY_MISMATCH');
    return { providerRefundId: refund.providerRefundId, gatewayRefundId: remote.id, totalRefundedPaise: payment.amount_refunded,
      status: remote.status === 'processed' ? 'SUCCESS' : remote.status === 'failed' ? 'FAILED' : 'PENDING',
      rawStatus: remote.status, amount: new Prisma.Decimal(remote.amount).div(100).toFixed(2), currency: payment.currency };
  }
}
