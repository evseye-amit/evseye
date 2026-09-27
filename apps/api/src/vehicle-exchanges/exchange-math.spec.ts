import { describe, expect, it } from 'vitest';
import {
  billingWindow,
  depositDifference,
  depositDifferenceByType,
  prorateExchange,
} from './exchange-math.js';

describe('vehicle exchange money', () => {
  it('uses actual deposit availability after deductions', () => {
    expect(depositDifference('900.00', '1500.00')).toEqual({
      transfer: '900.00',
      additionalRequired: '600.00',
      excess: '0.00',
    });
    expect(depositDifference('1700.00', '1500.00')).toEqual({
      transfer: '1500.00',
      additionalRequired: '0.00',
      excess: '200.00',
    });
  });
  it('does not net unrelated vehicle and battery deposit types', () => {
    expect(
      depositDifferenceByType(
        { VEHICLE_SECURITY: '1500.00' },
        { BATTERY_SECURITY: '1500.00' },
      ),
    ).toMatchObject({
      transfer: '0.00',
      additionalRequired: '1500.00',
      excess: '1500.00',
    });
  });
  it('does not credit an unpaid old period', () => {
    expect(
      prorateExchange({
        oldAmount: '1400.00',
        newAmount: '2100.00',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-08'),
        effectiveAt: new Date('2026-09-04'),
        mode: 'DAILY',
        policy: 'PRORATE_BOTH',
        oldPeriodPaid: false,
      }),
    ).toMatchObject({
      oldCredit: '0.00',
      newCharge: '1200.00',
      net: '1200.00',
    });
  });
  it('credits only verified prepaid unused days', () => {
    expect(
      prorateExchange({
        oldAmount: '1400.00',
        newAmount: '2100.00',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-08'),
        effectiveAt: new Date('2026-09-04'),
        mode: 'DAILY',
        policy: 'PRORATE_BOTH',
        oldPeriodPaid: true,
      }),
    ).toMatchObject({
      oldCredit: '800.00',
      newCharge: '1200.00',
      net: '400.00',
    });
  });
  it('uses calendar months instead of a fixed 30 day month', () => {
    const window = billingWindow(
      new Date('2026-02-01'),
      new Date('2026-02-20'),
      'MONTHLY',
    );
    expect(window.periodEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});
