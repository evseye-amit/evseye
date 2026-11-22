import { Prisma } from '@prisma/client';
import { z } from 'zod';

const amount = z.string().regex(/^\d+(\.\d{1,2})?$/);
const quoteSchema = z.object({ agreementId: z.string(), pricingHash: z.string(), currency: z.string(),
  total: amount, nonRefundableAmount: amount, deposits: z.array(z.object({ id: z.string(), amount })) });
const snapshotSchema = z.object({ currency: z.string(), rental: z.object({ period: z.string() }),
  totals: z.object({ firstRentalUpfront: amount, nonRefundableUpfrontAmount: amount }),
  recurringCharges: z.array(z.object({ grossAmount: amount })),
  oneTimeCharges: z.array(z.object({ type: z.string(), grossAmount: amount })) });
export const deploymentQuote = (value: unknown) => quoteSchema.safeParse(value);
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));

export function deploymentBreakdown(rawQuote: unknown, rawSnapshot: unknown, paid: string, currency: string) {
  const quote = quoteSchema.safeParse(rawQuote), snapshot = snapshotSchema.safeParse(rawSnapshot);
  if (!quote.success || !snapshot.success) return { status: 'UNAVAILABLE' as const, items: [] };
  const q = quote.data, s = snapshot.data;
  const deposits = sum(q.deposits.map(line => line.amount));
  const rental = new Prisma.Decimal(s.totals.firstRentalUpfront);
  const onboarding = sum(s.oneTimeCharges.filter(line => line.type === 'ONBOARDING_FEE').map(line => line.grossAmount));
  const other = sum(s.oneTimeCharges.filter(line => line.type !== 'ONBOARDING_FEE').map(line => line.grossAmount));
  const nonRefundable = rental.plus(onboarding).plus(other);
  if (q.currency !== currency || s.currency !== currency || !new Prisma.Decimal(q.total).eq(paid) ||
      !nonRefundable.eq(q.nonRefundableAmount) || !nonRefundable.eq(s.totals.nonRefundableUpfrontAmount) ||
      !deposits.plus(nonRefundable).eq(paid) || (!rental.isZero() && !rental.eq(sum(s.recurringCharges.map(line => line.grossAmount)))))
    return { status: 'UNAVAILABLE' as const, items: [] };
  return { status: 'AVAILABLE' as const, items: [
    { type: 'SECURITY_DEPOSIT', label: 'Security deposit', amount: deposits.toFixed(2) },
    { type: 'ONBOARDING_FEE', label: 'Onboarding fee', amount: onboarding.toFixed(2) },
    { type: 'RENTAL', label: 'Rental plan amount', amount: rental.toFixed(2), period: s.rental.period },
    ...(other.gt(0) ? [{ type: 'OTHER_FEES', label: 'Other upfront fees', amount: other.toFixed(2) }] : []),
  ] };
}

export async function deploymentBreakdowns(tx: Prisma.TransactionClient, clientId: string, riderId: string, ids: string[]) {
  const result = new Map<string, ReturnType<typeof deploymentBreakdown>>();
  if (!ids.length) return result;
  const payments = await tx.deploymentPayment.findMany({ where: { clientId, id: { in: ids }, workflow: { clientId, allocation: { clientId, riderId } } },
    select: { id: true, breakdown: true, amount: true, currency: true } });
  const quotes = payments.flatMap(payment => { const q = deploymentQuote(payment.breakdown); return q.success ? [q.data] : []; });
  const agreementIds = [...new Set(quotes.map(q => q.agreementId))];
  const [agreements, versions] = agreementIds.length ? await Promise.all([
    tx.riderRentalAgreement.findMany({ where: { clientId, riderId, id: { in: agreementIds } }, select: { id: true, pricingHash: true, pricingSnapshot: true } }),
    tx.riderAgreementCommercialVersion.findMany({ where: { clientId, agreementId: { in: agreementIds }, agreement: { clientId, riderId }, pricingHash: { in: quotes.map(q => q.pricingHash) } }, select: { agreementId: true, pricingHash: true, pricingSnapshot: true } }),
  ]) : [[], []];
  const snapshots = new Map([...agreements.map(a => [`${a.id}:${a.pricingHash}`, a.pricingSnapshot] as const), ...versions.map(v => [`${v.agreementId}:${v.pricingHash}`, v.pricingSnapshot] as const)]);
  for (const payment of payments) {
    const q = deploymentQuote(payment.breakdown);
    result.set(payment.id, deploymentBreakdown(payment.breakdown, q.success ? snapshots.get(`${q.data.agreementId}:${q.data.pricingHash}`) : null, payment.amount.toFixed(2), payment.currency));
  }
  return result;
}
