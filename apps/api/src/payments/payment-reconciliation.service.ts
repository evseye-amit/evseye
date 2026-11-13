import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RazorpayDeploymentService } from './razorpay/razorpay-deployment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutCollectionService } from './checkout-collection.service.js';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';

@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutCollectionService,
    private readonly auto: PaymentOrchestratorService,
    private readonly deployments: RazorpayDeploymentService,
  ) {}
  async unknownProviderEvents() {
    return this.prisma.paymentProviderEvent.findMany({
      where: { clientId: null, status: 'FAILED' },
      select: {
        id: true,
        provider: true,
        eventType: true,
        payloadHash: true,
        failureReason: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
  }
  async report(clientId: string, riderId?: string, page = 1) {
    const limit = 200;
    const paging = { skip: (page - 1) * limit, take: limit + 1 };

    const [
      checkouts,
      subscriptions,
      payments,
      refunds,
      events,
      observations,
      settlementItems,
      deploymentAttempts,
    ] = await Promise.all([
      this.prisma.paymentCollectionRequest.findMany({
        where: { clientId, ...(riderId ? { riderId } : {}) },
        include: {
          riderPayment: true,
          razorpayPenaltyOrder: { select: { configurationVersionId: true } },
          depositTransaction: true,
          invoice: { select: { invoiceType: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.paymentTransaction.findMany({
        where: { clientId, ...(riderId ? { riderId } : {}) },
        include: { riderPayment: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.riderPayment.findMany({
        where: {
          clientId,
          ...(riderId ? { riderId } : {}),
          status: 'CONFIRMED',
          unallocatedAmount: { gt: 0 },
        },
        select: { id: true, riderId: true, unallocatedAmount: true },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], ...paging,
      }),
      this.prisma.paymentRefund.findMany({
        where: { clientId, ...(riderId ? { riderId } : {}) },
        include: { payment: true },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.paymentProviderEvent.findMany({
        where: {
          clientId,
          status: 'FAILED',
          ...(riderId ? { collectionRequest: { is: { riderId } } } : {}),
        },
        include: { collectionRequest: { select: { riderId: true } } },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.providerPaymentObservation.findMany({
        where: {
          clientId,
          reviewCode: { not: null },
          ...(riderId ? { riderId } : {}),
        },
        select: { id: true, riderId: true, amount: true, reviewCode: true },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.providerSettlementItem.findMany({
        where: { clientId, status: { not: 'MATCHED' } },
        select: {
          id: true,
          amount: true,
          status: true,
          reviewCode: true,
          settlementId: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      this.prisma.deploymentPaymentAttempt.findMany({
        where: { clientId, payment: { workflow: { allocation: { clientId, ...(riderId ? { riderId } : {}) } } } },
        include: { captures: true, payment: { include: { workflow: { include: { allocation: { select: { riderId: true } } } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging,
      }),
    ]);
    const items = [
      ...checkouts.slice(0, limit).map((request) => ({
        source: 'CHECKOUT',
        id: request.id,
        riderId: request.riderId,
        provider: request.provider,
        paymentId: request.riderPaymentId,
        refundSupported: request.collectionType !== 'TOP_UP' && Boolean(request.riderPaymentId) && request.riderPayment?.status === 'CONFIRMED' && (request.provider === 'CASHFREE' || (request.provider === 'RAZORPAY' && Boolean(request.razorpayPenaltyOrder?.configurationVersionId))),
        refundReviewReason: request.provider === 'RAZORPAY' && !request.razorpayPenaltyOrder?.configurationVersionId ? 'Historical merchant binding requires support review.' : request.collectionType === 'TOP_UP' ? 'Wallet top-ups are non-refundable.' : null,
        state:
          request.failureCode?.endsWith('_REVIEW') ||
          request.failureCode === 'PROVIDER_PAYMENT_MISMATCH'
            ? 'MANUAL_REVIEW_REQUIRED'
            : request.status === 'SUCCESS' &&
                !request.riderPaymentId &&
                !request.depositTransactionId &&
                request.invoice?.invoiceType !== 'SECURITY_DEPOSIT'
              ? 'PROVIDER_SUCCESS_LOCAL_PENDING'
              : request.riderPayment &&
                  !request.riderPayment.amount.eq(request.amount)
                ? 'AMOUNT_MISMATCH'
                : request.depositTransaction &&
                    !request.depositTransaction.amount.eq(request.amount)
                  ? 'AMOUNT_MISMATCH'
                  : request.status === 'UNKNOWN'
                    ? 'MANUAL_REVIEW_REQUIRED'
                    : request.status === 'SUCCESS'
                      ? 'MATCHED'
                      : request.status,
        amount: request.amount.toFixed(2),
      })),
      ...subscriptions.slice(0, limit).map((transaction) => ({
        source: 'AUTOPAY',
        id: transaction.id,
        riderId: transaction.riderId,
        provider: transaction.provider,
        paymentId: transaction.riderPaymentId,
        refundSupported: Boolean(transaction.riderPaymentId) && transaction.riderPayment?.status === 'CONFIRMED' && (transaction.provider === 'CASHFREE' || (transaction.provider === 'RAZORPAY' && Boolean(transaction.configurationVersionId && transaction.gatewayPaymentId))),
        refundReviewReason: transaction.provider === 'RAZORPAY' && !transaction.configurationVersionId ? 'Historical merchant binding requires support review.' : null,
        state:
          transaction.status === 'SUCCESS' && !transaction.riderPaymentId
            ? 'LEGACY_SETTLED'
            : transaction.riderPayment &&
                !transaction.riderPayment.amount.eq(transaction.amount)
              ? 'AMOUNT_MISMATCH'
              : transaction.status === 'UNKNOWN'
                ? 'MANUAL_REVIEW_REQUIRED'
                : transaction.status === 'SUCCESS'
                  ? 'MATCHED'
                  : transaction.status,
        amount: transaction.amount.toFixed(2),
      })),
      ...payments.slice(0, limit).map((payment) => ({
        source: 'RECEIPT',
        id: payment.id,
        riderId: payment.riderId,
        state: 'UNALLOCATED_PAYMENT',
        amount: payment.unallocatedAmount.toFixed(2),
      })),
      ...refunds.slice(0, limit).map((refund) => ({
        source: 'REFUND',
        id: refund.id,
        riderId: refund.riderId,
        provider: refund.provider,
        providerRefundId: refund.provider === 'RAZORPAY' ? refund.providerReference : refund.providerRefundId,
        requestedAt: refund.requestedAt,
        aged: !['SUCCESS', 'FAILED', 'CANCELLED'].includes(refund.status) && refund.requestedAt.getTime() < Date.now() - 86400000,
        paymentId: refund.paymentId,
        state:
          refund.status === 'SUCCESS' &&
          refund.payment.refundedAmount.lt(refund.amount)
            ? 'PROVIDER_SUCCESS_LOCAL_PENDING'
            : ['UNKNOWN', 'CREATING'].includes(refund.status)
              ? 'MANUAL_REVIEW_REQUIRED'
              : refund.status === 'SUCCESS'
                ? 'MATCHED'
                : refund.status,
        amount: refund.amount.toFixed(2),
      })),
      ...events.slice(0, limit).map((event) => ({
        source: 'WEBHOOK',
        id: event.id,
        riderId: event.collectionRequest?.riderId ?? null,
        state: 'MANUAL_REVIEW_REQUIRED',
        amount: null,
      })),
      ...observations.slice(0, limit).map((observation) => ({
        source: 'PROVIDER_PAYMENT',
        id: observation.id,
        riderId: observation.riderId,
        state: 'MANUAL_REVIEW_REQUIRED',
        amount: observation.amount?.toFixed(2) ?? null,
      })),
      ...settlementItems.slice(0, limit).map((item) => ({
        source: 'SETTLEMENT',
        id: item.id,
        riderId: null,
        state: 'MANUAL_REVIEW_REQUIRED',
        amount: item.amount.toFixed(2),
        settlementId: item.settlementId,
        reviewCode: item.reviewCode,
      })),
      ...deploymentAttempts.slice(0, limit).map(attempt => ({
        source: 'DEPLOYMENT', id: attempt.id,
        riderId: attempt.payment.workflow.allocation.riderId,
        allocationId: attempt.payment.workflow.allocationId,
        provider: attempt.provider,
        providerOrderId: attempt.providerOrderId,
        state: attempt.captures.some(capture => !['SETTLED', 'REFUNDED'].includes(capture.status))
          ? 'MANUAL_REVIEW_REQUIRED' : attempt.captures.some(capture => capture.status === 'SETTLED') ? 'MATCHED' : attempt.status,
        amount: new Prisma.Decimal(attempt.amountPaise.toString()).div(100).toFixed(2),
        captures: attempt.captures.map(capture => ({
          id: capture.id, providerPaymentId: capture.providerPaymentId, status: capture.status,
          reason: capture.reason, providerRefundId: capture.providerRefundId,
          amount: new Prisma.Decimal(capture.amountPaise.toString()).div(100).toFixed(2),
        })),
      })),
    ];
    const riderIds = [...new Set(items.flatMap(item => item.riderId ? [item.riderId] : []))];
    const riders = riderIds.length ? await this.prisma.rider.findMany({ where: { clientId, id: { in: riderIds } }, select: { id: true, name: true, riderCode: true } }) : [];
    const labels = new Map(riders.map(rider => [rider.id, rider]));
    return {
      items: items.map(item => ({ ...item, riderName: labels.get(item.riderId ?? '')?.name ?? null, riderCode: labels.get(item.riderId ?? '')?.riderCode ?? null })),
      page,
      hasMore: [checkouts, subscriptions, payments, refunds, events, observations, settlementItems, deploymentAttempts].some(rows => rows.length > limit),
      reviewRequired: items.filter((item) =>
        [
          'PROVIDER_SUCCESS_LOCAL_PENDING',
          'AMOUNT_MISMATCH',
          'MANUAL_REVIEW_REQUIRED',
          'UNALLOCATED_PAYMENT',
        ].includes(item.state),
      ).length,
    };
  }
  async retry(
    clientId: string,
    riderId: string,
    source: 'CHECKOUT' | 'AUTOPAY' | 'DEPLOYMENT',
    id: string,
  ) {
    if (source === 'DEPLOYMENT') {
      const attempt = await this.prisma.deploymentPaymentAttempt.findFirst({
        where: { id, clientId, payment: { workflow: { allocation: { clientId, riderId } } } },
        include: { payment: { include: { workflow: true } } },
      });
      if (!attempt) throw new NotFoundException('Deployment payment not found.');
      if (attempt.provider !== 'RAZORPAY') throw new BadRequestException('Unsupported deployment provider.');
      return this.deployments.reconcileAllocation(clientId, attempt.payment.workflow.allocationId);
    }
    if (source === 'CHECKOUT') {
      const request = await this.prisma.paymentCollectionRequest.findFirst({
        where: { id, clientId, riderId },
      });
      if (!request) throw new NotFoundException('Collection not found.');
      return this.checkout.verify(clientId, riderId, id);
    }
    if (source !== 'AUTOPAY') throw new BadRequestException('Unsupported reconciliation source.');
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id, clientId, riderId },
    });
    if (!transaction) throw new NotFoundException('Collection not found.');
    return this.auto.verify(clientId, riderId, id);
  }
}
