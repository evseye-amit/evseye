import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { depositBalances, money, reconcileDeposit } from './deposit-money.js';

const D = Prisma.Decimal;
describe('deposit accounting', () => {
  it('keeps the accepted waiver out of cash held', () => {
    expect(
      depositBalances({
        requiredAmount: new D('1500'),
        fundedAmount: new D('1500'),
        availableAmount: new D('1500'),
      }),
    ).toEqual({
      required: '1500.00',
      funded: '1500.00',
      available: '1500.00',
      outstanding: '0.00',
      topUpRequired: '0.00',
    });
  });
  it('separates outstanding funding from top-up after a deduction', () => {
    expect(
      depositBalances({
        requiredAmount: new D('2000'),
        fundedAmount: new D('2000'),
        availableAmount: new D('1700'),
      }),
    ).toMatchObject({ outstanding: '0.00', topUpRequired: '300.00' });
  });
  it('reconciles materialized balances against every posted delta', () => {
    const rows = [
      { balanceDelta: new D('1500'), fundingDelta: new D('1500') },
      { balanceDelta: new D('-300'), fundingDelta: new D(0) },
      { balanceDelta: new D('300'), fundingDelta: new D(0) },
      { balanceDelta: new D('-1200'), fundingDelta: new D('-1200') },
    ];
    expect(
      reconcileDeposit(
        { availableAmount: new D('300'), fundedAmount: new D('300') },
        rows,
      ),
    ).toEqual({ available: '300.00', funded: '300.00' });
    expect(() =>
      reconcileDeposit(
        { availableAmount: new D('0'), fundedAmount: new D('300') },
        rows,
      ),
    ).toThrow();
  });
  it('rejects excess precision and negative money', () => {
    expect(() => money('1.001')).toThrow();
    expect(() => money('-1')).toThrow();
  });
});
