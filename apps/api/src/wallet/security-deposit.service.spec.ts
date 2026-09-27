import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { depositAccounting } from './security-deposit.service.js';

const d = (value: string) => new Prisma.Decimal(value);
const entry = (
  type: string,
  direction: 'CREDIT' | 'DEBIT',
  amount: string,
) => ({ type, entryType: direction, amount: d(amount) });
describe('wallet security deposit ledger calculation', () => {
  it('tracks partial and completed funding without stored balances', () => {
    const partial = depositAccounting(
      d('3000.00'),
      [entry('SECURITY_DEPOSIT', 'CREDIT', '1000.00')],
      d('0.00'),
    );
    expect(partial.funded.toFixed(2)).toBe('1000.00');
    expect(partial.outstanding.toFixed(2)).toBe('2000.00');
    const completed = depositAccounting(
      d('3000.00'),
      [
        entry('SECURITY_DEPOSIT', 'CREDIT', '1000.00'),
        entry('SECURITY_DEPOSIT', 'CREDIT', '2000.00'),
      ],
      d('0.00'),
    );
    expect(completed.outstanding.toFixed(2)).toBe('0.00');
  });
  it('separates holds from deductions and restores available value on release', () => {
    const entries = [
      entry('SECURITY_DEPOSIT', 'CREDIT', '3000.00'),
      entry('SECURITY_DEPOSIT_DEDUCTION', 'DEBIT', '350.00'),
    ];
    const reserved = depositAccounting(d('3000.00'), entries, d('150.00'));
    expect(reserved.deducted.toFixed(2)).toBe('350.00');
    expect(reserved.refundable.toFixed(2)).toBe('2500.00');
    expect(
      depositAccounting(d('3000.00'), entries, d('0.00')).refundable.toFixed(2),
    ).toBe('2650.00');
  });
  it('accounts for reversal entries without changing the original', () => {
    const result = depositAccounting(
      d('3000.00'),
      [
        entry('SECURITY_DEPOSIT', 'CREDIT', '1000.00'),
        entry('SECURITY_DEPOSIT', 'DEBIT', '1000.00'),
      ],
      d('0.00'),
    );
    expect(result.funded.toFixed(2)).toBe('0.00');
  });
  it('explains a deposit with deductions and an external return', () => {
    const result = depositAccounting(
      d('3000.00'),
      [
        entry('SECURITY_DEPOSIT', 'CREDIT', '3000.00'),
        entry('SECURITY_DEPOSIT_DEDUCTION', 'DEBIT', '800.00'),
        entry('SECURITY_DEPOSIT_REFUND', 'DEBIT', '2200.00'),
      ],
      d('0.00'),
    );
    expect(result.deducted.toFixed(2)).toBe('800.00');
    expect(result.refunded.toFixed(2)).toBe('2200.00');
    expect(result.balance.toFixed(2)).toBe('0.00');
  });
});
