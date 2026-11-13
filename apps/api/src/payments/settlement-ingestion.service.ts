import { PaymentAlertService } from './payment-alert.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { RazorpayClient } from './razorpay/razorpay.client.js';
import { RazorpayConfigurationService } from './razorpay/razorpay-configuration.service.js';
import {
  ProviderSettlementService,
  type SettlementImport,
} from './provider-settlement.service.js';
import { CashfreePaymentProvider } from './cashfree/cashfree-payment.provider.js';
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const money = (value: number) => new Prisma.Decimal(value).div(100).toFixed(2);
const reconRow = z.object({
  entity_id: z.string().min(1),
  type: z.enum(['payment', 'refund']),
  amount: minor,
  credit: minor,
  debit: minor,
  fee: minor,
  tax: minor,
  currency: z.literal('INR'),
  settled: z.literal(true),
  on_hold: z.literal(false),
  settlement_id: z.string(),
  settled_at: z.number().int().positive(),
  settlement_utr: z.string().min(1),
});
export function normalizeRazorpaySettlement(
  id: string,
  detail: unknown,
  raw: unknown[],
): SettlementImport {
  const header = z
    .object({
      id: z.literal(id),
      status: z.literal('processed'),
      amount: minor,
      utr: z.string().min(1),
    })
    .parse(detail);
  const rows = raw.map((row) => reconRow.parse(row));
  if (
    !rows.length ||
    rows.some(
      (row) => row.settlement_id !== id || row.settlement_utr !== header.utr,
    )
  )
    throw new ConflictException('SETTLEMENT_IDENTITY_MISMATCH');
  const sum = (fn: (row: z.infer<typeof reconRow>) => number) =>
    rows.reduce((total, row) => total.plus(fn(row)), new Prisma.Decimal(0));
  const net = sum((row) => row.credit - row.debit),
    gross = sum((row) => (row.type === 'payment' ? row.amount : 0)),
    refunds = sum((row) => (row.type === 'refund' ? row.amount : 0)),
    inclusiveFees = sum((row) => row.fee),
    tax = sum((row) => row.tax);
  // Razorpay fees include tax; reconcile credits/debits to independently prove totals.
  if (
    !net.eq(header.amount) ||
    !gross.minus(refunds).minus(inclusiveFees).eq(net) ||
    inclusiveFees.lt(tax)
  )
    throw new ConflictException('SETTLEMENT_TOTAL_MISMATCH');
  return {
    provider: 'RAZORPAY',
    providerSettlementId: id,
    currency: 'INR',
    grossAmount: gross.div(100).toFixed(2),
    refundAmount: refunds.div(100).toFixed(2),
    feeAmount: inclusiveFees.minus(tax).div(100).toFixed(2),
    taxAmount: tax.div(100).toFixed(2),
    netAmount: money(header.amount),
    settledAt: new Date(
      Math.max(...rows.map((row) => row.settled_at)) * 1000,
    ).toISOString(),
    utr: header.utr,
    items: rows.map((row) => ({
      kind: row.type === 'payment' ? 'PAYMENT' : 'REFUND',
      providerReference: row.entity_id,
      amount: money(row.amount),
    })),
  };
}
@Injectable()
export class SettlementIngestionService {
  constructor(
    private readonly razorpay: RazorpayClient,
    private readonly configurations: RazorpayConfigurationService,
    private readonly settlements: ProviderSettlementService,
    private readonly cashfree: CashfreePaymentProvider,
    private readonly db: PrismaService,
    private readonly alerts: PaymentAlertService,
  ) {}
  versions(clientId: string) {
    return this.db.paymentProviderConfigurationVersion.findMany({
      where: { clientId, provider: { in: ['RAZORPAY', 'CASHFREE'] } },
      select: {
        id: true,
        provider: true,
        environment: true,
        version: true,
        merchantAccountId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async ingest(
    clientId: string,
    actorId: string,
    input: {
      provider: string;
      configurationVersionId: string;
      settlementId: string;
      date: string;
    },
  ) {
    if (
      !input ||
      !['RAZORPAY', 'CASHFREE'].includes(input.provider) ||
      typeof input.configurationVersionId !== 'string' ||
      !input.configurationVersionId ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(input.settlementId ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ||
      !Number.isFinite(Date.parse(input.date)) ||
      new Date(input.date).toISOString().slice(0, 10) !== input.date
    )
      throw new BadRequestException('INVALID_SETTLEMENT_FETCH');
    await this.configurations.resolveVersion(
      clientId,
      input.configurationVersionId,
      input.provider,
    );
    try {
      let report: SettlementImport;
      if (input.provider === 'RAZORPAY') {
        const detail = await this.razorpay.settlement(
          input.settlementId,
          clientId,
          input.configurationVersionId,
        );
        const rows: unknown[] = [];
        let complete = false;
        for (let skip = 0; skip < 10000; skip += 100) {
          const page = z
            .object({
              items: z
                .array(
                  z
                    .object({ settlement_id: z.string().nullable().optional() })
                    .passthrough(),
                )
                .max(100),
            })
            .parse(
              await this.razorpay.settlementRecon(
                input.date,
                skip,
                clientId,
                input.configurationVersionId,
              ),
            );
          rows.push(
            ...page.items.filter(
              (row) => row.settlement_id === input.settlementId,
            ),
          );
          if (page.items.length < 100) {
            complete = true;
            break;
          }
        }
        if (!complete) throw new ConflictException('SETTLEMENT_PAGE_LIMIT');
        report = normalizeRazorpaySettlement(input.settlementId, detail, rows);
      } else {
        report = await (
          await this.cashfree.forClient(clientId, input.configurationVersionId)
        ).settlementReport(input.settlementId);
      }
      return await this.settlements.importReport(clientId, actorId, report, {
        configurationVersionId: input.configurationVersionId,
      });
    } catch (error) {
      await this.alerts.raise(
        clientId,
        'SETTLEMENT_INGESTION_FAILED',
        input.settlementId,
      );
      if (error instanceof z.ZodError)
        throw new ConflictException(
          'UNSUPPORTED_GATEWAY_STATEMENT_REQUIRES_REVIEW',
        );
      throw error;
    }
  }
}
