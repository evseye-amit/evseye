import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const PRICING_SNAPSHOT_SCHEMA_VERSION = 1;
const snapshotShape = z.object({
  currency: z.string().length(3),
  effectiveDate: z.iso.date(),
  rateCard: z.object({
    id: z.string(),
    code: z.string(),
    versionId: z.string(),
    version: z.number().int(),
  }),
  rider: z.object({ id: z.string() }),
  vehicle: z.object({ id: z.string() }),
  rental: z.object({ finalAmount: z.string(), period: z.string() }),
  totals: z.object({
    recurringAmount: z.string(),
    payableToday: z.string(),
    refundableDepositAmount: z.string(),
  }),
  deposits: z.array(z.unknown()),
  adjustments: z.array(z.unknown()),
});

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item instanceof Prisma.Decimal) return item.toString();
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function pricingHash(
  clientId: string,
  snapshot: unknown,
  termsHash: string,
  termsVersion: string,
): string {
  const parsed = parseSnapshot(snapshot, PRICING_SNAPSHOT_SCHEMA_VERSION);
  const {
    calculationId: _calculationId,
    calculatedAt: _calculatedAt,
    ...material
  } = parsed;
  return sha256(
    canonicalJson({
      clientId,
      pricingSnapshotSchemaVersion: PRICING_SNAPSHOT_SCHEMA_VERSION,
      snapshot: material,
      termsHash,
      termsVersion,
    }),
  );
}
export function parseSnapshot(
  snapshot: unknown,
  version: number,
): Record<string, unknown> {
  if (
    version !== PRICING_SNAPSHOT_SCHEMA_VERSION ||
    !snapshotShape.safeParse(snapshot).success
  )
    throw new UnprocessableEntityException({
      code: 'COMMERCIAL_OFFER_INTEGRITY_FAILED',
    });
  return snapshot as Record<string, unknown>;
}

export function riderSnapshotView(snapshot: Record<string, unknown>) {
  const vehicle = snapshot.vehicle as {
    modelName?: string | null;
    variantName?: string | null;
  };
  const recurring = snapshot.recurringCharges as {
    type: string;
    grossAmount: string;
  }[];
  const oneTime = snapshot.oneTimeCharges as {
    type: string;
    grossAmount: string;
  }[];
  const deposits = snapshot.deposits as {
    type: string;
    finalRequired: string;
    refundable: boolean;
  }[];
  const usage = snapshot.usageCharges as {
    type: string;
    unit: string;
    rate: string;
  }[];
  return {
    vehicle: {
      modelName: vehicle.modelName ?? null,
      variantName: vehicle.variantName ?? null,
    },
    recurringCharges: recurring.map(({ type, grossAmount }) => ({
      type,
      amount: grossAmount,
    })),
    oneTimeCharges: oneTime.map(({ type, grossAmount }) => ({
      type,
      amount: grossAmount,
    })),
    refundableDeposits: deposits.map(({ type, finalRequired, refundable }) => ({
      type,
      amount: finalRequired,
      refundable,
    })),
    usageCharges: usage.map(({ type, unit, rate }) => ({ type, unit, rate })),
    includedServices: snapshot.includedServices as string[],
  };
}
