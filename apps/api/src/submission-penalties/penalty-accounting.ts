import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  type RiderInvoice,
  type VehicleSubmissionReport,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

type Tx = Prisma.TransactionClient;
export const PENALTY_INVOICE = 'SUBMISSION_PENALTY';
export const payableStatuses = [
  'FINALIZED',
  'PARTIALLY_PAID',
  'OVERDUE',
] as const;
export const paymentView = (invoice: RiderInvoice) => ({
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  currency: invoice.currency,
  totalAmount: invoice.totalAmount.toFixed(2),
  paidAmount: invoice.paidAmount.toFixed(2),
  settledCreditAmount: invoice.appliedSettlementCreditAmount.toFixed(2),
  outstandingAmount: invoice.outstandingAmount.toFixed(2),
  status: invoice.status,
  paymentStatus: invoice.outstandingAmount.lte(0)
    ? 'PAID'
    : invoice.paidAmount.gt(0)
      ? 'PARTIALLY_PAID'
      : 'PENDING',
  breakdown: invoice.pricingSnapshot,
  createdAt: invoice.createdAt,
  payEndpoint: '/api/v1/rider-app/payments/orders',
  paymentPurpose: 'INVOICE',
});

/** A dedicated invoice references the existing debit: it does not post another charge or spendable-wallet movement. */
export async function invoiceSubmissionPenalty(
  tx: Tx,
  clientId: string,
  report: VehicleSubmissionReport,
  chargeId: string,
  actorId: string,
) {
  const charge = await tx.riderCharge.findFirstOrThrow({
    where: {
      id: chargeId,
      clientId,
      referenceType: 'VEHICLE_SUBMISSION_REPORT',
      referenceId: report.id,
    },
  });
  if (charge.invoiceId)
    return tx.riderInvoice.findUniqueOrThrow({
      where: { id: charge.invoiceId },
    });
  const day = new Date(new Date().toISOString().slice(0, 10));
  const now = new Date();
  const invoice = await tx.riderInvoice.create({
    data: {
      clientId,
      riderId: charge.riderId,
      agreementId: charge.agreementId,
      invoiceNumber: `SP-${randomUUID()}`,
      invoiceType: PENALTY_INVOICE,
      sourceKey: `submission-penalty:${report.id}`,
      billingPeriodStart: day,
      billingPeriodEnd: new Date(day.getTime() + 86400000),
      dueDate: day,
      subtotal: charge.amount,
      creditAmount: 0,
      totalAmount: charge.amount,
      outstandingAmount: charge.amount,
      currency: charge.currency,
      status: 'DRAFT',
      issuedAt: now,
      pricingSnapshot: {
        reportId: report.id,
        submissionId: report.submissionId,
        stage: report.stage,
        vehicleId: charge.vehicleId,
        summary: report.summary,
        penalties: report.items,
        totalAmount: charge.amount.toFixed(2),
        currency: charge.currency,
        digest: report.digest,
      },
      lines: {
        create: {
          kind: 'CHARGE',
          sourceId: charge.id,
          chargeType: 'RETURN_PENALTY',
          vehicleId: charge.vehicleId,
          description: charge.description,
          amount: charge.amount,
          currency: charge.currency,
          pricingDetail: report.items as Prisma.InputJsonValue,
        },
      },
    },
  });
  const finalized = await tx.riderInvoice.update({ where: { id: invoice.id }, data: { status: 'FINALIZED', finalizedAt: now } });
  await tx.riderCharge.update({
    where: { id: charge.id },
    data: { invoiceId: invoice.id, status: 'INVOICED' },
  });
  await tx.auditLog.create({
    data: {
      clientId,
      actorId,
      action: 'SUBMISSION_PENALTY_INVOICED',
      entityType: 'RiderInvoice',
      entityId: invoice.id,
      newData: {
        reportId: report.id,
        chargeId: charge.id,
        amount: charge.amount.toFixed(2),
      },
    },
  });
  return finalized;
}

export async function penaltyDebt(tx: Tx, clientId: string, riderId: string) {
  const [invoices, charges] = await Promise.all([
    tx.riderInvoice.findMany({
      where: {
        clientId,
        riderId,
        status: { in: [...payableStatuses] },
        outstandingAmount: { gt: 0 },
        charges: {
          some: {
            clientId,
            riderId,
            chargeType: 'RETURN_PENALTY',
            status: 'INVOICED',
          },
        },
      },
      select: { id: true, currency: true, outstandingAmount: true },
      orderBy: { id: 'asc' },
    }),
    tx.riderCharge.findMany({
      where: {
        clientId,
        riderId,
        chargeType: 'RETURN_PENALTY',
        status: 'OPEN',
      },
      select: { id: true, currency: true, amount: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const snapshot = [
    ...invoices.map((i) => ({
      type: 'INVOICE',
      id: i.id,
      currency: i.currency,
      amount: i.outstandingAmount.toFixed(2),
    })),
    ...charges.map((c) => ({
      type: 'CHARGE',
      id: c.id,
      currency: c.currency,
      amount: c.amount.toFixed(2),
    })),
  ];
  const totals = new Map<string, Prisma.Decimal>();
  for (const item of snapshot)
    totals.set(
      item.currency,
      (totals.get(item.currency) ?? new Prisma.Decimal(0)).plus(item.amount),
    );
  return {
    snapshot,
    digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    outstanding: [...totals].map(([currency, amount]) => ({
      currency,
      amount: amount.toFixed(2),
    })),
    hasDebt: snapshot.length > 0,
  };
}

export async function requirePenaltyClearance(
  tx: Tx,
  clientId: string,
  riderId: string,
  allocationId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
  const debt = await penaltyDebt(tx, clientId, riderId);
  if (!debt.hasDebt) return;
  const approval = await tx.penaltyHandoverException.findUnique({
    where: {
      clientId_allocationId_debtDigest: {
        clientId,
        allocationId,
        debtDigest: debt.digest,
      },
    },
  });
  if (!approval || approval.riderId !== riderId || approval.usedAt)
    throw new ConflictException({
      code: 'UNPAID_SUBMISSION_PENALTIES',
      message:
        'Settle previous submission penalties before scooter handover, or request a Client Admin exception.',
      outstanding: debt.outstanding,
    });
  await tx.penaltyHandoverException.update({
    where: { id: approval.id },
    data: { usedAt: new Date() },
  });
  await tx.auditLog.create({
    data: {
      clientId,
      actorId: approval.approvedById,
      action: 'PENALTY_HANDOVER_EXCEPTION_USED',
      entityType: 'Allocation',
      entityId: allocationId,
      newData: {
        exceptionId: approval.id,
        reason: approval.reason,
        outstanding: debt.outstanding,
      },
    },
  });
}
