import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';
import { CheckoutCollectionService } from './checkout-collection.service.js';
import { PaymentRefundService } from './payment-refund.service.js';
import { WalletBillingService } from '../wallet/wallet-billing.service.js';

export function collectionDate(
  policy: {
    collectionTiming: string;
    beforeDueDays: number;
    collectionHourIst?: number;
    collectionMinuteIst?: number;
  },
  invoice: { issuedAt: Date | null; dueDate: Date },
  now: Date,
): Date {
  const day = invoice.dueDate.getTime();
  const desired =
    policy.collectionTiming === 'ON_INVOICE_ISSUE'
      ? (invoice.issuedAt ?? now)
      : policy.collectionTiming === 'CUSTOM'
        ? new Date(
            day -
              330 * 60000 +
              (policy.collectionHourIst ?? 0) * 3600000 +
              (policy.collectionMinuteIst ?? 0) * 60000,
          )
        : policy.collectionTiming === 'BEFORE_DUE_DATE'
          ? new Date(day - policy.beforeDueDays * 86400000 - 330 * 60000)
          : new Date(day - 330 * 60000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)]),
  );
  let earliest = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1) - 330 * 60000);
  // The Cashfree subscription charge is submitted ahead of collection so its
  // own pre-debit notification can be delivered before the debit date.
  if (earliest.getTime() < now.getTime() + 24 * 3600000)
    earliest = new Date(earliest.getTime() + 86400000);
  return desired.getTime() > earliest.getTime() ? desired : earliest;
}
@Injectable()
export class AutoCollectionService {
  private readonly logger = new Logger(AutoCollectionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly checkout: CheckoutCollectionService,
    private readonly refunds: PaymentRefundService,
    private readonly walletBilling: WalletBillingService,
  ) {}
  async setPolicy(
    clientId: string,
    actorId: string,
    input: {
      enabled: boolean;
      collectionTiming: string;
      beforeDueDays: number;
      collectionHourIst?: number;
      collectionMinuteIst?: number;
      retryEnabled: boolean;
      maximumAttempts: number;
      retryIntervalsDays: number[];
      autoCollectCategories: string[];
      maximumAutoDebit?: string;
      walletFirst?: boolean;
    },
  ) {
    if (
      ![
        'ON_INVOICE_ISSUE',
        'ON_DUE_DATE',
        'BEFORE_DUE_DATE',
        'CUSTOM',
      ].includes(input.collectionTiming) ||
      !Number.isInteger(input.beforeDueDays) ||
      input.beforeDueDays < 0 ||
      input.beforeDueDays > 30 ||
      !Number.isInteger(input.collectionHourIst ?? 0) ||
      (input.collectionHourIst ?? 0) < 0 ||
      (input.collectionHourIst ?? 0) > 23 ||
      !Number.isInteger(input.collectionMinuteIst ?? 0) ||
      (input.collectionMinuteIst ?? 0) < 0 ||
      (input.collectionMinuteIst ?? 0) > 59 ||
      !Number.isInteger(input.maximumAttempts) ||
      input.maximumAttempts < 1 ||
      input.maximumAttempts > 10 ||
      input.retryIntervalsDays.some(
        (day) => !Number.isInteger(day) || day < 1 || day > 30,
      )
    )
      throw new BadRequestException('Invalid collection policy.');
    if (
      input.retryEnabled &&
      input.retryIntervalsDays.length < input.maximumAttempts - 1
    )
      throw new BadRequestException(
        'Retry intervals must cover every additional attempt.',
      );
    const allowed = [
      'RECURRING_RENTAL',
      'RENTAL_ADJUSTMENT',
      'EXCHANGE_FEE',
      'ONBOARDING_FEE',
      'SECURITY_DEPOSIT',
      'DAMAGE',
      'CHALLAN',
      'OTHER',
    ];
    if (
      !input.autoCollectCategories.length ||
      input.autoCollectCategories.some((c) => !allowed.includes(c))
    )
      throw new BadRequestException('Invalid auto-collection categories.');
    const max = input.maximumAutoDebit
      ? new Prisma.Decimal(input.maximumAutoDebit)
      : null;
    if (max && (max.lte(0) || max.decimalPlaces() > 2))
      throw new BadRequestException('Invalid maximum auto debit.');
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.paymentCollectionPolicy.upsert({
        where: { clientId },
        create: {
          clientId,
          enabled: input.enabled,
          collectionTiming: input.collectionTiming,
          beforeDueDays: input.beforeDueDays,
          collectionHourIst: input.collectionHourIst ?? 0,
          collectionMinuteIst: input.collectionMinuteIst ?? 0,
          retryEnabled: input.retryEnabled,
          maximumAttempts: input.maximumAttempts,
          retryIntervalsDays: input.retryIntervalsDays,
          autoCollectCategories: input.autoCollectCategories,
          maximumAutoDebit: max,
          walletFirst: input.walletFirst ?? true,
          updatedById: actorId,
        },
        update: {
          enabled: input.enabled,
          collectionTiming: input.collectionTiming,
          beforeDueDays: input.beforeDueDays,
          collectionHourIst: input.collectionHourIst ?? 0,
          collectionMinuteIst: input.collectionMinuteIst ?? 0,
          retryEnabled: input.retryEnabled,
          maximumAttempts: input.maximumAttempts,
          retryIntervalsDays: input.retryIntervalsDays,
          autoCollectCategories: input.autoCollectCategories,
          maximumAutoDebit: max,
          walletFirst: input.walletFirst ?? true,
          updatedById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'PAYMENT_COLLECTION_POLICY_UPDATED',
          entityType: 'PaymentCollectionPolicy',
          entityId: clientId,
          newData: {
            enabled: policy.enabled,
            collectionTiming: policy.collectionTiming,
            maximumAttempts: policy.maximumAttempts,
          },
        },
      });
      return policy;
    });
  }
  async processDue(limit = 50, now = new Date()) {
    let scheduled = 0;
    let scanned = 0;
    let cursor: string | undefined;
    while (scheduled < limit && scanned < 5000) {
      const invoices = await this.prisma.riderInvoice.findMany({
        where: {
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: 0 },
          issuedAt: { not: null },
        },
        include: { lines: true },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: Math.min(100, 5000 - scanned),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!invoices.length) break;
      cursor = invoices.at(-1)!.id;
      scanned += invoices.length;
      for (const invoice of invoices) {
        if (scheduled >= limit) break;
        const [policy, profile, transactions] = await Promise.all([
          this.prisma.paymentCollectionPolicy.findUnique({
            where: { clientId: invoice.clientId },
          }),
          this.prisma.riderPaymentProfile.findUnique({
            where: {
              clientId_riderId: {
                clientId: invoice.clientId,
                riderId: invoice.riderId,
              },
            },
          }),
          this.prisma.paymentTransaction.findMany({
            where: { clientId: invoice.clientId, invoiceId: invoice.id },
            orderBy: { createdAt: 'asc' },
          }),
        ]);
        if (!policy?.enabled || !profile?.autoPayEnabled) continue;
        const categories = policy.autoCollectCategories as string[];
        const chargeLines = invoice.lines.filter(l => l.kind === 'CHARGE');
        if (
          !chargeLines.length ||
          !chargeLines
            .every((l) =>
              categories.includes(
                l.chargeType === 'RENTAL'
                  ? 'RECURRING_RENTAL'
                  : l.chargeType === 'ONBOARDING_FEE' || l.chargeType === 'SECURITY_DEPOSIT'
                    ? l.chargeType
                    : l.chargeType?.includes('EXCHANGE_FEE')
                      ? 'EXCHANGE_FEE'
                      : l.chargeType === 'DAMAGE' || l.chargeType === 'CHALLAN'
                        ? l.chargeType
                        : 'OTHER',
              ),
            )
        )
          continue;
        if (
          transactions.some((t) =>
            ['CREATING', 'PENDING', 'UNKNOWN', 'SUCCESS'].includes(t.status),
          )
        )
          continue;
        if (
          transactions.length &&
          (!policy.retryEnabled ||
            transactions.length >= policy.maximumAttempts)
        )
          continue;
        if (
          transactions.length &&
          transactions.at(-1)?.retryability !== 'RETRYABLE'
        )
          continue;
        const intervals = policy.retryIntervalsDays as number[];
        const retryAfter = transactions.length
          ? new Date(
              transactions.at(-1)!.updatedAt.getTime() +
                (intervals[transactions.length - 1] ?? 1) * 86400000,
            )
          : null;
        if (retryAfter && now < retryAfter) continue;
        const at = collectionDate(policy, invoice, now);
        if (at.getTime() - now.getTime() > 7 * 86400000) continue;
        const mandate = await this.prisma.paymentMandate.findFirst({
          where: { clientId: invoice.clientId, riderId: invoice.riderId, status: 'ACTIVE', autoDebitEnabled: true, currency: invoice.currency, expiresAt: { gt: at } },
          orderBy: { authorizedAt: 'desc' },
        });
        if (!mandate) {
          await this.actionRequired(invoice.clientId, invoice.riderId, invoice.id, 'MANDATE_NOT_ACTIVE');
          continue;
        }
        const key = `autopay:${invoice.id}:${transactions.length + 1}`;
        try {
          // The wallet service locks both wallet and invoice and calculates the
          // funding waterfall against current balances. The orchestrator then
          // locks and re-reads the remaining invoice amount before reserving it.
          if (policy.walletFirst) {
            await this.walletBilling.settle(invoice.clientId, invoice.id, 'SYSTEM', `autopay:wallet:${invoice.id}:${transactions.length + 1}:${now.toISOString().slice(0, 10)}`);
          }
          const current = await this.prisma.riderInvoice.findFirst({ where: { id: invoice.id, clientId: invoice.clientId } });
          if (!current || current.outstandingAmount.lte(0)) continue;
          if (current.outstandingAmount.gt(mandate.maxAmount)) {
            await this.actionRequired(invoice.clientId, invoice.riderId, invoice.id, 'MANDATE_LIMIT_EXCEEDED');
            continue;
          }
          if (policy.maximumAutoDebit && current.outstandingAmount.gt(policy.maximumAutoDebit)) {
            await this.actionRequired(invoice.clientId, invoice.riderId, invoice.id, 'AUTODEBIT_LIMIT_EXCEEDED');
            continue;
          }
          await this.orchestrator.collect(
            invoice.clientId,
            invoice.riderId,
            invoice.id,
            key,
            at.toISOString(),
          );
          scheduled++;
        } catch (error) {
          this.logger.warn(
            `Auto collection skipped invoice=${invoice.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return { scanned, scheduled };
  }
  private async actionRequired(clientId: string, riderId: string, invoiceId: string, failureCode: string) {
    await this.prisma.autoPayDunningCase.upsert({ where: { clientId_invoiceId: { clientId, invoiceId } }, create: { clientId, riderId, invoiceId, status: 'RIDER_ACTION_REQUIRED', failureCode }, update: { status: 'RIDER_ACTION_REQUIRED', failureCode, nextRetryAt: null } });
  }
  async reconcileDunning(limit = 100, now = new Date()) {
    const cases = await this.prisma.autoPayDunningCase.findMany({ where: { status: { not: 'RESOLVED' } }, take: limit, orderBy: { updatedAt: 'asc' } });
    for (const item of cases) {
      const invoice = await this.prisma.riderInvoice.findFirst({ where: { id: item.invoiceId, clientId: item.clientId, riderId: item.riderId } });
      if (!invoice || invoice.outstandingAmount.lte(0) || invoice.status === 'VOID') {
        await this.prisma.autoPayDunningCase.update({ where: { id: item.id }, data: { status: 'RESOLVED', resolvedAt: now, nextRetryAt: null } });
      }
    }
    return { scanned: cases.length };
  }
  async expireMandates(limit = 100, now = new Date()) {
    const mandates = await this.prisma.paymentMandate.findMany({ where: { status: { in: ['CREATED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'PAUSED'] }, expiresAt: { lte: now } }, take: limit, orderBy: { expiresAt: 'asc' } });
    let expired = 0;
    for (const mandate of mandates) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.paymentMandate.updateMany({ where: { id: mandate.id, clientId: mandate.clientId, status: mandate.status, expiresAt: { lte: now } }, data: { status: 'EXPIRED', autoDebitEnabled: false } });
        if (!changed.count) return;
        await tx.paymentMandateEvent.create({ data: { clientId: mandate.clientId, mandateId: mandate.id, fromStatus: mandate.status, toStatus: 'EXPIRED', source: 'SCHEDULER' } });
        await tx.riderPaymentProfile.updateMany({ where: { clientId: mandate.clientId, riderId: mandate.riderId }, data: { autoPayEnabled: false } });
        await tx.auditLog.create({ data: { clientId: mandate.clientId, actorId: null, action: 'AUTOPAY_MANDATE_EXPIRED', entityType: 'PaymentMandate', entityId: mandate.id } });
        expired++;
      });
    }
    return { expired };
  }
  async reconcileOpen(limit = 50) {
    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        status: { in: ['UNKNOWN', 'PENDING'] },
        scheduledAt: { lt: new Date(Date.now() - 3600000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    let verified = 0;
    for (const transaction of transactions) {
      try {
        await this.orchestrator.verify(
          transaction.clientId,
          transaction.riderId,
          transaction.id,
        );
        verified++;
      } catch (error) {
        this.logger.warn(
          `Payment verification pending transaction=${transaction.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const checkouts = await this.prisma.paymentCollectionRequest.findMany({
      where: {
        status: { in: ['UNKNOWN', 'PENDING'] },
        createdAt: { lt: new Date(Date.now() - 3600000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    for (const request of checkouts) {
      try {
        await this.checkout.verify(
          request.clientId,
          request.riderId,
          request.id,
        );
        verified++;
      } catch (error) {
        this.logger.warn(
          `Checkout verification pending collection=${request.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const refunds = await this.prisma.paymentRefund.findMany({
      where: {
        status: { in: ['UNKNOWN', 'PENDING', 'CREATING'] },
        requestedAt: { lt: new Date(Date.now() - 3600000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    for (const refund of refunds) {
      try {
        await this.refunds.verify(refund.clientId, refund.riderId, refund.id);
        verified++;
      } catch (error) {
        this.logger.warn(
          `Refund verification pending refund=${refund.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const failedEvents = await this.prisma.paymentProviderEvent.findMany({
      where: { status: 'FAILED', collectionRequestId: { not: null } },
      include: { collectionRequest: true },
      orderBy: { receivedAt: 'asc' },
      take: limit,
    });
    for (const event of failedEvents) {
      const request = event.collectionRequest;
      if (!request) continue;
      try {
        const result = await this.checkout.verify(
          request.clientId,
          request.riderId,
          request.id,
        );
        if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.status)) {
          await this.prisma.paymentProviderEvent.update({
            where: { id: event.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
              failureReason: null,
            },
          });
          verified++;
        }
      } catch (error) {
        this.logger.warn(
          `Webhook reconciliation pending event=${event.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      scanned:
        transactions.length +
        checkouts.length +
        refunds.length +
        failedEvents.length,
      verified,
    };
  }
  @Cron(CronExpression.EVERY_HOUR)
  async run() {
    await this.expireMandates();
    await this.reconcileDunning();
    await this.processDue();
    await this.reconcileOpen();
  }
}
