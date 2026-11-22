import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { deploymentBreakdown, deploymentBreakdowns } from '../../src/wallet/deployment-breakdown.js';
const quote = { agreementId: 'a', pricingHash: 'original', currency: 'INR', total: '2500.00', nonRefundableAmount: '1000.00', deposits: [{ id: 'd', amount: '1500.00' }] };
const snapshot = { currency: 'INR', rental: { period: 'WEEKLY' }, totals: { firstRentalUpfront: '800.00', nonRefundableUpfrontAmount: '1000.00' }, recurringCharges: [{ grossAmount: '800.00' }], oneTimeCharges: [{ type: 'ONBOARDING_FEE', grossAmount: '200.00' }] };
describe('deployment payment breakdown', () => {
  it('splits the original paid total without creating additional charges', () => {
    expect(deploymentBreakdown(quote, snapshot, '2500.00', 'INR')).toEqual({ status: 'AVAILABLE', items: [
      { type: 'SECURITY_DEPOSIT', label: 'Security deposit', amount: '1500.00' },
      { type: 'ONBOARDING_FEE', label: 'Onboarding fee', amount: '200.00' },
      { type: 'RENTAL', label: 'Rental plan amount', amount: '800.00', period: 'WEEKLY' },
    ] });
  });
  it('does not invent an upfront rental when the plan bills it later', () => {
    const result = deploymentBreakdown({ ...quote, total: '1700.00', nonRefundableAmount: '200.00' }, { ...snapshot, totals: { firstRentalUpfront: '0.00', nonRefundableUpfrontAmount: '200.00' } }, '1700.00', 'INR');
    expect(result.status).toBe('AVAILABLE'); expect(result.items[2].amount).toBe('0.00');
  });
  it('keeps additional fees visible instead of incorrectly calling them onboarding', () => {
    const result = deploymentBreakdown(quote, { ...snapshot, oneTimeCharges: [{ type: 'ONBOARDING_FEE', grossAmount: '100.00' }, { type: 'SERVICE', grossAmount: '100.00' }] }, '2500.00', 'INR');
    expect(result.items[1].amount).toBe('100.00'); expect(result.items[3].amount).toBe('100.00');
  });
  it.each([null, {}, { ...snapshot, currency: 'USD' }, { ...snapshot, oneTimeCharges: [{ type: 'ONBOARDING_FEE', grossAmount: '999.00' }] }])('refuses missing or inconsistent historical evidence', value => {
    expect(deploymentBreakdown(quote, value, '2500.00', 'INR')).toEqual({ status: 'UNAVAILABLE', items: [] });
  });
  it('resolves the paid pricing hash from a historical version, not current pricing', async () => {
    const tx = { deploymentPayment: { findMany: vi.fn().mockResolvedValue([{ id: 'p', breakdown: quote, amount: new Prisma.Decimal(2500), currency: 'INR' }]) },
      riderRentalAgreement: { findMany: vi.fn().mockResolvedValue([{ id: 'a', pricingHash: 'changed', pricingSnapshot: {} }]) },
      riderAgreementCommercialVersion: { findMany: vi.fn().mockResolvedValue([{ agreementId: 'a', pricingHash: 'original', pricingSnapshot: snapshot }]) } };
    expect((await deploymentBreakdowns(tx as never, 'c', 'r', ['p'])).get('p')?.status).toBe('AVAILABLE');
    expect(tx.riderRentalAgreement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'c', riderId: 'r', id: { in: ['a'] } } }));
    tx.riderAgreementCommercialVersion.findMany.mockResolvedValue([]);
    expect((await deploymentBreakdowns(tx as never, 'c', 'r', ['p'])).get('p')?.status).toBe('UNAVAILABLE');
  });
});
