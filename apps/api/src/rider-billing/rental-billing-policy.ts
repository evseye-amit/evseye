import { nextBillingBoundary } from './billing-cycle.js';
export function rentalPeriod(
  schedule: {
    nextPeriodStart: Date;
    frequency: string;
    timezone: string;
    customDays: number | null;
    anchorAt: Date;
    billingMode: string;
  },
  cutoff?: Date | null,
) {
  const start = schedule.nextPeriodStart;
  const naturalEnd = nextBillingBoundary(
    start,
    schedule.frequency,
    schedule.timezone,
    schedule.customDays,
    schedule.anchorAt,
  );
  const end = cutoff && cutoff < naturalEnd ? cutoff : naturalEnd;
  return {
    start,
    end,
    naturalEnd,
    dueAt: schedule.billingMode === 'POSTPAID' ? end : start,
  };
}
export const rentalBillingEnabled = () =>
  process.env.RENTAL_BILLING_ENABLED !== 'false';
export const rentalCollectionEnabled = () =>
  process.env.RENTAL_COLLECTION_ENABLED !== 'false';
export const rentalClientEnabled = (clientId: string) =>
  !process.env.RENTAL_BILLING_CLIENT_IDS?.trim() ||
  process.env.RENTAL_BILLING_CLIENT_IDS.split(',')
    .map((s) => s.trim())
    .includes(clientId);
export function recoveryRequired(
  schedule: { automaticFrom: Date; recoveryApprovedThrough: Date | null },
  period: { dueAt: Date; end: Date },
) {
  return (
    period.dueAt < schedule.automaticFrom &&
    (!schedule.recoveryApprovedThrough ||
      schedule.recoveryApprovedThrough < period.end)
  );
}
export const billingRetryDelay = (failures: number) =>
  Math.min(3600000, 60000 * 2 ** Math.min(failures, 6));
