import { describe, expect, it } from 'vitest';
import {
  rentalPeriod,
  recoveryRequired,
  billingRetryDelay,
} from '../../src/rider-billing/rental-billing-policy.js';
const start = new Date('2026-11-22T08:00:00Z');
const schedule = {
  nextPeriodStart: start,
  anchorAt: start,
  frequency: 'DAILY',
  customDays: null,
  timezone: 'Asia/Kolkata',
  billingMode: 'PREPAID',
};
describe('rental due policy', () => {
  it('bills prepaid at handover time and postpaid at the end, not at an arbitrary midnight', () => {
    expect(rentalPeriod(schedule).dueAt).toEqual(start);
    expect(
      rentalPeriod({
        ...schedule,
        billingMode: 'POSTPAID',
      }).dueAt.toISOString(),
    ).toBe('2026-11-23T08:00:00.000Z');
  });
  it('keeps weekly plans weekly and caps termination periods', () => {
    expect(
      rentalPeriod({ ...schedule, frequency: 'WEEKLY' }).end.toISOString(),
    ).toBe('2026-11-29T08:00:00.000Z');
    const cutoff = new Date('2026-11-22T15:00:00Z');
    expect(
      rentalPeriod({ ...schedule, billingMode: 'POSTPAID' }, cutoff).dueAt,
    ).toEqual(cutoff);
  });
  it('requires approval only for periods already due before automatic processing began', () => {
    const period = rentalPeriod(schedule),
      automaticFrom = new Date('2026-11-23T09:00:00Z');
    expect(
      recoveryRequired(
        { automaticFrom, recoveryApprovedThrough: null },
        period,
      ),
    ).toBe(true);
    expect(
      recoveryRequired(
        { automaticFrom: start, recoveryApprovedThrough: null },
        period,
      ),
    ).toBe(false);
    expect(
      recoveryRequired(
        { automaticFrom, recoveryApprovedThrough: period.end },
        period,
      ),
    ).toBe(false);
  });
  it('bounds retries instead of silently reselecting a failing schedule forever', () => {
    expect(billingRetryDelay(0)).toBe(60000);
    expect(billingRetryDelay(30)).toBe(3600000);
  });
});
