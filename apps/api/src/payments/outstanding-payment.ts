import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const PENALTY_PAYMENT = 'SUBMISSION_PENALTY_PAYMENT';
export const outstandingInput = z
  .object({
    scope: z.enum(['ALL', 'SUBMISSION_PENALTY']).default('ALL'),
    amount: z
      .string()
      .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)
      .optional(),
  })
  .strict();
export type OutstandingPaymentInput = {
  scope?: 'ALL' | 'SUBMISSION_PENALTY';
  amount?: string;
};
export function parseOutstandingInput(raw: unknown) {
  const parsed = outstandingInput.safeParse(raw ?? {});
  if (!parsed.success)
    throw new BadRequestException(
      'Provide a valid payment scope and an amount as a decimal string with up to two decimal places.',
    );
  if (
    parsed.data.amount !== undefined &&
    new Prisma.Decimal(parsed.data.amount).lt(1)
  )
    throw new BadRequestException('The minimum partial payment is INR 1.00.');
  return {
    scope: parsed.data.scope,
    requestedAmount:
      parsed.data.amount === undefined
        ? null
        : new Prisma.Decimal(parsed.data.amount).toFixed(2),
  };
}
export const penaltySnapshot = z.object({
  version: z.literal(1),
  scope: z.literal('SUBMISSION_PENALTY'),
  requestedAmount: z.string().nullable(),
  outstandingBeforePayment: z.string(),
  externalPaymentRequested: z.string(),
  allocations: z
    .array(
      z.object({
        invoiceId: z.string(),
        amount: z.string().regex(/^[0-9]+\.\d{2}$/),
      }),
    )
    .min(1),
});
export function readPenaltySnapshot(value: unknown, amount: Prisma.Decimal) {
  const parsed = penaltySnapshot.safeParse(value);
  if (!parsed.success)
    throw new ConflictException('PENALTY_PAYMENT_SNAPSHOT_INVALID');
  const rows = parsed.data.allocations;
  if (
    new Set(rows.map((row) => row.invoiceId)).size !== rows.length ||
    rows.some((row) => new Prisma.Decimal(row.amount).lte(0)) ||
    !rows
      .reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0))
      .eq(amount)
  )
    throw new ConflictException('PENALTY_PAYMENT_SNAPSHOT_INVALID');
  return parsed.data;
}
export function planPenaltyPayment(
  invoices: Array<{ id: string; outstandingAmount: Prisma.Decimal }>,
  amount: Prisma.Decimal,
) {
  let remaining = amount;
  const allocations: Array<{ invoiceId: string; amount: string }> = [];
  for (const invoice of invoices) {
    if (remaining.lte(0)) break;
    const applied = Prisma.Decimal.min(remaining, invoice.outstandingAmount);
    allocations.push({ invoiceId: invoice.id, amount: applied.toFixed(2) });
    remaining = remaining.minus(applied);
  }
  return allocations;
}
