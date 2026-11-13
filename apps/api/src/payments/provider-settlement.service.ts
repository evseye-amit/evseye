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
  constructor(private readonly db: PrismaService) {}

  async importReport(
    clientId: string,
    actorId: string,
    input: SettlementImport,
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
      const refunds = await tx.paymentRefund.findMany({ where: { clientId, provider, providerRefundId: item.providerReference } });
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

  list(clientId: string) {
    return this.db.providerSettlement.findMany({
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
        settledAt: true,
        status: true,
        createdAt: true,
      },
      orderBy: { settledAt: 'desc' },
      take: 200,
    });
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
