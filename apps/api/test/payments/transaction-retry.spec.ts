import { describe, expect, it } from 'vitest';
import { retryablePaymentTransaction } from '../../src/payments/transaction-retry.js';
describe('payment transaction retries', () => {
  it.each(['40001', '40P01'])('recognizes PostgreSQL %s in both Prisma transports', code => {
    expect(retryablePaymentTransaction({ code: 'P2010', meta: { code } })).toBe(true);
    expect(retryablePaymentTransaction({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: code } } } })).toBe(true);
  });
  it('does not retry validation, missing tables, uniqueness or network errors', () => {
    expect(retryablePaymentTransaction({ code: 'P2034' })).toBe(true);
    for (const error of [null, new Error('40001'), { code: 'P2002' }, { code: 'P2010', meta: { code: '42P01' } }, { code: 'ECONNRESET' }]) expect(retryablePaymentTransaction(error)).toBe(false);
  });
});
