import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { allocateCredits, chargeAmount, positiveDecimal } from './billing-money.js';
const D = (value: string) => new Prisma.Decimal(value);

describe('Rider billing decimal calculations', () => {
  it('rounds charge extension once using decimal arithmetic', () => {
    expect(chargeAmount(D('2.5'), D('100.01')).toFixed(2)).toBe('250.03');
  });
  it('rejects fractional cents and nonpositive values', () => {
    expect(() => positiveDecimal('0.001', 2, 'Amount')).toThrow();
    expect(() => positiveDecimal('0', 2, 'Amount')).toThrow();
    expect(() => positiveDecimal('1e4', 2, 'Amount')).toThrow();
  });
  it('applies credits in order without making payable negative', () => {
    const result = allocateCredits([D('200.00'), D('25.00')], [D('50.00'), D('300.00')]);
    expect(result.subtotal.toFixed(2)).toBe('225.00');
    expect(result.creditAmount.toFixed(2)).toBe('225.00');
    expect(result.totalAmount.toFixed(2)).toBe('0.00');
    expect(result.allocations.map(value => value.toFixed(2))).toEqual(['50.00', '175.00']);
  });
  it('calculates net payable when credit is smaller than charges', () => {
    const result = allocateCredits([D('999.99')], [D('123.45')]);
    expect(result.totalAmount.toFixed(2)).toBe('876.54');
  });
});
