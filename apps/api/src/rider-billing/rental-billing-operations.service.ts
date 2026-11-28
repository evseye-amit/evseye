import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingEngineService } from './rider-billing-engine.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { WalletSettlementCoordinator } from '../wallet/wallet-settlement-coordinator.service.js';
import {
  canonicalJson,
  parseSnapshot,
} from '../rider-rate-cards/commercial-snapshot.js';
import {
  rentalBillingEnabled,
  rentalCollectionEnabled,
  rentalClientEnabled,
  rentalPeriod,
  recoveryRequired,
} from './rental-billing-policy.js';

class PreviewRollback extends Error {
  constructor(readonly preview: unknown) {
    super('PREVIEW_ROLLBACK');
  }
}
@Injectable()
export class RentalBillingOperations {
  constructor(
    private readonly db: PrismaService,
    private readonly engine: RiderBillingEngineService,
    private readonly wallet: WalletService,
    private readonly settlement: WalletSettlementCoordinator,
  ) {}
  async audit(clientId: string, page: number) {
    const agreements = await this.db.riderRentalAgreement.findMany({
      where: {
        clientId,
        OR: [{ status: 'ACTIVE' }, { billingSchedule: { status: 'ACTIVE' } }],
      },
      include: { billingSchedule: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * 50,
      take: 51,
    });
    const riderIds = [...new Set(agreements.map((a) => a.riderId))];
    const [riders, profiles, lastRun, tax] = await Promise.all([
      this.db.rider.findMany({
        where: { clientId, id: { in: riderIds } },
        select: { id: true, name: true, mobile: true },
      }),
      this.db.riderPaymentProfile.findMany({
        where: { clientId, riderId: { in: riderIds } },
      }),
      this.db.rentalBillingWorkerRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, finishedAt: true, status: true },
      }),
      this.db.riderTaxProfile.findUnique({
        where: { clientId },
        include: { rules: true },
      }),
    ]);
    const items = await Promise.all(
      agreements.slice(0, 50).map(async (a) => {
        const schedule = a.billingSchedule,
          profile = profiles.find((p) => p.riderId === a.riderId),
          blockers: string[] = [];
        let nextDueAt: Date | null = null;
        if (!schedule) blockers.push('MISSING_SCHEDULE');
        else {
          try {
            const period = rentalPeriod(
              schedule,
              a.terminationEffectiveAt ?? a.terminatedAt ?? a.completedAt,
            );
            nextDueAt = period.dueAt;
            if (period.end > period.start && recoveryRequired(schedule, period))
              blockers.push('HISTORICAL_RECOVERY_REVIEW_REQUIRED');
            if (period.dueAt <= new Date()) blockers.push('BILLING_DUE');
          } catch {
            blockers.push('INVALID_BILLING_POLICY');
          }
          if (schedule.lastError && !blockers.includes(schedule.lastError))
            blockers.push(schedule.lastError);
        }
        if (!profile) blockers.push('MISSING_PAYMENT_PROFILE');
        else if (
          profile.collectionMode !== 'LEDGER_WALLET' &&
          !profile.autoSettleInvoiceFromWallet
        )
          blockers.push('LEDGER_COLLECTION_DISABLED');
        if (profile?.walletSettlementLastError)
          blockers.push(profile.walletSettlementLastError);
        if (!tax?.rules.some((r) => r.chargeType === 'RENTAL'))
          blockers.push('RENTAL_TAX_CONFIGURATION_MISSING');
        const [versions, pending, debit, invoices, ledger, credits] =
          await Promise.all([
            this.db.riderAgreementCommercialVersion.count({
              where: { clientId, agreementId: a.id },
            }),
            this.db.paymentCollectionRequest.count({
              where: {
                clientId,
                riderId: a.riderId,
                status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
              },
            }),
            this.db.paymentTransaction.count({
              where: {
                clientId,
                riderId: a.riderId,
                status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
              },
            }),
            this.db.riderInvoice.aggregate({
              where: {
                clientId,
                agreementId: a.id,
                invoiceType: 'RENTAL',
                status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
              },
              _sum: { outstandingAmount: true },
              _count: true,
            }),
            this.db.riderWallet.findFirst({
              where: { clientId, riderId: a.riderId, currency: a.currency },
            }),
            this.db.riderLedgerEntry.findMany({
              where: {
                clientId,
                riderId: a.riderId,
                agreementId: a.id,
                entryType: 'PAYMENT',
                sourceType: 'RIDER_PAYMENT',
              },
              select: { sourceId: true },
            }),
          ]);
        if (!versions) blockers.push('COMMERCIAL_VERSION_MISSING');
        if (pending || debit) blockers.push('PAYMENT_CONFIRMATION_PENDING');
        const balance = ledger
          ? await this.wallet.balance(clientId, ledger.id)
          : null;
        const due = invoices._sum.outstandingAmount ?? new Prisma.Decimal(0);
        if (!ledger) blockers.push('LEDGER_NOT_INITIALIZED');
        else if (due.gt(balance?.availableBalance ?? 0))
          blockers.push('INSUFFICIENT_AVAILABLE_FUNDS');
        const prepaid = await this.db.riderPayment.aggregate({
          where: {
            clientId,
            riderId: a.riderId,
            id: { in: credits.map((c) => c.sourceId) },
            method: 'DEPLOYMENT',
            status: 'CONFIRMED',
          },
          _sum: { unallocatedAmount: true },
        });
        return {
          agreementId: a.id,
          agreementNumber: a.agreementNumber,
          riderId: a.riderId,
          rider: riders.find((r) => r.id === a.riderId) ?? null,
          currency: a.currency,
          scheduleId: schedule?.id ?? null,
          frequency: schedule?.frequency ?? a.rentalPeriodType,
          timezone: schedule?.timezone ?? 'Asia/Kolkata',
          nextPeriodStart: schedule?.nextPeriodStart ?? null,
          nextDueAt,
          nextAttemptAt: schedule?.nextAttemptAt ?? null,
          lastCollectionAt: profile?.walletSettlementSuccessAt ?? null,
          lastAttemptAt: schedule?.lastAttemptAt ?? null,
          lastSuccessAt: schedule?.lastSuccessAt ?? null,
          failureCount: schedule?.failureCount ?? 0,
          outstandingAmount: due.toFixed(2),
          outstandingInvoices: invoices._count,
          availableBalance: balance?.availableBalance ?? '0.00',
          deploymentCredit: (
            prepaid._sum.unallocatedAmount ?? new Prisma.Decimal(0)
          ).toFixed(2),
          blockers,
        };
      }),
    );
    return {
      items,
      page,
      hasMore: agreements.length > 50,
      lastRun,
      generationEnabled:
        rentalBillingEnabled() && rentalClientEnabled(clientId),
      collectionEnabled:
        rentalCollectionEnabled() && rentalClientEnabled(clientId),
    };
  }
  private async simulate(
    tx: Prisma.TransactionClient,
    clientId: string,
    scheduleId: string,
    actorId: string | null,
  ) {
    const schedule = await tx.riderBillingSchedule.findFirst({
      where: { clientId, id: scheduleId },
    });
    if (!schedule) throw new NotFoundException('BILLING_SCHEDULE_NOT_FOUND');
    const invoice = await this.engine.generateInTransaction(
      tx,
      clientId,
      scheduleId,
      actorId,
      schedule.nextPeriodStart,
    );
    const allocations = await tx.riderPaymentAllocation.findMany({
      where: { clientId, invoiceId: invoice.id, reversedAt: null },
      select: {
        paymentId: true,
        amount: true,
        payment: { select: { method: true } },
      },
    });
    const [rider, agreement] = await Promise.all([
      tx.rider.findFirst({
        where: { clientId, id: schedule.riderId },
        select: { name: true, mobile: true },
      }),
      tx.riderRentalAgreement.findFirstOrThrow({
        where: { clientId, id: schedule.agreementId },
        select: { agreementNumber: true },
      }),
    ]);
    const summary = {
      rider,
      agreementNumber: agreement.agreementNumber,
      scheduleId,
      periodStart: schedule.nextPeriodStart.toISOString(),
      periodEnd: (
        await tx.riderBillingSchedule.findUniqueOrThrow({
          where: { id: scheduleId },
        })
      ).nextPeriodStart.toISOString(),
      currency: invoice.currency,
      totalAmount: invoice.totalAmount.toFixed(2),
      paidAmount: invoice.paidAmount.toFixed(2),
      outstandingAmount: invoice.outstandingAmount.toFixed(2),
      pricingSnapshot: invoice.pricingSnapshot,
      taxAmount: invoice.taxAmount.toFixed(2),
      taxSnapshot: invoice.taxSnapshot,
      creditAmount: invoice.creditAmount.toFixed(2),
      lines: invoice.lines
        .map((l) => ({
          description: l.description,
          type: l.chargeType,
          kind: l.kind,
          amount: l.amount.toFixed(2),
          taxAmount: l.taxAmount?.toFixed(2) ?? null,
          taxSnapshot: l.taxSnapshot,
        }))
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
      payments: allocations
        .map((a) => ({
          paymentId: a.paymentId,
          method: a.payment.method,
          amount: a.amount.toFixed(2),
        }))
        .sort((a, b) => a.paymentId.localeCompare(b.paymentId)),
    };
    const fingerprint = createHash('sha256')
      .update(canonicalJson(summary))
      .digest('hex');
    return { ...summary, fingerprint, invoiceId: invoice.id };
  }
  async preview(clientId: string, scheduleId: string) {
    // The exact engine runs in an ALWAYS-ROLLED-BACK transaction. No financial records survive the preview.
    try {
      await this.db.$transaction(
        async (tx) => {
          throw new PreviewRollback(
            await this.simulate(tx, clientId, scheduleId, null),
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        },
      );
    } catch (error) {
      if (error instanceof PreviewRollback) return error.preview;
      throw error;
    }
    throw new ConflictException('PREVIEW_FAILED');
  }
  async approveRecovery(
    clientId: string,
    scheduleId: string,
    actorId: string,
    periodStart: string,
    fingerprint: string,
  ) {
    if (
      !/^\d{4}-\d\d-\d\dT/.test(periodStart) ||
      Number.isNaN(Date.parse(periodStart)) ||
      !/^[a-f0-9]{64}$/.test(fingerprint)
    )
      throw new BadRequestException('INVALID_RECOVERY_APPROVAL');
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "RiderBillingSchedule" WHERE id=${scheduleId} AND "clientId"=${clientId} FOR UPDATE`;
        const entityId = `${scheduleId}:${periodStart}`;
        const prior = await tx.auditLog.findFirst({
          where: { clientId, action: 'RENTAL_RECOVERY_APPROVED', entityId },
        });
        if (prior) {
          const data = prior.newData as {
            fingerprint: string;
            invoiceId: string;
          };
          if (data.fingerprint !== fingerprint)
            throw new ConflictException('RECOVERY_APPROVAL_CHANGED');
          return { invoiceId: data.invoiceId, alreadyApplied: true };
        }
        const schedule = await tx.riderBillingSchedule.findFirst({
          where: { clientId, id: scheduleId },
        });
        if (!schedule || schedule.nextPeriodStart.toISOString() !== periodStart)
          throw new ConflictException('RECOVERY_PREVIEW_STALE');
        const result = await this.simulate(tx, clientId, scheduleId, actorId);
        if (result.fingerprint !== fingerprint)
          throw new ConflictException('RECOVERY_PREVIEW_STALE');
        await tx.riderBillingSchedule.update({
          where: { id: scheduleId },
          data: {
            lastSuccessAt: new Date(),
            lastError: null,
            failureCount: 0,
            nextAttemptAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'RENTAL_RECOVERY_APPROVED',
            entityType: 'RiderBillingSchedule',
            entityId,
            newData: {
              fingerprint,
              invoiceId: result.invoiceId,
              periodStart: result.periodStart,
              periodEnd: result.periodEnd,
            },
          },
        });
        return { invoiceId: result.invoiceId, alreadyApplied: false };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      },
    );
  }
  async retry(clientId: string, scheduleId: string, actorId: string) {
    const updated = await this.db.riderBillingSchedule.updateMany({
      where: { clientId, id: scheduleId, status: 'ACTIVE' },
      data: { nextAttemptAt: new Date() },
    });
    if (!updated.count)
      throw new NotFoundException('BILLING_SCHEDULE_NOT_FOUND');
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'RENTAL_BILLING_RETRY',
        entityType: 'RiderBillingSchedule',
        entityId: scheduleId,
      },
    });
    return { queued: true };
  }
  async enableCollection(clientId: string, riderId: string, actorId: string) {
    await this.wallet.ensure(clientId, riderId, actorId);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${riderId} AND "clientId"=${clientId} FOR UPDATE`;
      const rider = await tx.rider.findFirst({
        where: { clientId, id: riderId, deletedAt: null },
      });
      if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');
      if (
        (await tx.paymentTransaction.count({
          where: {
            clientId,
            riderId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        })) ||
        (await tx.paymentCollectionRequest.count({
          where: {
            clientId,
            riderId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        }))
      )
        throw new ConflictException('PAYMENT_CONFIRMATION_PENDING');
      const profile = await tx.riderPaymentProfile.findUnique({
        where: { clientId_riderId: { clientId, riderId } },
      });
      if (!profile) throw new ConflictException('PAYMENT_PROFILE_MISSING');
      const updated = await tx.riderPaymentProfile.update({
        where: { id: profile.id },
        data: {
          collectionMode: 'LEDGER_WALLET',
          autoSettleInvoiceFromWallet: true,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'RENTAL_LEDGER_COLLECTION_ENABLED',
          entityType: 'RiderPaymentProfile',
          entityId: updated.id,
          oldData: { collectionMode: profile.collectionMode },
          newData: { collectionMode: updated.collectionMode },
        },
      });
      return { enabled: true };
    });
    return result;
  }
  async repairSchedule(clientId: string, agreementId: string, actorId: string) {
    const agreement = await this.db.riderRentalAgreement.findFirst({
      where: { clientId, id: agreementId },
    });
    if (!agreement) throw new NotFoundException('AGREEMENT_NOT_FOUND');
    if (!agreement.activatedAt)
      throw new ConflictException('ALLOCATION_HANDOVER_REQUIRED');
    const snapshot = parseSnapshot(
      agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    const totals = snapshot.totals as { firstRentalUpfront: string };
    const rental = snapshot.rental as {
      durationValue?: number;
      durationUnit?: string;
    };
    const customDays =
      agreement.rentalPeriodType === 'CUSTOM'
        ? Number(rental.durationValue) *
          (String(rental.durationUnit).toUpperCase().startsWith('WEEK') ? 7 : 1)
        : undefined;
    return this.engine.createSchedule(clientId, agreement.riderId, actorId, {
      agreementId,
      frequency: agreement.rentalPeriodType,
      customDays,
      billingMode: new Prisma.Decimal(totals.firstRentalUpfront).gt(0)
        ? 'PREPAID'
        : 'POSTPAID',
      anchorType: 'VEHICLE_HANDOVER',
      anchorAt: agreement.activatedAt.toISOString(),
      timezone: 'Asia/Kolkata',
    });
  }
  async collect(clientId: string, riderId: string, actorId: string) {
    const wallets = await this.db.riderWallet.findMany({
      where: { clientId, riderId, status: 'ACTIVE' },
    });
    for (const wallet of wallets) await this.settlement.settle(wallet.id);
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'RENTAL_COLLECTION_RETRY',
        entityType: 'Rider',
        entityId: riderId,
      },
    });
    return { checked: wallets.length };
  }
}
