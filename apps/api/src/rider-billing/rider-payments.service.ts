import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { positiveDecimal, ZERO } from './billing-money.js';

const money = (amount: Prisma.Decimal) => amount.toFixed(2);
@Injectable()
export class RiderPaymentsService {
  constructor(private readonly prisma: PrismaService) {}
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
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
  async confirmProviderPaymentInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      riderId: string;
      amount: Prisma.Decimal;
      currency: string;
      method: string;
      provider: string;
      providerPaymentId: string;
      sourceId: string;
      invoiceId?: string;
      allocate?: boolean;
    },
  ) {
    const { clientId, riderId, amount, currency } = input;
    if (amount.lte(0) || amount.decimalPlaces() > 2)
      throw new BadRequestException('Provider payment amount is invalid.');
    const idempotencyKey = `provider:${input.provider}:${input.sourceId}`;
    const previous = await tx.riderPayment.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
    });
    if (previous) {
      if (
        previous.riderId !== riderId ||
        !previous.amount.eq(amount) ||
        previous.currency !== currency ||
        previous.externalReference !== input.providerPaymentId
      )
        throw new ConflictException('Provider payment identity mismatch.');
      return previous;
    }
    const payment = await tx.riderPayment.create({
      data: {
        clientId,
        riderId,
        amount,
        unallocatedAmount: amount,
        currency,
        method: input.method,
        externalReference: input.providerPaymentId,
        idempotencyKey,
        status: 'CONFIRMED',
        receivedAt: new Date(),
        createdById: 'SYSTEM',
      },
    });
    await tx.riderLedgerEntry.create({
      data: {
        clientId,
        riderId,
        entryType: 'PAYMENT',
        sourceType: 'RIDER_PAYMENT',
        sourceId: payment.id,
        description: `${input.method} payment confirmed`,
        creditAmount: amount,
        currency,
        effectiveAt: payment.receivedAt,
      },
    });
    const invoices =
      input.allocate === false
        ? []
        : await tx.riderInvoice.findMany({
            where: {
              clientId,
              riderId,
              ...(input.invoiceId ? { id: input.invoiceId } : {}),
              status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
              outstandingAmount: { gt: ZERO },
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          });
    let remaining = amount;
    for (const invoice of invoices) {
      if (remaining.lte(0)) break;
      if (invoice.currency !== currency)
        throw new ConflictException('PAYMENT_CURRENCY_MISMATCH');
      const used = Prisma.Decimal.min(remaining, invoice.outstandingAmount);
      const outstanding = invoice.outstandingAmount.minus(used);
      await tx.riderPaymentAllocation.create({
        data: {
          clientId,
          riderId,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: used,
          createdById: 'SYSTEM',
        },
      });
      await tx.riderInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: invoice.paidAmount.plus(used),
          outstandingAmount: outstanding,
          status: outstanding.eq(0)
            ? 'PAID'
            : invoice.status === 'OVERDUE'
              ? 'OVERDUE'
              : 'PARTIALLY_PAID',
          paidAt: outstanding.eq(0) ? new Date() : null,
        },
      });
      remaining = remaining.minus(used);
    }
    if (remaining.lt(amount))
      await tx.riderPayment.update({
        where: { id: payment.id },
        data: { unallocatedAmount: remaining },
      });
    await tx.auditLog.create({
      data: {
        clientId,
        actorId: null,
        action: 'PROVIDER_PAYMENT_CONFIRMED',
        entityType: 'RiderPayment',
        entityId: payment.id,
        newData: {
          provider: input.provider,
          amount: money(amount),
          unallocatedAmount: money(remaining),
        },
      },
    });
    return payment;
  }
  async confirmProviderRefundInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      riderId: string;
      paymentId: string;
      refundId: string;
      amount: Prisma.Decimal;
      actorId: string;
      reason: string;
      treatment?: string;
    },
  ) {
    await tx.$queryRaw`SELECT id FROM "RiderPayment" WHERE id = ${input.paymentId} AND "clientId" = ${input.clientId} FOR UPDATE`;
    const payment = await tx.riderPayment.findFirst({
      where: {
        id: input.paymentId,
        clientId: input.clientId,
        riderId: input.riderId,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    const existing = await tx.riderLedgerEntry.findFirst({
      where: {
        clientId: input.clientId,
        riderId: input.riderId,
        sourceType: 'PAYMENT_REFUND',
        sourceId: input.refundId,
      },
    });
    if (existing) return payment;
    if (
      payment.status !== 'CONFIRMED' ||
      input.amount.lte(0) ||
      input.amount.gt(payment.amount.minus(payment.refundedAmount))
    )
      throw new ConflictException('REFUND_AMOUNT_EXCEEDS_AVAILABLE');
    const full =
      input.treatment === 'PAYMENT_REVERSAL' &&
      input.amount.eq(payment.amount) &&
      payment.refundedAmount.eq(0);
    if (input.treatment === 'PAYMENT_REVERSAL' && !full)
      throw new ConflictException('PAYMENT_REVERSAL_REQUIRES_FULL_REFUND');
    if (!full && input.amount.gt(payment.unallocatedAmount))
      throw new ConflictException('REFUND_REQUIRES_UNALLOCATED_PAYMENT');
    const allocations = full
      ? await tx.riderPaymentAllocation.findMany({
          where: {
            clientId: input.clientId,
            riderId: input.riderId,
            paymentId: payment.id,
            reversedAt: null,
          },
        })
      : [];
    for (const allocation of allocations) {
      await tx.riderPaymentAllocation.update({
        where: { id: allocation.id },
        data: {
          reversedAt: new Date(),
          reversalReason: `Provider refund ${input.refundId}: ${input.reason}`,
        },
      });
      const invoice = await tx.riderInvoice.findUniqueOrThrow({
        where: { id: allocation.invoiceId },
      });
      if (invoice.status !== 'VOID') {
        const paid = invoice.paidAmount.minus(allocation.amount);
        const outstanding = invoice.outstandingAmount.plus(allocation.amount);
        await tx.riderInvoice.update({
          where: { id: allocation.invoiceId },
          data: {
            paidAmount: paid,
            outstandingAmount: outstanding,
            status:
              invoice.status === 'OVERDUE'
                ? 'OVERDUE'
                : paid.eq(0)
                  ? 'FINALIZED'
                  : 'PARTIALLY_PAID',
            paidAt: null,
          },
        });
      }
    }
    await tx.riderLedgerEntry.create({
      data: {
        clientId: input.clientId,
        riderId: input.riderId,
        entryType: 'REVERSAL',
        sourceType: 'PAYMENT_REFUND',
        sourceId: input.refundId,
        description: `Provider payment refund: ${input.reason}`,
        debitAmount: input.amount,
        currency: payment.currency,
        effectiveAt: new Date(),
      },
    });
    const updated = await tx.riderPayment.update({
      where: { id: payment.id },
      data: {
        status: payment.refundedAmount.plus(input.amount).eq(payment.amount)
          ? 'REFUNDED'
          : 'CONFIRMED',
        unallocatedAmount: full
          ? ZERO
          : payment.unallocatedAmount.minus(input.amount),
        refundedAmount: payment.refundedAmount.plus(input.amount),
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: input.clientId,
        actorId: input.actorId,
        action: 'PROVIDER_PAYMENT_REFUNDED',
        entityType: 'RiderPayment',
        entityId: payment.id,
        newData: {
          refundId: input.refundId,
          amount: money(input.amount),
          reason: input.reason,
        },
      },
    });
    return updated;
  }
  async record(
    clientId: string,
    riderId: string,
    actorId: string,
    key: string,
    input: {
      amount: string;
      currency: string;
      method: string;
      externalReference?: string;
      receivedAt?: string;
    },
  ) {
    const amount = positiveDecimal(input.amount, 2, 'Payment amount');
    if (
      ![
        'UPI',
        'BANK_TRANSFER',
        'CASH',
        'CARD',
        'NET_BANKING',
        'MANDATE',
        'WALLET',
        'OTHER',
      ].includes(input.method)
    )
      throw new BadRequestException('Invalid payment method.');
    const receivedAt = input.receivedAt
      ? new Date(input.receivedAt)
      : new Date();
    if (Number.isNaN(receivedAt.getTime()))
      throw new BadRequestException('Invalid receivedAt.');
    try {
      return await this.serializable(async (tx) => {
        const rider = await tx.rider.findFirst({
          where: { id: riderId, clientId, deletedAt: null },
          select: { id: true },
        });
        if (!rider) throw new NotFoundException('Rider not found.');
        const profile = await tx.riderPaymentProfile.findUnique({
          where: { clientId_riderId: { clientId, riderId } },
        });
        if (profile && profile.currency !== input.currency)
          throw new ConflictException('PAYMENT_CURRENCY_MISMATCH');
        const previous = await tx.riderPayment.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (
            previous.riderId !== riderId ||
            !previous.amount.eq(amount) ||
            previous.currency !== input.currency ||
            previous.method !== input.method ||
            previous.externalReference !== (input.externalReference ?? null)
          )
            throw new ConflictException('PAYMENT_ALREADY_RECORDED');
          return previous;
        }
        const payment = await tx.riderPayment.create({
          data: {
            clientId,
            riderId,
            amount,
            unallocatedAmount: amount,
            currency: input.currency,
            method: input.method,
            externalReference: input.externalReference,
            idempotencyKey: key,
            receivedAt,
            createdById: actorId,
          },
        });
        await tx.riderLedgerEntry.create({
          data: {
            clientId,
            riderId,
            entryType: 'PAYMENT',
            sourceType: 'RIDER_PAYMENT',
            sourceId: payment.id,
            description: `${input.method} payment received`,
            creditAmount: amount,
            currency: input.currency,
            effectiveAt: receivedAt,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'RIDER_PAYMENT_RECORDED',
            entityType: 'RiderPayment',
            entityId: payment.id,
            newData: {
              amount: money(amount),
              currency: input.currency,
              method: input.method,
            },
          },
        });
        return payment;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('PAYMENT_ALREADY_RECORDED');
      throw error;
    }
  }
  async allocate(
    clientId: string,
    riderId: string,
    paymentId: string,
    actorId: string,
    input: { policy: string; invoiceId?: string; amount?: string },
  ) {
    if (
      ![
        'OLDEST_DUE_FIRST',
        'OLDEST_INVOICE_FIRST',
        'SPECIFIC_INVOICE',
        'MANUAL',
      ].includes(input.policy)
    )
      throw new BadRequestException('Invalid allocation policy.');
    return this.serializable(async (tx) => {
      const payment = await tx.riderPayment.findFirst({
        where: { id: paymentId, clientId, riderId },
      });
      if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND');
      if (payment.status !== 'CONFIRMED')
        throw new ConflictException('PAYMENT_NOT_CONFIRMED');
      const pendingRefunds = await tx.settlementRefundRequest.aggregate({
        where: {
          clientId,
          paymentId,
          status: 'REQUESTED',
          destinationType: 'MANUAL_BANK_TRANSFER',
        },
        _sum: { amount: true },
      });
      const providerRefunds = await tx.paymentRefund.aggregate({
        where: {
          clientId,
          paymentId,
          status: { in: ['CREATING', 'UNKNOWN', 'PENDING', 'PROCESSING'] },
        },
        _sum: { amount: true },
      });
      const allocatable = payment.unallocatedAmount
        .minus(pendingRefunds._sum.amount ?? ZERO)
        .minus(providerRefunds._sum.amount ?? ZERO);
      let remaining = input.amount
        ? positiveDecimal(input.amount, 2, 'Allocation amount')
        : allocatable;
      if (remaining.gt(allocatable))
        throw new ConflictException('PAYMENT_ALLOCATION_EXCEEDS_PAYMENT');
      const specific =
        input.policy === 'SPECIFIC_INVOICE' || input.policy === 'MANUAL';
      if (specific && !input.invoiceId)
        throw new BadRequestException('invoiceId is required.');
      const invoices = await tx.riderInvoice.findMany({
        where: {
          clientId,
          riderId,
          ...(specific ? { id: input.invoiceId } : {}),
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: ZERO },
        },
        orderBy:
          input.policy === 'OLDEST_INVOICE_FIRST'
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : [{ dueDate: 'asc' }, { id: 'asc' }],
      });
      if (specific && invoices.length === 0)
        throw new NotFoundException('INVOICE_NOT_FOUND');
      const allocations = [];
      for (const invoice of invoices) {
        if (remaining.lte(0)) break;
        if (invoice.currency !== payment.currency)
          throw new ConflictException('PAYMENT_CURRENCY_MISMATCH');
        const amount = Prisma.Decimal.min(remaining, invoice.outstandingAmount);
        const outstanding = invoice.outstandingAmount.minus(amount);
        const paid = invoice.paidAmount.plus(amount);
        const allocation = await tx.riderPaymentAllocation.create({
          data: {
            clientId,
            riderId,
            paymentId,
            invoiceId: invoice.id,
            amount,
            createdById: actorId,
          },
        });
        await tx.riderInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: paid,
            outstandingAmount: outstanding,
            status: outstanding.eq(0)
              ? 'PAID'
              : invoice.status === 'OVERDUE'
                ? 'OVERDUE'
                : 'PARTIALLY_PAID',
            paidAt: outstanding.eq(0) ? new Date() : null,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'RIDER_PAYMENT_ALLOCATED',
            entityType: 'RiderPaymentAllocation',
            entityId: allocation.id,
            newData: { invoiceId: invoice.id, amount: money(amount) },
          },
        });
        allocations.push(allocation);
        remaining = remaining.minus(amount);
      }
      const spent = (
        input.amount
          ? positiveDecimal(input.amount, 2, 'Allocation amount')
          : allocatable
      ).minus(remaining);
      await tx.riderPayment.update({
        where: { id: payment.id },
        data: { unallocatedAmount: payment.unallocatedAmount.minus(spent) },
      });
      return {
        allocations,
        unallocatedAmount: money(payment.unallocatedAmount.minus(spent)),
      };
    });
  }
  async reverseAllocation(
    clientId: string,
    riderId: string,
    allocationId: string,
    actorId: string,
    reason: string,
  ) {
    if (!reason.trim())
      throw new BadRequestException('Reversal reason is required.');
    return this.serializable(async (tx) => {
      const allocation = await tx.riderPaymentAllocation.findFirst({
        where: { id: allocationId, clientId, riderId },
        include: { payment: true, invoice: true },
      });
      if (!allocation) throw new NotFoundException('Allocation not found.');
      if (allocation.reversedAt) return allocation;
      if (allocation.invoice.status === 'VOID')
        throw new ConflictException(
          'Cannot reverse an allocation on a void invoice.',
        );
      const outstanding = allocation.invoice.outstandingAmount.plus(
        allocation.amount,
      );
      const paid = allocation.invoice.paidAmount.minus(allocation.amount);
      await tx.riderInvoice.update({
        where: { id: allocation.invoiceId },
        data: {
          outstandingAmount: outstanding,
          paidAmount: paid,
          status:
            allocation.invoice.status === 'OVERDUE'
              ? 'OVERDUE'
              : paid.eq(0)
                ? 'FINALIZED'
                : 'PARTIALLY_PAID',
          paidAt: null,
        },
      });
      await tx.riderPayment.update({
        where: { id: allocation.paymentId },
        data: {
          unallocatedAmount: allocation.payment.unallocatedAmount.plus(
            allocation.amount,
          ),
        },
      });
      const reversed = await tx.riderPaymentAllocation.update({
        where: { id: allocation.id },
        data: { reversedAt: new Date(), reversalReason: reason },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'RIDER_PAYMENT_ALLOCATION_REVERSED',
          entityType: 'RiderPaymentAllocation',
          entityId: allocation.id,
          newData: { reason, amount: money(allocation.amount) },
        },
      });
      return reversed;
    });
  }
  async history(clientId: string, riderId: string) {
    return this.prisma.riderPayment.findMany({
      where: { clientId, riderId },
      include: {
        allocations: {
          where: { reversedAt: null },
          select: { invoiceId: true, amount: true, createdAt: true },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }
}
