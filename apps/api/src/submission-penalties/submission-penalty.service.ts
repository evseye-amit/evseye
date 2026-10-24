import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  paymentView,
  penaltyPaymentStatus,
  penaltyDebt,
  PENALTY_INVOICE,
  payableStatuses,
} from './penalty-accounting.js';

export async function pendingPenaltySummary(
  db: Prisma.TransactionClient,
  clientId: string,
  riderId: string,
) {
  const where: Prisma.RiderInvoiceWhereInput = {
    clientId,
    riderId,
    invoiceType: PENALTY_INVOICE,
    status: { in: [...payableStatuses] },
    outstandingAmount: { gt: 0 },
  };
  const [groups, requests, count] = await Promise.all([
    db.riderInvoice.groupBy({
      by: ['currency'],
      where,
      _sum: { outstandingAmount: true },
    }),
    db.riderInvoice.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
    }),
    db.riderInvoice.count({ where }),
  ]);
  return {
    pendingCount: count,
    outstanding: groups.map((g) => ({
      currency: g.currency,
      amount: (g._sum.outstandingAmount ?? new Prisma.Decimal(0)).toFixed(2),
    })),
    paymentRequests: requests.map(paymentView),
    listEndpoint: '/api/v1/rider-app/submission-penalties',
    summaryEndpoint: '/api/v1/rider-app/submission-penalties/summary',
    payEndpoint: '/api/v1/rider-app/payments/orders',
    paymentPurpose: 'SUBMISSION_PENALTY',
    partialPaymentAllowed: true,
  };
}

@Injectable()
export class SubmissionPenaltyService {
  constructor(private readonly db: PrismaService) {}
  async rider(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    return rider.id;
  }
  async summary(clientId: string, riderId: string) {
    return this.db.$transaction(async tx => {
      const where: Prisma.RiderInvoiceWhereInput = { clientId, riderId, invoiceType: PENALTY_INVOICE, status: { in: [...payableStatuses, 'PAID'] } };
      const [groups, pendingCount, checkout, autoPay] = await Promise.all([
        tx.riderInvoice.groupBy({ by: ['currency'], where, _sum: { totalAmount: true, paidAmount: true, appliedSettlementCreditAmount: true, outstandingAmount: true } }),
        tx.riderInvoice.count({ where: { ...where, outstandingAmount: { gt: 0 } } }),
        tx.paymentCollectionRequest.findFirst({ where: { clientId, riderId, OR: [{ status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } }, { provider: 'RAZORPAY', status: 'SUCCESS', failureCode: { not: null } }] }, select: { id: true, amount: true, currency: true, status: true, provider: true, providerOrderId: true }, orderBy: { createdAt: 'desc' } }),
        tx.paymentTransaction.findFirst({ where: { clientId, riderId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } }, select: { id: true, amount: true, currency: true, status: true }, orderBy: { createdAt: 'desc' } }),
      ]);
      const totals = groups.map(group => ({ currency: group.currency,
        paymentStatus: penaltyPaymentStatus(group._sum.outstandingAmount ?? new Prisma.Decimal(0)),
        totalAmount: (group._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
        paidAmount: (group._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2),
        settledCreditAmount: (group._sum.appliedSettlementCreditAmount ?? new Prisma.Decimal(0)).toFixed(2),
        outstandingAmount: (group._sum.outstandingAmount ?? new Prisma.Decimal(0)).toFixed(2),
      }));
      const debt = totals.filter(total => new Prisma.Decimal(total.outstandingAmount).gt(0));
      const supported = debt.length === 1 && debt[0].currency === 'INR';
      const active = checkout ?? autoPay;
      return { totals, pendingCount, currency: supported ? 'INR' : null, defaultAmount: supported ? debt[0].outstandingAmount : '0.00',
        minimumPaymentAmount: '1.00', maximumPaymentAmount: supported ? debt[0].outstandingAmount : '0.00', partialPaymentAllowed: supported && new Prisma.Decimal(debt[0].outstandingAmount).gt(1),
        payNowAvailable: supported && new Prisma.Decimal(debt[0].outstandingAmount).gte(1) && !active,
        paymentInProgress: active ? { id: active.id, ...(checkout ? { paymentRequestId: `collection:${checkout.id}` } : {}), source: checkout?.provider === 'RAZORPAY' ? 'RAZORPAY' : checkout ? 'CHECKOUT' : 'AUTOPAY', ...(checkout?.provider === 'RAZORPAY' ? { orderId: checkout.providerOrderId } : {}), status: active.status, amount: active.amount.toFixed(2), currency: active.currency } : null,
        payEndpoint: '/api/v1/rider-app/payments/orders', paymentPurpose: 'SUBMISSION_PENALTY',
        breakdownEndpoint: '/api/v1/rider-app/submission-penalties',
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async list(
    clientId: string,
    riderId: string,
    page: number,
    limit: number,
    all = false,
  ) {
    const where: Prisma.RiderInvoiceWhereInput = {
      clientId,
      riderId,
      invoiceType: PENALTY_INVOICE,
      ...(all
        ? {}
        : {
            status: { in: [...payableStatuses] },
            outstandingAmount: { gt: 0 },
          }),
    };
    const [rows, total] = await Promise.all([
      this.db.riderInvoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.riderInvoice.count({ where }),
    ]);
    return { data: rows.map(paymentView), meta: { page, limit, total } };
  }
  async get(clientId: string, riderId: string, invoiceId: string) {
    const invoice = await this.db.riderInvoice.findFirst({
      where: { id: invoiceId, clientId, riderId, invoiceType: PENALTY_INVOICE },
    });
    if (!invoice)
      throw new NotFoundException('Submission penalty payment not found.');
    return paymentView(invoice);
  }
  private async allocation(
    db: Prisma.TransactionClient,
    clientId: string,
    actor: AuthUser,
    id: string,
  ) {
    const admin = actor.roles.some(
      (r) => r === 'CLIENT_ADMIN' || r === 'OPERATIONS_MANAGER',
    );
    const hubs = admin
      ? []
      : await db.userHub.findMany({
          where: {
            clientId,
            userId: actor.id,
            hub: { clientId, status: 'ACTIVE', deletedAt: null },
          },
          select: { hubId: true },
        });
    const row = await db.allocation.findFirst({
      where: {
        id,
        clientId,
        ...(admin
          ? {}
          : { fleet: { currentHubId: { in: hubs.map((h) => h.hubId) } } }),
      },
    });
    if (!row)
      throw new NotFoundException('Allocation not found in an assigned hub.');
    return row;
  }
  async clearance(clientId: string, actor: AuthUser, allocationId: string) {
    const allocation = await this.allocation(
      this.db,
      clientId,
      actor,
      allocationId,
    );
    const debt = await penaltyDebt(this.db, clientId, allocation.riderId);
    const exception = debt.hasDebt
      ? await this.db.penaltyHandoverException.findUnique({
          where: {
            clientId_allocationId_debtDigest: {
              clientId,
              allocationId,
              debtDigest: debt.digest,
            },
          },
        })
      : null;
    return {
      allocationId,
      riderId: allocation.riderId,
      outstanding: debt.outstanding,
      hasUnpaidPenalties: debt.hasDebt,
      handoverBlocked: debt.hasDebt && (!exception || !!exception.usedAt),
      exception: exception
        ? {
            id: exception.id,
            reason: exception.reason,
            approvedById: exception.approvedById,
            approvedAt: exception.approvedAt,
            usedAt: exception.usedAt,
          }
        : null,
    };
  }
  async approve(
    clientId: string,
    actor: AuthUser,
    allocationId: string,
    reason: string,
  ) {
    if (!actor.roles.includes('CLIENT_ADMIN'))
      throw new ForbiddenException(
        'Only a Client Admin can approve a penalty handover exception.',
      );
    if (
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.trim().length > 500
    )
      throw new BadRequestException(
        'A nonblank exception reason is required (maximum 500 characters).',
      );
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
        const allocation = await this.allocation(
          tx,
          clientId,
          actor,
          allocationId,
        );
        if (
          !['INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING'].includes(
            allocation.status,
          )
        )
          throw new ConflictException(
            'An exception can only be approved for a pending allocation.',
          );
        const admin = await tx.user.findFirst({
          where: {
            id: actor.id,
            clientId,
            role: 'CLIENT_ADMIN',
            isActive: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!admin)
          throw new ForbiddenException('Active Client Admin account required.');
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${allocation.riderId} AND "clientId" = ${clientId} FOR UPDATE`;
        const debt = await penaltyDebt(tx, clientId, allocation.riderId);
        if (!debt.hasDebt)
          throw new ConflictException(
            'No unpaid submission penalties require an exception.',
          );
        const where = {
          clientId_allocationId_debtDigest: {
            clientId,
            allocationId,
            debtDigest: debt.digest,
          },
        };
        const existing = await tx.penaltyHandoverException.findUnique({
          where,
        });
        if (existing) {
          if (existing.reason !== reason.trim() || existing.usedAt)
            throw new ConflictException(
              'This debt exception already exists or was used.',
            );
          return existing;
        }
        const row = await tx.penaltyHandoverException.create({
          data: {
            clientId,
            riderId: allocation.riderId,
            allocationId,
            approvedById: actor.id,
            reason: reason.trim(),
            debtDigest: debt.digest,
            debtSnapshot: debt.snapshot,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: actor.id,
            action: 'PENALTY_HANDOVER_EXCEPTION_APPROVED',
            entityType: 'Allocation',
            entityId: allocationId,
            newData: {
              exceptionId: row.id,
              reason: row.reason,
              outstanding: debt.outstanding,
            },
          },
        });
        return row;
      },
      { timeout: 20000 },
    );
  }
  async submissionStatus(
    clientId: string,
    actor: AuthUser,
    submissionId: string,
  ) {
    const admin = actor.roles.some(
      (r) => r === 'CLIENT_ADMIN' || r === 'OPERATIONS_MANAGER',
    );
    const hubs = admin
      ? []
      : await this.db.userHub.findMany({
          where: {
            clientId,
            userId: actor.id,
            hub: { clientId, status: 'ACTIVE', deletedAt: null },
          },
          select: { hubId: true },
        });
    const submission = await this.db.vehicleSubmission.findFirst({
      where: {
        id: submissionId,
        clientId,
        ...(admin ? {} : { hubId: { in: hubs.map((h) => h.hubId) } }),
      },
      select: { id: true, riderId: true },
    });
    if (!submission)
      throw new NotFoundException('Submission not found in an assigned hub.');
    const invoices = await this.db.riderInvoice.findMany({
      where: {
        clientId,
        riderId: submission.riderId,
        invoiceType: PENALTY_INVOICE,
        charges: { some: { submissionReport: { submissionId, clientId } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      submissionId,
      paymentRequiredToCompleteSubmission: false,
      paymentRequests: invoices.map(paymentView),
    };
  }
}
