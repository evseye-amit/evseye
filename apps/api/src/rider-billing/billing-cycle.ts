import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
const localParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute, second: value.second };
};
const fromLocal = (parts: ReturnType<typeof localParts>, timezone: string) => {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = localParts(new Date(instant), timezone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    instant += desired - actualUtc;
  }
  const result = new Date(instant);
  const actual = localParts(result, timezone);
  if (Object.keys(parts).some(key => actual[key as keyof typeof actual] !== parts[key as keyof typeof parts])) throw new BadRequestException('Billing anchor is not a valid local time.');
  return result;
};

export function billingLocalDate(value: Date, timezone: string): Date {
  const parts = localParts(value, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
export function nextBillingBoundary(start: Date, frequency: string, timezone: string, customDays?: number | null, anchor?: Date): Date {
  const parts = localParts(start, timezone);
  const count = frequency === 'DAILY' ? 1 : frequency === 'WEEKLY' ? 7 : frequency === 'FORTNIGHTLY' ? 14 : frequency === 'CUSTOM' ? customDays : null;
  if (frequency === 'MONTHLY') {
    const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
    const last = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
    return fromLocal({ ...parts, year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1, day: Math.min(anchor ? localParts(anchor, timezone).day : parts.day, last) }, timezone);
  }
  if (!count || !Number.isInteger(count) || count < 1 || count > 366) throw new BadRequestException('Invalid billing frequency or custom days.');
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return fromLocal({ ...parts, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timezone);
}

export type CommercialSegment = {
  versionId: string; vehicleId: string; pricingHash: string; amendmentId: string | null;
  start: Date; end: Date; amount: Prisma.Decimal; snapshot: Record<string, unknown>;
};
export function resolveCommercialSegments(versions: readonly { id: string; vehicleId: string; pricingHash: string; amendmentId: string | null; effectiveFrom: Date; effectiveTo: Date | null; billingStartAt: Date | null; recurringAmount: Prisma.Decimal; pricingSnapshot: unknown }[], start: Date, end: Date): CommercialSegment[] {
  const ordered = [...versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const result: CommercialSegment[] = [];
  let cursor = start;
  for (let index = 0; index < ordered.length; index++) {
    const version = ordered[index];
    const nextBillingStart = ordered[index + 1]?.billingStartAt;
    const segmentStart = new Date(Math.max(start.getTime(), version.effectiveFrom.getTime(), version.billingStartAt?.getTime() ?? -Infinity));
    const effectiveEnd = nextBillingStart && version.effectiveTo && nextBillingStart > version.effectiveTo ? nextBillingStart : version.effectiveTo;
    const segmentEnd = new Date(Math.min(end.getTime(), effectiveEnd?.getTime() ?? Infinity));
    if (segmentEnd <= segmentStart) continue;
    if (segmentStart < cursor) throw new ConflictException('COMMERCIAL_VERSION_OVERLAP');
    if (segmentStart > cursor) throw new ConflictException('COMMERCIAL_VERSION_NOT_FOUND_FOR_PERIOD');
    result.push({ versionId: version.id, vehicleId: version.vehicleId, pricingHash: version.pricingHash, amendmentId: version.amendmentId, start: segmentStart, end: segmentEnd, amount: version.recurringAmount, snapshot: version.pricingSnapshot as Record<string, unknown> });
    cursor = segmentEnd;
  }
  if (cursor < end) throw new ConflictException('COMMERCIAL_VERSION_NOT_FOUND_FOR_PERIOD');
  return result;
}
export function proratedAmount(amount: Prisma.Decimal, segmentStart: Date, segmentEnd: Date, periodStart: Date, periodEnd: Date): Prisma.Decimal {
  const denominator = periodEnd.getTime() - periodStart.getTime();
  if (denominator <= 0) throw new BadRequestException('Invalid billing period.');
  return round(amount.mul(segmentEnd.getTime() - segmentStart.getTime()).div(denominator));
}
export function taxForAmount(base: Prisma.Decimal, rule: { taxCode: string; cgstRate: Prisma.Decimal; sgstRate: Prisma.Decimal; igstRate: Prisma.Decimal }) {
  const cgst = round(base.mul(rule.cgstRate).div(100));
  const sgst = round(base.mul(rule.sgstRate).div(100));
  const igst = round(base.mul(rule.igstRate).div(100));
  return { taxCode: rule.taxCode, cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), igst: igst.toFixed(2), cgstRate: rule.cgstRate.toString(), sgstRate: rule.sgstRate.toString(), igstRate: rule.igstRate.toString(), total: cgst.plus(sgst).plus(igst) };
}
