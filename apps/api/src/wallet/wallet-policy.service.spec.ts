import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { defaultPolicy, planFunding, validatePolicy } from './wallet-policy.service.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('wallet funding policy', () => {
  const policy = { ...defaultPolicy, allowRewardUsage: true, maxRewardUsagePercent: d('20.00'), rewardCategories: ['RENTAL'] };
  it('limits rewards to policy percent and excludes deposit from normal funding', () => {
    expect(planFunding(d('1000.00'), 'RENTAL', { reward: d('500.00'), cash: d('600.00') }, policy)).toEqual({
      amount: '1000.00', walletContribution: '800.00', remainingExternalAmount: '200.00',
      funding: [{ source: 'REWARD', amount: '200.00' }, { source: 'CASH', amount: '600.00' }, { source: 'EXTERNAL_PAYMENT', amount: '200.00' }],
    });
  });
  it('rejects rewards for categories absent from the policy', () => {
    expect(planFunding(d('500.00'), 'PENALTY', { reward: d('1000.00'), cash: d('100.00') }, policy).funding).toEqual([
      { source: 'REWARD', amount: '0.00' }, { source: 'CASH', amount: '100.00' }, { source: 'EXTERNAL_PAYMENT', amount: '400.00' },
    ]);
  });
  it('follows configured priority while preserving reward cap', () => {
    const cashFirst = { ...policy, fundingPriority: ['CASH', 'REWARD', 'EXTERNAL_PAYMENT'] };
    expect(planFunding(d('1000.00'), 'RENTAL', { reward: d('500.00'), cash: d('900.00') }, cashFirst).funding).toEqual([
      { source: 'CASH', amount: '900.00' }, { source: 'REWARD', amount: '100.00' }, { source: 'EXTERNAL_PAYMENT', amount: '0.00' },
    ]);
  });
  it('rejects invalid policy limits and priorities', () => {
    expect(() => validatePolicy({ ...policy, maxRewardUsagePercent: d('101.00') })).toThrow();
    expect(() => validatePolicy({ ...policy, fundingPriority: ['REWARD', 'REWARD', 'EXTERNAL_PAYMENT'] })).toThrow();
  });
});
