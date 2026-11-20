import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SettlementImport } from '../provider-settlement.service.js';
const decimal = z
  .union([z.number().finite(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
  .transform((value) => new Prisma.Decimal(value))
  .refine((value) => value.gte(0) && value.decimalPlaces() <= 2);
const rowSchema = z.object({
  event_details: z.object({
    event_type: z.enum(['PAYMENT', 'REFUND']),
    event_status: z.literal('SUCCESS'),
    event_currency: z.literal('INR'),
    event_amount: decimal,
    event_service_charge: decimal,
    event_service_tax: decimal,
    event_settlement_amount: decimal,
    sale_type: z.enum(['CREDIT', 'DEBIT']),
  }),
  payment_details: z.object({ cf_payment_id: z.string().min(1) }),
  refund_details: z
    .array(z.object({ refund_id: z.string().nullable() }))
    .optional(),
  settlement_details: z.object({
    cf_settlement_id: z.string(),
    settlement_date: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value))),
    settlement_utr: z.string().min(1),
  }),
});
export function normalizeCashfreeSettlement(
  id: string,
  raw: unknown[],
): SettlementImport {
  const rows = raw.map((row) => rowSchema.parse(row));
  if (
    !rows.length ||
    rows.some(
      (row) =>
        row.settlement_details.cf_settlement_id !== id ||
        row.settlement_details.settlement_utr !==
          rows[0].settlement_details.settlement_utr,
    )
  )
    throw new ConflictException('SETTLEMENT_IDENTITY_MISMATCH');
  let gross = new Prisma.Decimal(0),
    refunds = new Prisma.Decimal(0),
    fees = new Prisma.Decimal(0),
    tax = new Prisma.Decimal(0),
    net = new Prisma.Decimal(0);
  const items: SettlementImport['items'] = [];
  for (const row of rows) {
    const e = row.event_details,
      payment = e.event_type === 'PAYMENT';
    if (
      (payment && e.sale_type !== 'CREDIT') ||
      (!payment && e.sale_type !== 'DEBIT')
    )
      throw new ConflictException('SETTLEMENT_DIRECTION_MISMATCH');
    if (payment) gross = gross.plus(e.event_amount);
    else refunds = refunds.plus(e.event_amount);
    fees = fees.plus(e.event_service_charge);
    tax = tax.plus(e.event_service_tax);
    net = payment
      ? net.plus(e.event_settlement_amount)
      : net.minus(e.event_settlement_amount);
    const references =
      row.refund_details?.filter((item) => item.refund_id) ?? [];
    if (!payment && references.length !== 1)
      throw new ConflictException('AMBIGUOUS_SETTLEMENT_REFUND');
    items.push({
      kind: e.event_type,
      providerReference: payment
        ? row.payment_details.cf_payment_id
        : references[0].refund_id!,
      amount: e.event_amount.toFixed(2),
    });
  }
  if (!gross.minus(refunds).minus(fees).minus(tax).eq(net))
    throw new ConflictException('SETTLEMENT_TOTAL_MISMATCH');
  return {
    provider: 'CASHFREE',
    providerSettlementId: id,
    currency: 'INR',
    grossAmount: gross.toFixed(2),
    refundAmount: refunds.toFixed(2),
    feeAmount: fees.toFixed(2),
    taxAmount: tax.toFixed(2),
    netAmount: net.toFixed(2),
    settledAt: new Date(
      Math.max(
        ...rows.map((row) =>
          Date.parse(row.settlement_details.settlement_date),
        ),
      ),
    ).toISOString(),
    utr: rows[0].settlement_details.settlement_utr,
    items,
  };
}
