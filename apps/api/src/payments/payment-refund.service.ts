import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PaymentRefund } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { ProviderRequestError } from './payment-provider.interface.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type RefundResult,
} from './payment-provider.interface.js';

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
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly payments: RiderPaymentsService,
  ) {}
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
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  private view(refund: PaymentRefund) {
    return {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
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
        include: { mandate: true },
      }),
    ]);
    if (checkout?.providerOrderId)
      return {
        kind: 'CHECKOUT' as const,
        orderId: checkout.providerOrderId,
        provider: checkout.provider,
      };
    if (autopay?.providerReference)
      return {
        kind: 'AUTOPAY' as const,
        mandateId: autopay.mandate.providerMandateId,
        paymentId: autopay.providerPaymentId,
        providerReference: autopay.providerReference,
        provider: autopay.provider,
      };
    throw new ConflictException(
      'Provider payment cannot be refunded automatically; review its source.',
    );
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
            action: 'PAYMENT_REFUND_REQUESTED',
            entityType: 'PaymentRefund',
            entityId: result.id,
            newData: {
              paymentId,
              amount: amount.toFixed(2),
              reason: reason.trim(),
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
    let result: RefundResult;
    try {
      result =
        source.kind === 'CHECKOUT'
          ? await this.provider.createCheckoutRefund({
              orderId: source.orderId,
              refundId: refund.providerRefundId,
              amount: refund.amount.toFixed(2),
              note: refund.reason,
              idempotencyKey: refund.id,
            })
          : await this.provider.createRefund({
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
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: { status: known ? 'FAILED' : 'UNKNOWN' },
      });
      if (known)
        throw new BadRequestException('Provider rejected the refund request.');
      throw new ServiceUnavailableException(
        'Refund state is uncertain; verify before retrying.',
      );
    }
    if (result.providerRefundId !== refund.providerRefundId)
      throw new ConflictException('Provider refund identity mismatch.');
    if (result.status === 'SUCCESS')
      return this.verify(clientId, riderId, refund.id);
    const updated = await this.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: { status: result.status },
    });
    return this.view(updated);
  }
  async verify(clientId: string, riderId: string, refundId: string) {
    const refund = await this.prisma.paymentRefund.findFirst({
      where: { id: refundId, clientId, riderId },
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status === 'SUCCESS') return this.view(refund);
    const source = await this.source(clientId, riderId, refund.paymentId);
    const result =
      source.kind === 'CHECKOUT'
        ? await this.provider.fetchCheckoutRefund(
            source.orderId,
            refund.providerRefundId,
          )
        : await this.provider.fetchRefund(
            source.mandateId,
            refund.providerRefundId,
          );
    if (result.providerRefundId !== refund.providerRefundId)
      throw new ConflictException('Provider refund identity mismatch.');
    if (
      result.status === 'SUCCESS' &&
      (!result.amount ||
        !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(result.amount) ||
        !new Prisma.Decimal(result.amount).eq(refund.amount) ||
        result.currency !== refund.currency)
    )
      throw new ConflictException('PROVIDER_REFUND_AMOUNT_MISMATCH');
    if (result.status !== 'SUCCESS') {
      const updated = await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: { status: result.status },
      });
      return this.view(updated);
    }
    return this.view(
      await this.serializable(async (tx) => {
        const current = await tx.paymentRefund.findUniqueOrThrow({
          where: { id: refund.id },
        });
        if (current.status === 'SUCCESS') return current;
        await this.payments.confirmProviderRefundInTransaction(tx, {
          clientId,
          riderId,
          paymentId: current.paymentId,
          refundId: current.id,
          amount: current.amount,
          actorId: current.requestedById,
          reason: current.reason,
          treatment: current.treatment,
        });
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
    const verified =
      rail === 'CHECKOUT'
        ? this.provider.verifyCheckoutWebhook(rawBody, timestamp, signature)
        : this.provider.verifyWebhook(rawBody, timestamp, signature);
    const payload = verified.payload as {
      type?: unknown;
      data?: { refund?: { refund_id?: unknown } };
    };
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
    if (refund) {
      const source = await this.source(
        refund.clientId,
        refund.riderId,
        refund.paymentId,
      );
      if (
        (rail === 'CHECKOUT' && source.kind !== 'CHECKOUT') ||
        (rail === 'SUBSCRIPTION' && source.kind !== 'AUTOPAY')
      )
        throw new BadRequestException('REFUND_WEBHOOK_SOURCE_MISMATCH');
    }
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
  @Cron(CronExpression.EVERY_HOUR)
  async reconcilePendingRefunds() {
    const pending = await this.prisma.paymentRefund.findMany({
      where: {
        status: { in: ['CREATING', 'UNKNOWN', 'PENDING', 'PROCESSING'] },
      },
      select: { id: true, clientId: true, riderId: true },
      orderBy: { requestedAt: 'asc' },
      take: 100,
    });
    for (const item of pending) {
      try {
        await this.verify(item.clientId, item.riderId, item.id);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'refund_reconciliation_failed',
            refundId: item.id,
            clientId: item.clientId,
            reason: error instanceof Error ? error.message : 'UNKNOWN',
          }),
        );
      }
    }
  }
}
