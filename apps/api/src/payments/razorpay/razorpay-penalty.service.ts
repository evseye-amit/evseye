import { RiderDepositService } from '../../rider-deposits/deposit.service.js';
import { SecurityDepositService } from '../../wallet/security-deposit.service.js';
import { settleCheckoutPayment } from '../checkout-payment-settlement.js';
import { unaccountedRefund } from './razorpay-refund-evidence.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PaymentGatewayPolicyService } from '../payment-gateway-policy.service.js';
import { randomUUID } from 'node:crypto';
import { Prisma, type PaymentCollectionRequest, type RazorpayPenaltyOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RiderPaymentsService } from '../../rider-billing/rider-payments.service.js';
import { WalletService } from '../../wallet/wallet.service.js';
import { SubmissionPenaltyService } from '../../submission-penalties/submission-penalty.service.js';
import {
  PENALTY_PAYMENT,
  parseOutstandingInput,
  planPenaltyPayment,
} from '../outstanding-payment.js';
import { settleRazorpayRentalInvoice } from '../rental-invoice-payment-settlement.js';
import { settlePenaltyPayment } from '../penalty-payment-settlement.js';
import {
  RazorpayClient,
  RazorpayProviderError,
  type RazorpayPayment,
  type orderSchema,
} from './razorpay.client.js';
import type { z } from 'zod';

@Injectable()
export class RazorpayPenaltyService {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: RazorpayClient,
    private readonly payments: RiderPaymentsService,
    private readonly wallet: WalletService,
    private readonly penalties: SubmissionPenaltyService,
    @Optional() private readonly policy?: PaymentGatewayPolicyService,
    @Optional() private readonly deposits?: RiderDepositService,
    @Optional() private readonly walletDeposits?: SecurityDepositService,
  ) {}

  async startCollection(request: PaymentCollectionRequest) {
    let order = await this.db.razorpayPenaltyOrder.findUnique({ where: { collectionId: request.id } });
    if (!order) {
      const merchant = await this.gateway.configurationFor(request.clientId);
      await this.gateway.assertConfigured(request.clientId, merchant.keyId, merchant.configurationVersionId);
      const paise = request.amount.mul(100);
      if (!paise.isInteger() || paise.lt(100) || paise.gt(Number.MAX_SAFE_INTEGER))
        throw new BadRequestException('Online payments require at least INR 1.00 and a supported amount.');
      order = await this.db.razorpayPenaltyOrder.upsert({
        where: { collectionId: request.id },
        create: { collectionId: request.id, keyId: merchant.keyId, configurationVersionId: merchant.configurationVersionId,
          amountPaise: BigInt(paise.toString()), currency: request.currency },
        update: {},
      });
    }
    await this.startOrder(request.clientId, order, request.collectionType);
  }

  /** Local release only: Razorpay orders may still capture late and remain reconciled. */
  async abandon(clientId: string, riderId: string, collectionId: string) {
    await this.reconcileCollection(clientId, riderId, collectionId);
    const order = await this.db.razorpayPenaltyOrder.findFirstOrThrow({ where: { collectionId, collection: { clientId, riderId } } });
    if (!order.providerOrderId) throw new ConflictException('Confirm order creation before abandoning checkout.');
    const remotes = await this.gateway.orderPayments(order.providerOrderId, clientId, order.configurationVersionId);
    if (remotes.some(p => p.captured || p.status !== 'failed'))
      throw new ConflictException('A gateway payment is captured or still in progress. Reconcile it before starting another.');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${riderId} AND "clientId"=${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentCollectionRequest" WHERE id=${collectionId} FOR UPDATE`;
      const current = await tx.paymentCollectionRequest.findFirstOrThrow({ where: { id: collectionId, clientId, riderId } });
      if (current.status === 'SUCCESS' || current.failureCode?.includes('REVIEW'))
        throw new ConflictException('The payment succeeded or requires review.');
      if (current.status === 'CANCELLED') return current;
      await tx.razorpayPenaltyOrder.update({ where: { id: order.id }, data: { status: 'ABANDONED' } });
      const result = await tx.paymentCollectionRequest.update({ where: { id: collectionId }, data: { status: 'CANCELLED', failureCode: 'CHECKOUT_ABANDONED' } });
      await tx.auditLog.create({ data: { clientId, actorId: null, action: 'CHECKOUT_ABANDONED', entityType: 'PaymentCollectionRequest', entityId: collectionId,
        newData: { provider: 'RAZORPAY', lateCapturePossible: true } } });
      return result;
    });
  }

  async createOrder(clientId: string, userId: string, body: unknown) {
    await this.policy?.resolve(clientId, 'SUBMISSION_PENALTY', 'RAZORPAY');
    await this.gateway.assertConfigured(clientId);
    const merchant = await this.gateway.configurationFor(clientId);
    const { keyId, configurationVersionId } = merchant;
    // Only amount is accepted; the purpose and invoice scope are server-owned.
    if (
      body &&
      (typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => k !== 'amount'))
    )
      throw new BadRequestException('Only amount may be supplied.');
    const selection = parseOutstandingInput({
      ...(body as object),
      scope: 'SUBMISSION_PENALTY',
    });
    const riderId = await this.penalties.rider(clientId, userId);
    const order = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
        const active = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            OR: [
              { status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
              {
                provider: 'RAZORPAY',
                failureCode: { not: null },
                status: 'SUCCESS',
              },
            ],
          },
          include: {
            razorpayPenaltyOrder: { include: { captures: true } },
          },
        });
        if (active) {
          if (active.failureCode)
            throw new ConflictException(
              'A payment requires support review. Please do not pay again.',
            );
          const existing = active.razorpayPenaltyOrder;
          if (
            active.collectionType !== PENALTY_PAYMENT ||
            !existing ||
            (selection.requestedAmount !== null &&
              !active.amount.eq(selection.requestedAmount))
          )
            throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
          // Resume the originating merchant after rotation.
          return existing;
        }
        if (
          await tx.paymentTransaction.findFirst({
            where: {
              clientId,
              riderId,
              status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
            },
          })
        )
          throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
        const invoices = await tx.riderInvoice.findMany({
          where: {
            clientId,
            riderId,
            invoiceType: 'SUBMISSION_PENALTY',
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
          },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        });
        if (!invoices.length)
          throw new BadRequestException(
            'There are no outstanding penalties to pay.',
          );
        if (invoices.some((i) => i.currency !== 'INR'))
          throw new BadRequestException(
            'Only INR penalty payments are supported.',
          );
        const balance = invoices.reduce(
          (sum, i) => sum.plus(i.outstandingAmount),
          new Prisma.Decimal(0),
        );
        const amount = new Prisma.Decimal(selection.requestedAmount ?? balance);
        if (amount.lt(1) || amount.gt(balance))
          throw new BadRequestException(
            'Payment must be between INR 1.00 and the outstanding balance.',
          );
        const paise = amount.mul(100);
        if (!paise.isInteger() || paise.gt(Number.MAX_SAFE_INTEGER))
          throw new BadRequestException('Invalid payment amount.');
        const id = randomUUID();
        const collection = await tx.paymentCollectionRequest.create({
          data: {
            clientId,
            riderId,
            collectionType: PENALTY_PAYMENT,
            provider: 'RAZORPAY',
            method: 'UPI',
            amount,
            currency: 'INR',
            status: 'CREATING',
            idempotencyKey: `razorpay:penalty:${id}`,
            paymentSnapshot: {
              version: 1,
              scope: 'SUBMISSION_PENALTY',
              requestedAmount: selection.requestedAmount,
              outstandingBeforePayment: balance.toFixed(2),
              externalPaymentRequested: amount.toFixed(2),
              allocations: planPenaltyPayment(invoices, amount),
            },
            attempts: {
              create: {
                clientId,
                sequence: 1,
                providerPaymentId: `penalty_${id}`,
                status: 'CREATING',
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: userId,
            action: 'PAYMENT_COLLECTION_CREATED',
            entityType: 'PaymentCollectionRequest',
            entityId: collection.id,
            newData: {
              provider: 'RAZORPAY',
              amount: amount.toFixed(2),
              purpose: PENALTY_PAYMENT,
            },
          },
        });
        return tx.razorpayPenaltyOrder.create({
          data: {
            id,
            collectionId: collection.id,
            keyId,
            configurationVersionId,
            amountPaise: BigInt(paise.toString()),
            currency: 'INR',
          },
        });
      },
      { timeout: 12000 },
    );
    return this.startOrder(clientId, order, PENALTY_PAYMENT);
  }

  /** Shared Razorpay collection storage retains its historical penalty model names. */
  async startOrder(
    clientId: string,
    order: RazorpayPenaltyOrder,
    purpose: string,
  ) {
    await this.gateway.assertConfigured(clientId, order.keyId, order.configurationVersionId);
    let bound = order;
    if (!bound.providerOrderId) {
      // Only the creator claims the outbound POST. Repeated taps recover by receipt.
      const claim = await this.db.razorpayPenaltyOrder.updateMany({
        where: { id: order.id, status: 'CREATING' },
        data: { status: 'CREATE_UNKNOWN' },
      });
      if (claim.count) {
        try {
          bound = await this.bind(
            order,
            await this.gateway.createOrder(
              Number(order.amountPaise),
              order.currency,
              order.id,
              { purpose },
              clientId, order.configurationVersionId,
            ),
          );
        } catch (error) {
          if (error instanceof RazorpayProviderError && error.definitive)
            await this.db.$transaction([
              this.db.razorpayPenaltyOrder.update({
                where: { id: order.id },
                data: { status: 'FAILED' },
              }),
              this.db.paymentCollectionRequest.update({
                where: { id: order.collectionId },
                data: { status: 'FAILED', failureCode: 'PROVIDER_REJECTED' },
              }),
            ]);
          throw error;
        }
      } else {
        if (Date.now() - order.createdAt.getTime() < 30000)
          throw new ConflictException(
            'A payment order is being created. Please retry shortly.',
          );
        const matches = await this.gateway.findOrders(order.id, clientId, order.configurationVersionId);
        if (matches.length !== 1)
          throw new ConflictException(
            'Payment order needs confirmation. Do not pay again; contact support if this persists.',
          );
        bound = await this.bind(order, matches[0]);
      }
    }
    return {
      keyId: bound.keyId,
      orderId: bound.providerOrderId,
      amount: Number(bound.amountPaise),
      currency: bound.currency,
    };
  }

  private async bind(
    order: RazorpayPenaltyOrder,
    remote: z.infer<typeof orderSchema>,
  ) {
    if (
      remote.receipt !== order.id ||
      remote.amount !== Number(order.amountPaise) ||
      remote.currency !== order.currency ||
      (order.providerOrderId && order.providerOrderId !== remote.id)
    )
      throw new ConflictException('PROVIDER_ORDER_MISMATCH');
    return this.db.$transaction(async (tx) => {
      await tx.paymentCollectionRequest.updateMany({
        where: {
          id: order.collectionId,
          status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
        },
        data: { providerOrderId: remote.id, status: 'PENDING' },
      });
      await tx.razorpayPenaltyOrder.updateMany({
        where: {
          id: order.id,
          status: { in: ['CREATING', 'CREATE_UNKNOWN', 'OPEN'] },
        },
        data: { providerOrderId: remote.id, status: 'OPEN' },
      });
      return tx.razorpayPenaltyOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
    });
  }

  async verify(
    clientId: string,
    userId: string,
    body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    const riderId = await this.penalties.rider(clientId, userId);
    const order = await this.db.razorpayPenaltyOrder.findFirst({
      where: {
        providerOrderId: body.razorpayOrderId,
        collection: { clientId, riderId },
      },
    });
    if (!order) throw new NotFoundException('Payment order not found.');
    await this.gateway.assertConfigured(clientId, order.keyId, order.configurationVersionId);
    await this.gateway.verifyCheckout(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
      clientId, order.configurationVersionId,
    );
    const payment = await this.gateway.fetchPayment(body.razorpayPaymentId, clientId, order.configurationVersionId);
    if (payment.id !== body.razorpayPaymentId)
      throw new ConflictException('PROVIDER_PAYMENT_IDENTITY_CONFLICT');
    await this.observe(order, payment);
    const retryAvailable =
      payment.status === 'failed' &&
      (await this.gateway.orderPayments(order.providerOrderId!, clientId, order.configurationVersionId)).every(
        (p) => p.status === 'failed',
      );
    const current = await this.db.paymentCollectionRequest.findUniqueOrThrow({
      where: { id: order.collectionId },
    });
    return {
      ...(current.collectionType === PENALTY_PAYMENT
        ? await this.penalties.summary(clientId, riderId)
        : {}),
      orderId: body.razorpayOrderId,
      paymentId: body.razorpayPaymentId,
      paymentStatus: current.status,
      ...(current.failureCode
        ? { nextAction: 'CONTACT_SUPPORT' }
        : current.status !== 'SUCCESS'
          ? {
              nextAction: retryAvailable
                ? 'RETRY_ONLINE_PAYMENT'
                : 'AWAITING_GATEWAY_CONFIRMATION',
            }
          : {}),
    };
  }

  private async observe(order: RazorpayPenaltyOrder, payment: RazorpayPayment) {
    if (
      payment.order_id !== order.providerOrderId ||
      payment.amount !== Number(order.amountPaise) ||
      payment.currency !== order.currency
    )
      throw new ConflictException('PROVIDER_PAYMENT_MISMATCH');
    if (
      !['captured', 'refunded'].includes(payment.status) ||
      (!payment.captured && payment.status !== 'refunded')
    )
      return;
    const request = await this.db.paymentCollectionRequest.findUniqueOrThrow({
      where: { id: order.collectionId },
    });
    const previous = await this.db.razorpayPenaltyCapture.findUnique({
      where: { providerPaymentId: payment.id },
    });
    if (previous && previous.orderId !== order.id)
      throw new ConflictException('PROVIDER_PAYMENT_IDENTITY_CONFLICT');
    const externalRefund = await unaccountedRefund(this.db, request.clientId, request.providerPaymentId === payment.id ? request.riderPaymentId : null, payment);
    let reason =
      externalRefund
        ? 'EXTERNAL_REFUND_REQUIRES_REVIEW'
        : request.status === 'SUCCESS' &&
            request.providerPaymentId !== payment.id
          ? 'DUPLICATE_CAPTURE_REQUIRES_REVIEW'
          : null;
    if (!reason) {
      try {
        const legacyRental = request.collectionType === 'INVOICE_PAYMENT' &&
          (request.paymentSnapshot as Record<string, unknown> | null)?.scope === 'RENTAL_INVOICE';
        if (!legacyRental && request.collectionType !== PENALTY_PAYMENT && (!this.deposits || !this.walletDeposits))
          throw new ConflictException('Checkout settlement is unavailable.');
        const settled = legacyRental
          ? await settleRazorpayRentalInvoice(this.db, this.payments, this.wallet, request, payment.id)
          : request.collectionType === PENALTY_PAYMENT
            ? await settlePenaltyPayment(this.db, this.payments, this.wallet, request, payment.id)
            : await settleCheckoutPayment(this.db, this.payments, this.deposits!, this.wallet, this.walletDeposits!, request,
                { providerPaymentId: payment.id, providerReference: payment.id });
        reason = !externalRefund && settled.failureCode === 'EXTERNAL_REFUND_REQUIRES_REVIEW' ? null : settled.failureCode;
      } catch (error) {
        if (
          !(error instanceof ConflictException) ||
          error.message !== 'DUPLICATE_CAPTURE_REQUIRES_REVIEW'
        )
          throw error;
        reason = 'DUPLICATE_CAPTURE_REQUIRES_REVIEW';
      }
    }
    await this.db.$transaction(async (tx) => {
      await tx.razorpayPenaltyCapture.upsert({
        where: { providerPaymentId: payment.id },
        create: {
          orderId: order.id,
          providerPaymentId: payment.id,
          amountPaise: BigInt(payment.amount),
          currency: payment.currency,
          status: reason ? 'REVIEW_REQUIRED' : 'SETTLED',
          reason,
        },
        update: { status: reason ? 'REVIEW_REQUIRED' : 'SETTLED', reason },
      });
      await tx.razorpayPenaltyOrder.update({
        where: { id: order.id },
        data: { status: reason ? 'REVIEW_REQUIRED' : 'PAID' },
      });
      if (!reason && !externalRefund) await tx.paymentCollectionRequest.updateMany({ where: { id: request.id, failureCode: 'EXTERNAL_REFUND_REQUIRES_REVIEW' }, data: { failureCode: null } });
      if (reason) {
        await tx.paymentCollectionRequest.updateMany({
          where: { id: request.id, status: { not: 'SUCCESS' } },
          data: { status: 'UNKNOWN', failureCode: reason },
        });
        await tx.paymentCollectionRequest.update({
          where: { id: request.id },
          data: { failureCode: reason },
        });
      }
    });
  }

  /** Called by the existing durable webhook dispatcher, including ambiguous creates. */
  async processEvent(eventId: string, orderId: string, paymentId: string, clientId: string, configurationVersionId?: string | null) {
    let order = await this.db.razorpayPenaltyOrder.findUnique({
      where: { providerOrderId: orderId },
      include: { collection: true },
    });
    if (!order) {
      const remote = await this.gateway.fetchOrder(orderId, clientId, configurationVersionId);
      const pending = remote.receipt
        ? await this.db.razorpayPenaltyOrder.findUnique({
            where: { id: remote.receipt },
            include: { collection: true },
          })
        : null;
      if (!pending) return false;
      if (pending.collection.clientId !== clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
      await this.gateway.assertConfigured(pending.collection.clientId, pending.keyId, pending.configurationVersionId);
      await this.bind(pending, remote);
      order = { ...pending, providerOrderId: remote.id };
    }
    if (order.collection.clientId !== clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
    await this.gateway.assertConfigured(order.collection.clientId, order.keyId, order.configurationVersionId);
    await this.db.paymentProviderEvent.update({
      where: { id: eventId },
      data: {
        collectionRequestId: order.collectionId,
        clientId: order.collection.clientId,
      },
    });
    const payment = await this.gateway.fetchPayment(paymentId, order.collection.clientId, order.configurationVersionId);
    if (payment.id !== paymentId)
      throw new ConflictException('PROVIDER_PAYMENT_IDENTITY_CONFLICT');
    await this.observe(order, payment);
    return true;
  }

  async reconcileCollection(
    clientId: string,
    riderId: string,
    collectionId: string,
  ) {
    let order = await this.db.razorpayPenaltyOrder.findFirst({
      where: { collectionId, collection: { clientId, riderId } },
    });
    if (!order) {
      const request = await this.db.paymentCollectionRequest.findFirst({ where: {
        id: collectionId, clientId, riderId, provider: 'RAZORPAY', status: 'CREATING',
      } });
      if (!request) throw new NotFoundException('Payment order not found.');
      // No order record means no gateway POST could have been claimed yet.
      await this.startCollection(request);
      order = await this.db.razorpayPenaltyOrder.findUniqueOrThrow({ where: { collectionId } });
    }
    await this.gateway.assertConfigured(clientId, order.keyId, order.configurationVersionId);
    if (!order.providerOrderId) {
      if (Date.now() - order.createdAt.getTime() < 30000) return;
      const matches = await this.gateway.findOrders(order.id, clientId, order.configurationVersionId);
      if (matches.length !== 1)
        throw new ConflictException('Payment order requires support review.');
      order = await this.bind(order, matches[0]);
    }
    for (const payment of await this.gateway.orderPayments(
      order.providerOrderId!, clientId, order.configurationVersionId,
    ))
      await this.observe(order, payment);
  }

  async reconcile() {
    const orders = await this.db.razorpayPenaltyOrder.findMany({
      where: { status: { not: 'FAILED' } },
      orderBy: { checkedAt: 'asc' },
      take: 10,
      include: { collection: true },
    });
    for (let order of orders) {
      await this.db.razorpayPenaltyOrder.update({
        where: { id: order.id },
        data: { checkedAt: new Date() },
      });
      try {
        await this.gateway.assertConfigured(order.collection.clientId, order.keyId, order.configurationVersionId);
        if (!order.providerOrderId) {
          if (Date.now() - order.createdAt.getTime() < 30000) continue;
          const matches = await this.gateway.findOrders(order.id, order.collection.clientId, order.configurationVersionId);
          if (matches.length !== 1) continue;
          order = { ...order, ...(await this.bind(order, matches[0])) };
        }
        for (const payment of await this.gateway.orderPayments(
          order.providerOrderId!, order.collection.clientId, order.configurationVersionId,
        ))
          await this.observe(order, payment);
      } catch {
        /* Durable order remains available for the next reconciliation attempt. */
      }
    }
  }
}
