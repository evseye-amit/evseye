import { WalletService } from '../wallet/wallet.service.js';
import { PaymentAutomationService } from './payment-automation.service.js';
import { RazorpayRefundService, type RazorpayRefundSource } from './razorpay/razorpay-refund.service.js';
import { RazorpayEventRouter, type RazorpayInboxEvent } from './razorpay/razorpay-event-router.service.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { Prisma, type PaymentRefund } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { ProviderRequestError } from './payment-provider.interface.js';
import {
  type PaymentProvider,
  type RefundResult,
} from './payment-provider.interface.js';
import { CashfreePaymentProvider } from './cashfree/cashfree-payment.provider.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { retryablePaymentTransaction } from './transaction-retry.js';

export function refundableAmount(
  paymentAmount: Prisma.Decimal,
  alreadyRefunded: Prisma.Decimal,
  successfulRecorded: Prisma.Decimal,
  reserved: Prisma.Decimal,
) {
  const legacyRefunded = Prisma.Decimal.max(
    alreadyRefunded.minus(successfulRecorded),
    0,
  );
  return Prisma.Decimal.max(
    paymentAmount.minus(legacyRefunded).minus(reserved),
    0,
  );
}

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreePaymentProvider,
    private readonly payments: RiderPaymentsService,
    @Optional() private readonly mock?: MockPaymentProvider,
    @Optional() private readonly razorpay?: RazorpayRefundService,
    @Optional() private readonly events?: RazorpayEventRouter,
    @Optional() private readonly automation?: PaymentAutomationService,
    @Optional() private readonly wallets?: WalletService,
  ) {}
  onModuleInit() { this.events?.register(event => this.razorpayWebhook(event)); }
  private async razorpayWebhook(event: RazorpayInboxEvent) {
    if (!event.clientId || !event.eventType.startsWith('refund.')) return false;
    const entity = event.deploymentPayload as { refundId?: string; paymentId?: string } | null;
    if (!entity?.refundId || !entity.paymentId) return false;
    const [collection, debit] = await Promise.all([
      this.prisma.paymentCollectionRequest.findFirst({ where: { clientId: event.clientId, provider: 'RAZORPAY', providerPaymentId: entity.paymentId }, select: { riderPaymentId: true } }),
      this.prisma.paymentTransaction.findFirst({ where: { clientId: event.clientId, provider: 'RAZORPAY', gatewayPaymentId: entity.paymentId }, select: { riderPaymentId: true } }),
    ]);
    const paymentIds = [collection?.riderPaymentId, debit?.riderPaymentId].filter((id): id is string => Boolean(id));
    if (!paymentIds.length) return false;
    const refunds = await this.prisma.paymentRefund.findMany({ where: { clientId: event.clientId, paymentId: { in: paymentIds }, provider: 'RAZORPAY', OR: [{ providerReference: entity.refundId }, { providerReference: null }] }, take: 101 });
    // The durable inbox remains unresolved if a broad lookup cannot be safely completed.
    if (refunds.length > 100) throw new ConflictException('REFUND_LOOKUP_REQUIRES_REVIEW');
    for (const refund of refunds) {
      const source = await this.source(refund.clientId, refund.riderId, refund.paymentId);
      if (source.kind !== 'RAZORPAY' || source.paymentId !== entity.paymentId) continue;
      if (refund.providerReference && refund.providerReference !== entity.refundId) continue;
      const result = await this.verify(refund.clientId, refund.riderId, refund.id);
      const saved = await this.prisma.paymentRefund.findFirst({ where: { id: refund.id, clientId: event.clientId } });
      if (saved?.providerReference !== entity.refundId) continue;
      if (!['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.status)) throw new ServiceUnavailableException('Refund verification pending.');
      return true;
    }
    return false;
  }
  private savedProvider(name: string): PaymentProvider {
    if (name === 'CASHFREE') return this.cashfree;
    if (name === 'MOCK' && this.mock) return this.mock;
    throw new ConflictException('The saved refund provider is unsupported; support review is required.');
  }
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 12000,
        });
      } catch (error) {
        if (
          retryablePaymentTransaction(error) &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  private async pendingState(refund: PaymentRefund, status: string) {
    await this.prisma.paymentRefund.updateMany({ where: { id: refund.id, clientId: refund.clientId, status: { not: 'SUCCESS' } }, data: { status } });
    return this.prisma.paymentRefund.findFirstOrThrow({ where: { id: refund.id, clientId: refund.clientId } });
  }
  private view(refund: PaymentRefund) {
    return {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
      origin: refund.origin,
      externalReference: refund.externalReference,
      paymentId: refund.paymentId,
      amount: refund.amount.toFixed(2),
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      treatment: refund.treatment,
      requestedAt: refund.requestedAt,
      completedAt: refund.completedAt,
    };
  }
  private async source(clientId: string, riderId: string, paymentId: string) {
    const [checkout, autopay] = await Promise.all([
      this.prisma.paymentCollectionRequest.findFirst({
        include: { razorpayPenaltyOrder: true, riderPayment: { select: { refundedAmount: true } } },
        where: {
          clientId,
          riderId,
          riderPaymentId: paymentId,
          status: 'SUCCESS',
          depositTransactionId: null,
        },
      }),
      this.prisma.paymentTransaction.findFirst({
        where: {
          clientId,
          riderId,
          riderPaymentId: paymentId,
          status: 'SUCCESS',
        },
        include: { mandate: true, riderPayment: { select: { refundedAmount: true } } },
      }),
    ]);
    if (checkout?.collectionType === 'TOP_UP') throw new ConflictException('Wallet top-ups are non-refundable.');
    if (checkout?.provider === 'RAZORPAY') {
      if (!this.razorpay || !checkout.razorpayPenaltyOrder?.configurationVersionId || !checkout.providerPaymentId || !checkout.providerOrderId)
        throw new ConflictException('Razorpay refund source requires support review.');
      return { kind: 'RAZORPAY', provider: 'RAZORPAY', paymentId: checkout.providerPaymentId, orderId: checkout.providerOrderId,
        configurationVersionId: checkout.razorpayPenaltyOrder.configurationVersionId, amount: checkout.amount, currency: checkout.currency, refundedAmount: checkout.riderPayment?.refundedAmount ?? new Prisma.Decimal(0) } satisfies RazorpayRefundSource;
    }
    if (checkout?.providerOrderId)
      return {
        kind: 'CHECKOUT' as const,
        orderId: checkout.providerOrderId,
        provider: checkout.provider,
        configurationVersionId: checkout.configurationVersionId,
      };
    if (autopay?.provider === 'RAZORPAY') {
      if (!this.razorpay || !autopay.configurationVersionId || !autopay.gatewayPaymentId || !autopay.providerOrderId)
        throw new ConflictException('Razorpay AutoPay refund source requires support review.');
      return { kind: 'RAZORPAY', provider: 'RAZORPAY', paymentId: autopay.gatewayPaymentId, orderId: autopay.providerOrderId,
        configurationVersionId: autopay.configurationVersionId, amount: autopay.amount, currency: autopay.currency, refundedAmount: autopay.riderPayment?.refundedAmount ?? new Prisma.Decimal(0) } satisfies RazorpayRefundSource;
    }
    if (autopay?.providerReference)
      return {
        kind: 'AUTOPAY' as const,
        mandateId: autopay.mandate.providerMandateId,
        paymentId: autopay.providerPaymentId,
        providerReference: autopay.providerReference,
        provider: autopay.provider,
        configurationVersionId: autopay.configurationVersionId,
      };
    throw new ConflictException(
      'Provider payment cannot be refunded automatically; review its source.',
    );
  }
  async adoptExternal(clientId: string, riderId: string, paymentId: string, actorId: string, reference: string, reason: string, treatment: 'UNALLOCATED_RETURN' | 'PAYMENT_REVERSAL') {
    const source = await this.source(clientId, riderId, paymentId);
    if (source.kind !== 'RAZORPAY' || !this.razorpay) throw new ConflictException('EXTERNAL_REFUND_PROVIDER_UNSUPPORTED');
    const existing = await this.prisma.paymentRefund.findFirst({ where: { clientId, provider: source.provider, OR: [{ externalReference: reference }, { providerReference: reference }] } });
    if (existing) {
      if (existing.paymentId !== paymentId || existing.riderId !== riderId || existing.treatment !== treatment) throw new ConflictException('EXTERNAL_REFUND_ALREADY_LINKED');
      return this.verify(clientId, riderId, existing.id);
    }
    const observed = await this.razorpay.external(clientId, reference, source);
    if (observed.receipt && await this.prisma.paymentRefund.findFirst({ where: { id: observed.receipt, clientId } }))
      throw new ConflictException('REFUND_ALREADY_REQUESTED_VERIFY_ORIGINAL');
    const amount = observed.amount;
    return this.request(clientId, riderId, paymentId, actorId, `external:${reference}`, reason, amount, treatment, reference);
  }
  async request(
    clientId: string,
    riderId: string,
    paymentId: string,
    actorId: string,
    key: string,
    reason: string,
    requestedAmount?: string,
    treatment: 'UNALLOCATED_RETURN' | 'PAYMENT_REVERSAL' = 'UNALLOCATED_RETURN',
    externalReference?: string,
  ) {
    if (!['UNALLOCATED_RETURN', 'PAYMENT_REVERSAL'].includes(treatment))
      throw new BadRequestException('INVALID_REFUND_TREATMENT');
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('Idempotency-Key is required.');
    if (!reason?.trim() || reason.length > 500)
      throw new BadRequestException(
        'Refund reason is required (maximum 500 characters).',
      );
    if (requestedAmount && !/^[1-9]\d*(\.\d{1,2})?$/.test(requestedAmount))
      throw new BadRequestException('Invalid refund amount.');
    const source = await this.source(clientId, riderId, paymentId);
    const provider = source.kind === 'RAZORPAY' ? null : (source.provider === 'CASHFREE' ? await this.cashfree.forClient(clientId, source.configurationVersionId ?? null) : this.savedProvider(source.provider));
    let created = false;
    let refund: PaymentRefund;
    try {
      refund = await this.serializable(async (tx) => {
        const previous = await tx.paymentRefund.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (
            previous.paymentId !== paymentId ||
            previous.riderId !== riderId ||
            previous.reason !== reason.trim() ||
            previous.treatment !== treatment ||
            (previous.externalReference ?? undefined) !== externalReference ||
            (requestedAmount && !previous.amount.eq(requestedAmount))
          )
            throw new ConflictException(
              'Refund key belongs to another payment.',
            );
          return previous;
        }
        const payment = await tx.riderPayment.findFirst({
          where: { id: paymentId, clientId, riderId },
        });
        if (!payment) throw new NotFoundException('Payment not found.');
        await tx.$queryRaw`SELECT id FROM "RiderPayment" WHERE id = ${paymentId} AND "clientId" = ${clientId} FOR UPDATE`;
        if (payment.status !== 'CONFIRMED')
          throw new ConflictException(
            'Only a confirmed payment can be refunded.',
          );
        const amount = requestedAmount
          ? new Prisma.Decimal(requestedAmount)
          : payment.amount.minus(payment.refundedAmount);
        const reserved = await tx.paymentRefund.aggregate({
          where: {
            clientId,
            paymentId,
            status: {
              in: ['CREATING', 'UNKNOWN', 'PENDING', 'PROCESSING', 'SUCCESS'],
            },
          },
          _sum: { amount: true },
        });
        const successful =
          (
            await tx.paymentRefund.aggregate({
              where: { clientId, paymentId, status: 'SUCCESS' },
              _sum: { amount: true },
            })
          )._sum.amount ?? new Prisma.Decimal(0);
        if (
          amount.lte(0) ||
          amount.gt(
            refundableAmount(
              payment.amount,
              payment.refundedAmount,
              successful,
              reserved._sum.amount ?? new Prisma.Decimal(0),
            ),
          )
        )
          throw new ConflictException('REFUND_AMOUNT_EXCEEDS_AVAILABLE');
        if (
          treatment === 'PAYMENT_REVERSAL' &&
          (!amount.eq(payment.amount) || payment.refundedAmount.gt(0))
        )
          throw new ConflictException('PAYMENT_REVERSAL_REQUIRES_FULL_REFUND');
        if (
          treatment === 'UNALLOCATED_RETURN' &&
          amount.gt(payment.unallocatedAmount)
        )
          throw new ConflictException('REFUND_REQUIRES_UNALLOCATED_PAYMENT');
        if (
          await tx.settlementRefundRequest.count({
            where: {
              clientId,
              paymentId,
              status: 'REQUESTED',
              destinationType: 'MANUAL_BANK_TRANSFER',
            },
          })
        )
          throw new ConflictException('PAYMENT_REFUND_ALREADY_RESERVED');
        const [number] = await tx.$queryRaw<
          Array<{ value: bigint }>
        >`SELECT nextval('"PaymentRefund_number_seq"') AS value`;
        const refundNumber = `EVR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${number.value.toString().padStart(6, '0')}`;
        const result = await tx.paymentRefund.create({
          data: {
            clientId,
            riderId,
            paymentId,
            refundNumber,
            amount,
            currency: payment.currency,
            reason: reason.trim(),
            treatment,
            provider: source.provider,
            origin: externalReference ? 'EXTERNAL' : 'INTERNAL',
            externalReference,
            providerReference: externalReference,
            providerRefundId: `EVSEYE_REF_${randomUUID().replaceAll('-', '')}`,
            idempotencyKey: key,
            requestedById: actorId,
            status: 'CREATING',
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: externalReference ? 'EXTERNAL_REFUND_ADOPTED' : 'PAYMENT_REFUND_REQUESTED',
            entityType: 'PaymentRefund',
            entityId: result.id,
            newData: {
              paymentId,
              amount: amount.toFixed(2),
              reason: reason.trim(),
              externalReference: externalReference ?? null,
              treatment,
            },
          },
        });
        created = true;
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'A refund already exists for this payment.',
        );
      throw error;
    }
    if (!created)
      return refund.status === 'CREATING' || refund.status === 'UNKNOWN'
        ? this.verify(clientId, riderId, refund.id)
        : this.view(refund);
    if (externalReference) return this.verify(clientId, riderId, refund.id);
    let result: RefundResult;
    try {
      result =
        source.kind === 'RAZORPAY'
          ? await this.razorpay!.observe(refund, source, true)
          : source.kind === 'CHECKOUT'
          ? await provider!.createCheckoutRefund({
              orderId: source.orderId,
              refundId: refund.providerRefundId,
              amount: refund.amount.toFixed(2),
              note: refund.reason,
              idempotencyKey: refund.id,
            })
          : await provider!.createRefund({
              providerMandateId: source.mandateId,
              providerPaymentId: source.paymentId,
              providerRefundId: refund.providerRefundId,
              providerPaymentReference: source.providerReference,
              amount: refund.amount.toFixed(2),
              idempotencyKey: refund.id,
              note: refund.reason,
            });
    } catch (error) {
      const known =
        error instanceof ProviderRequestError &&
        error.category === 'INVALID_REQUEST';
      await this.pendingState(refund, known ? 'FAILED' : 'UNKNOWN');
      if (known)
        throw new BadRequestException('Provider rejected the refund request.');
      throw new ServiceUnavailableException(
        'Refund state is uncertain; verify before retrying.',
      );
    }
    if (result.providerRefundId !== refund.providerRefundId)
      throw new ConflictException('Provider refund identity mismatch.');
    if ('gatewayRefundId' in result && typeof result.gatewayRefundId === 'string')
      await this.prisma.paymentRefund.update({ where: { id: refund.id }, data: { providerReference: result.gatewayRefundId } });
    if (result.status === 'SUCCESS')
      return this.verify(clientId, riderId, refund.id);
    const updated = await this.pendingState(refund, result.status);
    return this.view(updated);
  }
  async verify(clientId: string, riderId: string, refundId: string) {
    const refund = await this.prisma.paymentRefund.findFirst({
      where: { id: refundId, clientId, riderId },
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status === 'SUCCESS') return this.view(refund);
    const source = await this.source(clientId, riderId, refund.paymentId);
    if (source.provider !== refund.provider) throw new ConflictException('REFUND_PROVIDER_MISMATCH');
    const provider = source.kind === 'RAZORPAY' ? null : (refund.provider === 'CASHFREE' ? await this.cashfree.forClient(clientId, source.configurationVersionId ?? null) : this.savedProvider(refund.provider));
    const result =
      source.kind === 'RAZORPAY'
        ? await this.razorpay!.observe(refund, source)
        : source.kind === 'CHECKOUT'
        ? await provider!.fetchCheckoutRefund(
            source.orderId,
            refund.providerRefundId,
          )
        : await provider!.fetchRefund(
            source.mandateId,
            refund.providerRefundId,
          );
    if (result.providerRefundId !== refund.providerRefundId)
      throw new ConflictException('Provider refund identity mismatch.');
    if ('gatewayRefundId' in result && typeof result.gatewayRefundId === 'string')
      await this.prisma.paymentRefund.update({ where: { id: refund.id }, data: { providerReference: result.gatewayRefundId } });
    if (
      result.status === 'SUCCESS' &&
      (!result.amount ||
        !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(result.amount) ||
        !new Prisma.Decimal(result.amount).eq(refund.amount) ||
        result.currency !== refund.currency)
    )
      throw new ConflictException('PROVIDER_REFUND_AMOUNT_MISMATCH');
    if (result.status !== 'SUCCESS') {
      const updated = await this.pendingState(refund, result.status);
      return this.view(updated);
    }
    const wallet = source.kind === 'RAZORPAY' ? await this.wallets?.ensure(clientId, riderId, 'SYSTEM') : null;
    if (source.kind === 'RAZORPAY' && !wallet) throw new ConflictException('REFUND_WALLET_UNAVAILABLE');
    return this.view(
      await this.serializable(async (tx) => {
        if (wallet) await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${wallet.id} FOR UPDATE`;
        const current = await tx.paymentRefund.findUniqueOrThrow({
          where: { id: refund.id },
        });
        if (current.status === 'SUCCESS') return current;
        const receipt = await this.payments.confirmProviderRefundInTransaction(tx, {
          clientId,
          riderId,
          paymentId: current.paymentId,
          refundId: current.id,
          amount: current.amount,
          actorId: current.requestedById,
          reason: current.reason,
          treatment: current.treatment,
        });
        if (source.kind === 'RAZORPAY' && 'totalRefundedPaise' in result && receipt.refundedAmount.mul(100).eq(Number(result.totalRefundedPaise))) {
          await tx.paymentCollectionRequest.updateMany({ where: { clientId, riderPaymentId: current.paymentId, failureCode: 'EXTERNAL_REFUND_REQUIRES_REVIEW' }, data: { failureCode: null } });
          await tx.razorpayPenaltyCapture.updateMany({ where: { providerPaymentId: source.paymentId, order: { collection: { clientId, riderPaymentId: current.paymentId } }, reason: 'EXTERNAL_REFUND_REQUIRES_REVIEW' }, data: { status: 'SETTLED', reason: null } });
          await tx.paymentTransaction.updateMany({ where: { clientId, riderPaymentId: current.paymentId, failureCode: 'EXTERNAL_REFUND_REQUIRES_REVIEW' }, data: { failureCode: null } });
          await tx.razorpayAutoPayCapture.updateMany({ where: { providerPaymentId: source.paymentId, transaction: { clientId, riderPaymentId: current.paymentId }, reason: 'EXTERNAL_REFUND_REQUIRES_REVIEW' }, data: { status: 'OBSERVED', reason: null } });
        }
        if (wallet) {
          const accounts = await tx.walletAccount.findMany({ where: { clientId, walletId: wallet.id } });
          const clearing = accounts.find(a => a.accountType === 'CLEARING');
          const provider = accounts.find(a => a.accountType === 'PROVIDER_CLEARING');
          if (!clearing || !provider) throw new ConflictException('WALLET_ACCOUNT_NOT_FOUND');
          const amount = current.amount.toFixed(2);
          await this.wallets!.postInTransaction(tx, { clientId, walletId: wallet.id, actorId: current.requestedById,
            type: 'REVERSAL', amount, currency: current.currency, description: `Verified provider refund ${current.id}`,
            idempotencyKey: `provider:refund:${current.id}`, referenceType: 'PAYMENT_REFUND', referenceId: current.id,
            entries: [{ accountId: provider.id, entryType: 'DEBIT', amount }, { accountId: clearing.id, entryType: 'CREDIT', amount }] });
        }
        return tx.paymentRefund.update({
          where: { id: current.id },
          data: { status: 'SUCCESS', completedAt: new Date() },
        });
      }),
    );
  }
  async list(clientId: string, riderId: string) {
    return this.prisma.paymentRefund.findMany({
      where: { clientId, riderId },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }
  async webhook(
    rawBody: Buffer,
    timestamp: string,
    signature: string,
    rail: 'CHECKOUT' | 'SUBSCRIPTION' = 'CHECKOUT',
  ) {
    let payload: { type?: unknown; data?: { refund?: { refund_id?: unknown } } };
    try { payload = JSON.parse(rawBody.toString()); } catch { throw new BadRequestException('INVALID_REFUND_WEBHOOK'); }
    const refundId = payload?.data?.refund?.refund_id;
    if (
      typeof payload?.type !== 'string' ||
      !payload.type.includes('REFUND') ||
      typeof refundId !== 'string' ||
      !refundId
    )
      throw new BadRequestException('INVALID_REFUND_WEBHOOK');
    const hash = createHash('sha256').update(rawBody).digest('hex');
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { providerRefundId: refundId },
    });
    let gateway = this.cashfree;
    if (refund) {
      if (refund.provider !== 'CASHFREE') throw new BadRequestException('REFUND_WEBHOOK_PROVIDER_MISMATCH');
      const source = await this.source(
        refund.clientId,
        refund.riderId,
        refund.paymentId,
      );
      gateway = await this.cashfree.forClient(refund.clientId, source.configurationVersionId ?? null);
      if (
        (rail === 'CHECKOUT' && source.kind !== 'CHECKOUT') ||
        (rail === 'SUBSCRIPTION' && source.kind !== 'AUTOPAY')
      )
        throw new BadRequestException('REFUND_WEBHOOK_SOURCE_MISMATCH');
    }
    if (rail === 'CHECKOUT') gateway.verifyCheckoutWebhook(rawBody, timestamp, signature);
    else gateway.verifyWebhook(rawBody, timestamp, signature);
    const event = await this.prisma.paymentProviderEvent.upsert({
      where: {
        provider_eventKey: { provider: 'CASHFREE', eventKey: `refund:${hash}` },
      },
      create: {
        provider: 'CASHFREE',
        eventKey: `refund:${hash}`,
        eventType: payload.type,
        payloadHash: hash,
        clientId: refund?.clientId,
        configurationVersionId: gateway.configurationVersionId,
        status: refund ? 'RECEIVED' : 'FAILED',
        failureReason: refund ? undefined : 'UNKNOWN_REFUND',
      },
      update: {},
    });
    if (!refund) return { accepted: true, reviewRequired: true };
    if (event.status === 'PROCESSED')
      return { accepted: true, duplicate: true };
    try {
      const result = await this.verify(
        refund.clientId,
        refund.riderId,
        refund.id,
      );
      if (!['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.status))
        return { accepted: true, pending: true };
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          failureReason: null,
        },
      });
      return { accepted: true };
    } catch (error) {
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', failureReason: 'REFUND_VERIFICATION_FAILED' },
      });
      throw error;
    }
  }
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingRefunds() {
    if (!this.automation) return;
    const pending = await this.prisma.$queryRaw<Array<{ id: string; clientId: string; riderId: string; aged: boolean }>>`
      SELECT r.id, r."clientId", r."riderId", r."requestedAt" < NOW()-INTERVAL '24 hours' AS aged
      FROM "PaymentRefund" r LEFT JOIN "PaymentAutomationJob" j ON j.key='refund:'||r.id
      WHERE r.status IN ('CREATING','UNKNOWN','PENDING','PROCESSING')
        AND (j."nextAttemptAt" IS NULL OR j."nextAttemptAt"<=NOW()) AND (j."leaseUntil" IS NULL OR j."leaseUntil"<NOW())
      ORDER BY r."requestedAt" ASC LIMIT 100`;
    for (const item of pending) await this.automation.run(`refund:${item.id}`, async () => {
      if (item.aged) this.logger.warn(JSON.stringify({ event: 'PAYMENT_REFUND_AGED', refundId: item.id, clientId: item.clientId }));
      return ['SUCCESS', 'FAILED', 'CANCELLED'].includes((await this.verify(item.clientId, item.riderId, item.id)).status);
    });
  }
}
