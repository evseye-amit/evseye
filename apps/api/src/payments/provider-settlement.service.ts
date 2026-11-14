import { Cron, CronExpression } from '@nestjs/schedule';
import { Optional } from '@nestjs/common';
import { PaymentAutomationService } from './payment-automation.service.js';
import { pageResult } from './operations-pagination.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { retryablePaymentTransaction } from './transaction-retry.js';

type StatementItem = {
  kind: 'PAYMENT' | 'REFUND';
  providerReference: string;
  amount: string;
};
export type SettlementImport = {
  provider?: 'CASHFREE' | 'RAZORPAY';
  providerSettlementId: string;
  currency: string;
  grossAmount: string;
  refundAmount: string;
  feeAmount: string;
  taxAmount: string;
  netAmount: string;
  settledAt: string;
  utr?: string;
  items: StatementItem[];
};
const decimal = (value: string, positive = false) => {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
    throw new BadRequestException('INVALID_SETTLEMENT_AMOUNT');
  const amount = new Prisma.Decimal(value);
  if (positive && amount.lte(0))
    throw new BadRequestException('INVALID_SETTLEMENT_AMOUNT');
  return amount;
};

@Injectable()
export class ProviderSettlementService {
  constructor(private readonly db: PrismaService, @Optional() private readonly automation?: PaymentAutomationService) {}

  async importReport(
    clientId: string,
    actorId: string,
    input: SettlementImport,
    provenance?: { configurationVersionId: string },
  ) {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.providerSettlementId !== 'string' ||
      !input.providerSettlementId ||
      input.providerSettlementId.length > 160 ||
      input.currency !== 'INR' ||
      !input.settledAt ||
      Number.isNaN(Date.parse(input.settledAt)) ||
      !Array.isArray(input.items) ||
      input.items.length === 0 ||
      input.items.length > 500 ||
      (input.utr && (typeof input.utr !== 'string' || input.utr.length > 160))
    )
      throw new BadRequestException('INVALID_SETTLEMENT_REPORT');
    const provider = input.provider ?? 'CASHFREE';
    if (!['CASHFREE', 'RAZORPAY'].includes(provider)) throw new BadRequestException('UNSUPPORTED_SETTLEMENT_PROVIDER');
    const gross = decimal(input.grossAmount),
      refunds = decimal(input.refundAmount),
      fees = decimal(input.feeAmount),
      tax = decimal(input.taxAmount),
      net = decimal(input.netAmount);
    if (!gross.minus(refunds).minus(fees).minus(tax).eq(net))
      throw new BadRequestException('SETTLEMENT_TOTAL_MISMATCH');
    const normalized = input.items.map((item) => {
      if (
        !item ||
        !['PAYMENT', 'REFUND'].includes(item.kind) ||
        typeof item.providerReference !== 'string' ||
        !item.providerReference ||
        item.providerReference.length > 160
      )
        throw new BadRequestException('INVALID_SETTLEMENT_ITEM');
      return {
        kind: item.kind,
        providerReference: item.providerReference,
        amount: decimal(item.amount, true),
      };
    });
    const keys = normalized.map(
      (item) => `${item.kind}:${item.providerReference}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('DUPLICATE_SETTLEMENT_ITEM');
    const paymentSum = normalized
      .filter((item) => item.kind === 'PAYMENT')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const refundSum = normalized
      .filter((item) => item.kind === 'REFUND')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    if (!paymentSum.eq(gross) || !refundSum.eq(refunds))
      throw new BadRequestException('SETTLEMENT_ITEM_TOTAL_MISMATCH');
    const canonical = {
      providerSettlementId: input.providerSettlementId,
      currency: input.currency,
      grossAmount: gross.toFixed(2),
      refundAmount: refunds.toFixed(2),
      feeAmount: fees.toFixed(2),
      taxAmount: tax.toFixed(2),
      netAmount: net.toFixed(2),
      settledAt: new Date(input.settledAt).toISOString(),
      utr: input.utr ?? null,
      items: normalized
        .map((item) => ({
          kind: item.kind,
          providerReference: item.providerReference,
          amount: item.amount.toFixed(2),
        }))
        .sort((a, b) =>
          `${a.kind}:${a.providerReference}`.localeCompare(
            `${b.kind}:${b.providerReference}`,
          ),
        ),
    };
    const importHash = createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const existing = await tx.providerSettlement.findUnique({
              where: {
                clientId_provider_providerSettlementId: {
                  clientId,
                  provider,
                  providerSettlementId: input.providerSettlementId,
                },
              },
              include: { items: true },
            });
            if (existing) {
              if (existing.importHash !== importHash)
                throw new ConflictException('SETTLEMENT_IMPORT_CONFLICT');
              if (provenance && existing.configurationVersionId && existing.configurationVersionId !== provenance.configurationVersionId)
                throw new ConflictException('SETTLEMENT_MERCHANT_VERSION_CONFLICT');
              if (provenance && existing.source !== 'GATEWAY_API') {
                await tx.providerSettlement.update({ where: { id: existing.id }, data: { source: 'GATEWAY_API', configurationVersionId: provenance.configurationVersionId } });
                await tx.auditLog.create({ data: { clientId, actorId, action: 'SETTLEMENT_GATEWAY_VERIFIED', entityType: 'ProviderSettlement', entityId: existing.id, newData: { configurationVersionId: provenance.configurationVersionId } } });
                return { ...existing, source: 'GATEWAY_API', configurationVersionId: provenance.configurationVersionId };
              }
              return existing;
            }
            const resolved = [];
            for (const item of normalized) {
              resolved.push({ ...item, ...await this.matchItem(tx, clientId, provider, input.currency, item) });
            }
            const seenLocal = new Set<string>();
            for (const item of resolved) {
              if (!item.localReferenceId) continue;
              const key = `${item.kind}:${item.localReferenceId}`;
              if (seenLocal.has(key)) item.status = 'DUPLICATE_PROVIDER_RECORD';
              seenLocal.add(key);
            }
            const status = resolved.every((item) => item.status === 'MATCHED')
              ? 'REPORT_MATCHED'
              : 'REQUIRES_REVIEW';
            const settlement = await tx.providerSettlement.create({
              data: {
                clientId,
                source: provenance ? 'GATEWAY_API' : 'MANUAL',
                configurationVersionId: provenance?.configurationVersionId,
                provider,
                providerSettlementId: input.providerSettlementId,
                currency: input.currency,
                grossAmount: gross,
                refundAmount: refunds,
                feeAmount: fees,
                taxAmount: tax,
                netAmount: net,
                settledAt: new Date(input.settledAt),
                utr: input.utr,
                importHash,
                status,
                importedById: actorId,
                items: {
                  create: resolved.map((item) => ({
                    kind: item.kind,
                    providerReference: item.providerReference,
                    amount: item.amount,
                    localReferenceId: item.localReferenceId,
                    status: item.status,
                    reviewCode: item.status === 'MATCHED' ? null : item.status,
                  })),
                },
              },
            });
            await tx.auditLog.create({
              data: {
                clientId,
                actorId,
                action: 'PROVIDER_SETTLEMENT_IMPORTED',
                entityType: 'ProviderSettlement',
                entityId: settlement.id,
                newData: {
                  providerSettlementId: input.providerSettlementId,
                  status,
                  itemCount: resolved.length,
                  netAmount: net.toFixed(2),
                },
              },
            });
            return tx.providerSettlement.findUniqueOrThrow({
              where: { id: settlement.id },
              include: { items: true },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20000,
          },
        );
      } catch (error) {
        if (
          retryablePaymentTransaction(error) &&
          attempt < 3
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  private async matchItem(
    tx: Prisma.TransactionClient, clientId: string, provider: string, currency: string,
    item: { kind: string; providerReference: string; amount: Prisma.Decimal },
  ): Promise<{ localReferenceId?: string; status: string }> {
    const candidates: { id: string; amount: Prisma.Decimal; currency: string; successful: boolean }[] = [];
    if (item.kind === 'REFUND') {
      const refunds = await tx.paymentRefund.findMany({ where: { clientId, provider, OR: [{ providerRefundId: item.providerReference }, ...(provider === 'RAZORPAY' ? [{ providerReference: item.providerReference }] : [])] } });
      candidates.push(...refunds.map(row => ({ ...row, successful: row.status === 'SUCCESS' })));
    } else {
      const checkouts = await tx.paymentCollectionRequest.findMany({
        where: { clientId, provider, OR: [
          { providerPaymentId: item.providerReference },
          ...(provider === 'CASHFREE' ? [{ providerOrderId: item.providerReference }] : []),
        ] },
      });
      const debits = await tx.paymentTransaction.findMany({
        where: { clientId, provider, OR: provider === 'RAZORPAY'
          ? [{ gatewayPaymentId: item.providerReference }]
          : [{ providerPaymentId: item.providerReference }, { providerReference: item.providerReference }] },
      });
      if (provider === 'RAZORPAY') {
        const recharges = await tx.walletAutoRecharge.findMany({ where: {
          clientId, providerPaymentId: item.providerReference, mandate: { provider: 'RAZORPAY', clientId },
        } });
        candidates.push(...recharges.map(row => ({ ...row, successful: row.status === 'SUCCESS' && !row.failureCode })));
      }
      candidates.push(...[...checkouts, ...debits].map(row => ({ ...row, successful: row.status === 'SUCCESS' })));
    }
    if (provider === 'RAZORPAY') {
      const captures = await tx.deploymentPaymentCapture.findMany({
        where: { attempt: { clientId, provider },
          ...(item.kind === 'REFUND' ? { providerRefundId: item.providerReference } : { providerPaymentId: item.providerReference }) },
      });
      candidates.push(...captures.map(row => ({
        id: row.id, currency: row.currency,
        amount: new Prisma.Decimal(row.amountPaise.toString()).div(100),
        successful: item.kind === 'REFUND' ? row.status === 'REFUNDED' : ['SETTLED', 'REFUNDED'].includes(row.status),
      })));
    }
    if (candidates.length > 1) return { status: 'AMBIGUOUS_INTERNAL' };
    const local = candidates[0];
    if (!local) return { status: 'MISSING_INTERNAL' };
    return { localReferenceId: local.id, status: local.currency !== currency ? 'CURRENCY_MISMATCH'
      : !local.successful ? 'STATUS_MISMATCH' : !local.amount.eq(item.amount) ? 'AMOUNT_MISMATCH' : 'MATCHED' };
  }

  async rematch(clientId: string, id: string, actorId: string | null) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "ProviderSettlement" WHERE id=${id} AND "clientId"=${clientId} FOR UPDATE`;
          const report = await tx.providerSettlement.findFirst({ where: { id, clientId }, include: { items: true } });
          if (!report) throw new NotFoundException('SETTLEMENT_NOT_FOUND');
          const seen = new Set<string>(); let allMatched = true;
          const changes: Array<{ id: string; from: string; to: string }> = [];
          for (const item of [...report.items].sort((a, b) => a.id.localeCompare(b.id))) {
            const match = await this.matchItem(tx, clientId, report.provider, report.currency, item);
            if (match.localReferenceId) {
              const key = `${item.kind}:${match.localReferenceId}`;
              if (seen.has(key)) match.status = 'DUPLICATE_PROVIDER_RECORD';
              seen.add(key);
            }
            allMatched &&= match.status === 'MATCHED';
            if (item.status !== match.status || item.localReferenceId !== (match.localReferenceId ?? null)) {
              changes.push({ id: item.id, from: item.status, to: match.status });
              await tx.providerSettlementItem.update({ where: { id: item.id }, data: {
                localReferenceId: match.localReferenceId ?? null, status: match.status,
                reviewCode: match.status === 'MATCHED' ? null : match.status,
              } });
            }
          }
          const status = allMatched ? 'REPORT_MATCHED' : 'REQUIRES_REVIEW';
          await tx.providerSettlement.update({ where: { id }, data: { status } });
          if (changes.length || report.status !== status) await tx.auditLog.create({ data: {
            clientId, actorId, action: 'PROVIDER_SETTLEMENT_REMATCHED', entityType: 'ProviderSettlement', entityId: id,
            newData: { previousStatus: report.status, status, changes },
          } });
          return tx.providerSettlement.findFirstOrThrow({ where: { id, clientId }, include: { items: true } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
      } catch (error) { if (retryablePaymentTransaction(error) && attempt < 3) continue; throw error; }
    }
  }
  @Cron(CronExpression.EVERY_5_MINUTES)
  async rematchPending() {
    if (!this.automation) return;
    const reports = await this.db.$queryRaw<Array<{ id: string; clientId: string }>>`
      SELECT s.id, s."clientId" FROM "ProviderSettlement" s LEFT JOIN "PaymentAutomationJob" j ON j.key='settlement:'||s.id
      WHERE s.status='REQUIRES_REVIEW' AND (j."nextAttemptAt" IS NULL OR j."nextAttemptAt"<=NOW())
        AND (j."leaseUntil" IS NULL OR j."leaseUntil"<NOW()) ORDER BY s."createdAt" ASC LIMIT 25`;
    for (const report of reports) await this.automation.run(`settlement:${report.id}`, async () =>
      (await this.rematch(report.clientId, report.id, null)).status === 'REPORT_MATCHED');
  }
  async confirmBank(clientId: string, id: string, actorId: string, input: { amount: string; currency: string; utr: string; creditedAt: string; accountLast4: string; evidenceReference: string }) {
    if (!input || typeof input.utr !== 'string' || !/^[A-Za-z0-9_-]{6,160}$/.test(input.utr) ||
        !/^\d{4}$/.test(input.accountLast4 ?? '') || typeof input.evidenceReference !== 'string' || input.evidenceReference.trim().length < 8 || input.evidenceReference.length > 300 ||
        !Number.isFinite(Date.parse(input.creditedAt)) || Date.parse(input.creditedAt) > Date.now()) throw new BadRequestException('INVALID_BANK_EVIDENCE');
    const amount = decimal(input.amount, true);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ProviderSettlement" WHERE id=${id} AND "clientId"=${clientId} FOR UPDATE`;
      const report = await tx.providerSettlement.findFirst({ where: { id, clientId } });
      if (!report) throw new NotFoundException('SETTLEMENT_NOT_FOUND');
      if (!amount.eq(report.netAmount) || input.currency !== report.currency || (report.utr && report.utr !== input.utr)) throw new ConflictException('BANK_RECEIPT_MISMATCH');
      if (report.bankConfirmedAt) {
        if (report.bankUtr !== input.utr || report.bankAccountLast4 !== input.accountLast4 || report.bankEvidenceReference !== input.evidenceReference.trim() || report.bankCreditedAt?.toISOString() !== new Date(input.creditedAt).toISOString()) throw new ConflictException('BANK_CONFIRMATION_IMMUTABLE');
        return report;
      }
      const updated = await tx.providerSettlement.update({ where: { id }, data: { bankConfirmedAt: new Date(), bankConfirmedById: actorId, bankCreditedAt: new Date(input.creditedAt), bankUtr: input.utr, bankAccountLast4: input.accountLast4, bankEvidenceReference: input.evidenceReference.trim() } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'SETTLEMENT_BANK_CONFIRMED', entityType: 'ProviderSettlement', entityId: id, newData: { amount: amount.toFixed(2), currency: input.currency, utr: input.utr, accountLast4: input.accountLast4, evidenceReference: input.evidenceReference.trim() } } });
      return updated;
    });
  }
  async list(clientId: string, page?: number) {
    const rows = await this.db.providerSettlement.findMany({
      where: { clientId },
      select: {
        id: true,
        provider: true,
        providerSettlementId: true,
        grossAmount: true,
        refundAmount: true,
        feeAmount: true,
        taxAmount: true,
        netAmount: true,
        currency: true,
        utr: true,
        bankConfirmedAt: true,
        source: true,
        configurationVersionId: true,
        settledAt: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
      skip: ((page ?? 1) - 1) * 200, take: page === undefined ? 200 : 201,
    });
    return page === undefined ? rows : pageResult(rows, page, 200);
  }
  async detail(clientId: string, id: string) {
    const row = await this.db.providerSettlement.findFirst({
      where: { clientId, id },
      include: { items: true },
    });
    if (!row) throw new NotFoundException('SETTLEMENT_NOT_FOUND');
    return row;
  }
}
