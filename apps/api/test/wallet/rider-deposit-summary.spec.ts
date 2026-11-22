import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { riderDepositSummary } from '../../src/wallet/rider-deposit-summary.js';
const D = (n: number) => new Prisma.Decimal(n);
describe('agreement deposit presentation', () => {
  it('keeps paid, refunded, deducted and held amounts separate and excludes reversed movements', async () => {
    const transaction = (id: string, transactionType: string, amount: number, reversalOfTransactionId: string | null = null) => ({ id, transactionType, amount: D(amount), reversalOfTransactionId });
    const findMany = vi.fn().mockResolvedValue([{ id: 'd', status: 'PARTIALLY_REFUNDED', requiredAmount: D(1500), fundedAmount: D(1000), availableAmount: D(900),
      transactions: [transaction('c', 'COLLECTION', 1500), transaction('r', 'REFUND', 500), transaction('x', 'DEDUCTION', 100), transaction('old', 'REFUND', 200), transaction('undo', 'REVERSAL', 200, 'old')],
      refundRequests: [{ amount: D(400) }] }]);
    const result = await riderDepositSummary({ riderDeposit: { findMany } } as never, 'client', 'rider', 'INR');
    expect(result[0]).toMatchObject({ paidAmount: '1500.00', refundedAmount: '500.00', deductedAmount: '100.00', remainingAmount: '900.00', pendingRefundAmount: '400.00', outstandingAmount: '0.00' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client', riderId: 'rider', currency: 'INR' } }));
  });
});
