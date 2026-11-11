import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
const round = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, D.ROUND_HALF_UP);

export function billingWindow(
  anchor: Date,
  effectiveAt: Date,
  period: string,
  durationValue?: number,
  durationUnit?: string,
) {
  const unit = period === 'CUSTOM' ? durationUnit?.toUpperCase() : period;
  const count =
    period === 'CUSTOM'
      ? (durationValue ?? 1)
      : period === 'FORTNIGHTLY'
        ? 2
        : period === 'QUARTERLY'
          ? 3
          : 1;
  const advance = (date: Date) => {
    const next = new Date(date);
    if (unit === 'DAILY' || unit === 'DAY' || unit === 'DAYS')
      next.setUTCDate(next.getUTCDate() + count);
    else if (
      unit === 'WEEKLY' ||
      unit === 'WEEK' ||
      unit === 'WEEKS' ||
      unit === 'FORTNIGHTLY'
    )
      next.setUTCDate(next.getUTCDate() + count * 7);
    else if (
      unit === 'MONTHLY' ||
      unit === 'MONTH' ||
      unit === 'MONTHS' ||
      unit === 'QUARTERLY'
    ) {
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + count);
      const last = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(day, last));
    } else throw new Error('UNSUPPORTED_RENTAL_PERIOD');
    return next;
  };
  let start = new Date(anchor);
  let end = advance(start);
  for (let i = 0; end <= effectiveAt && i < 1200; i++) {
    start = end;
    end = advance(start);
  }
  if (effectiveAt < start || effectiveAt >= end)
    throw new Error('INVALID_BILLING_WINDOW');
  return { periodStart: start, periodEnd: end };
}

export function prorateExchange(input: {
  oldAmount: string;
  newAmount: string;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
  mode:
    'NONE' | 'DAILY' | 'HOURLY' | 'CALENDAR_DAY' | 'BILLING_PERIOD_REMAINDER';
  policy:
    | 'NO_PRORATION'
    | 'PRORATE_OLD_ONLY'
    | 'PRORATE_NEW_ONLY'
    | 'PRORATE_BOTH'
    | 'START_NEW_NEXT_BILLING_CYCLE';
  oldPeriodPaid: boolean;
}) {
  const totalMs = input.periodEnd.getTime() - input.periodStart.getTime();
  if (
    totalMs <= 0 ||
    input.effectiveAt < input.periodStart ||
    input.effectiveAt > input.periodEnd
  )
    throw new Error('INVALID_PRORATION_PERIOD');
  let fraction = new D(0);
  if (input.mode === 'HOURLY') {
    const total = Math.ceil(totalMs / 3_600_000);
    const remaining = Math.ceil(
      (input.periodEnd.getTime() - input.effectiveAt.getTime()) / 3_600_000,
    );
    fraction = new D(remaining).div(total);
  } else if (input.mode === 'DAILY' || input.mode === 'CALENDAR_DAY') {
    const total = Math.ceil(totalMs / 86_400_000);
    const remaining = Math.ceil(
      (input.periodEnd.getTime() - input.effectiveAt.getTime()) / 86_400_000,
    );
    fraction = new D(remaining).div(total);
  } else if (input.mode === 'BILLING_PERIOD_REMAINDER') {
    fraction = new D(
      input.periodEnd.getTime() - input.effectiveAt.getTime(),
    ).div(totalMs);
  }
  const oldCredit =
    input.oldPeriodPaid &&
    ['PRORATE_OLD_ONLY', 'PRORATE_BOTH'].includes(input.policy)
      ? round(new D(input.oldAmount).mul(fraction))
      : new D(0);
  const newCharge = ['PRORATE_NEW_ONLY', 'PRORATE_BOTH'].includes(input.policy)
    ? round(new D(input.newAmount).mul(fraction))
    : new D(0);
  return {
    oldCredit: oldCredit.toFixed(2),
    newCharge: newCharge.toFixed(2),
    net: newCharge.minus(oldCredit).toFixed(2),
    fraction: fraction.toString(),
  };
}

export function depositDifference(oldAvailable: string, newRequired: string) {
  const available = new D(oldAvailable);
  const required = new D(newRequired);
  const transfer = D.min(available, required);
  return {
    transfer: transfer.toFixed(2),
    additionalRequired: D.max(new D(0), required.minus(transfer)).toFixed(2),
    excess: D.max(new D(0), available.minus(transfer)).toFixed(2),
  };
}

export function depositDifferenceByType(
  oldByType: Record<string, string>,
  newByType: Record<string, string>,
) {
  const lines = [
    ...new Set([...Object.keys(oldByType), ...Object.keys(newByType)]),
  ]
    .sort()
    .map((type) => ({
      type,
      ...depositDifference(oldByType[type] ?? '0', newByType[type] ?? '0'),
    }));
  return {
    lines,
    transfer: lines
      .reduce((sum, line) => sum.plus(line.transfer), new D(0))
      .toFixed(2),
    additionalRequired: lines
      .reduce((sum, line) => sum.plus(line.additionalRequired), new D(0))
      .toFixed(2),
    excess: lines
      .reduce((sum, line) => sum.plus(line.excess), new D(0))
      .toFixed(2),
  };
}
