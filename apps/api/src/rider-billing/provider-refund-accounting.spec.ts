import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RiderPaymentsService } from './rider-payments.service.js';

const d = (value: string) => new Prisma.Decimal(value);
const payment = {
  id: 'payment-a',
  clientId: 'client-a',
  riderId: 'rider-a',
  amount: d('1000.00'),
  refundedAmount: d('0.00'),
  unallocatedAmount: d('1000.00'),
  status: 'CONFIRMED',
  currency: 'INR',
};
const input = {
  clientId: 'client-a',
  riderId: 'rider-a',
  paymentId: 'payment-a',
  refundId: 'refund-a',
  amount: d('1000.00'),
  actorId: 'admin-a',
  reason: 'Overpayment',
};

function setup(source = payment) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    riderPayment: {
      findFirst: vi.fn().mockResolvedValue(source),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...source, ...data }),
        ),
    },
    riderLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    riderPaymentAllocation: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return { tx, service: new RiderPaymentsService({} as never) };
}

describe('provider refund accounting treatment', () => {
  it('keeps invoice allocations intact for a full return of unapplied money', async () => {
    const { tx, service } = setup();
    const result = await service.confirmProviderRefundInTransaction(
      tx as never,
      { ...input, treatment: 'UNALLOCATED_RETURN' },
    );
    expect(tx.riderPaymentAllocation.findMany).not.toHaveBeenCalled();
    expect(tx.riderLedgerEntry.create).toHaveBeenCalledOnce();
    expect(result.status).toBe('REFUNDED');
    expect(result.refundedAmount.toFixed(2)).toBe('1000.00');
    expect(result.unallocatedAmount.toFixed(2)).toBe('0.00');
  });
  it('rejects an allocated partial return without an allocation reversal', async () => {
    const { tx, service } = setup({
      ...payment,
      unallocatedAmount: d('100.00'),
    });
    await expect(
      service.confirmProviderRefundInTransaction(tx as never, {
        ...input,
        amount: d('300.00'),
        treatment: 'UNALLOCATED_RETURN',
      }),
    ).rejects.toThrow('REFUND_REQUIRES_UNALLOCATED_PAYMENT');
    expect(tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });
  it('requires an original full amount for an invoice payment reversal', async () => {
    const { tx, service } = setup();
    await expect(
      service.confirmProviderRefundInTransaction(tx as never, {
        ...input,
        amount: d('300.00'),
        treatment: 'PAYMENT_REVERSAL',
      }),
    ).rejects.toThrow('PAYMENT_REVERSAL_REQUIRES_FULL_REFUND');
  });
});
