import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RiderPaymentsService } from './rider-payments.service.js';

const amount = new Prisma.Decimal('1200.00');
function fixture(invoiceOutstanding: string, previous: unknown = null) {
  const payment = {
    id: 'receipt-1',
    clientId: 'client-1',
    riderId: 'rider-1',
    amount,
    currency: 'INR',
    externalReference: 'cf-123',
    receivedAt: new Date(),
  };
  const invoice = {
    id: 'invoice-1',
    clientId: 'client-1',
    riderId: 'rider-1',
    currency: 'INR',
    status: 'FINALIZED',
    outstandingAmount: new Prisma.Decimal(invoiceOutstanding),
    paidAmount: new Prisma.Decimal('0.00'),
  };
  const tx = {
    riderPayment: {
      findUnique: vi.fn().mockResolvedValue(previous),
      create: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockResolvedValue(payment),
    },
    riderLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    riderInvoice: {
      findMany: vi
        .fn()
        .mockResolvedValue(invoiceOutstanding === '0.00' ? [] : [invoice]),
      update: vi.fn().mockResolvedValue({}),
    },
    riderPaymentAllocation: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const service = new RiderPaymentsService({} as never);
  const input = {
    clientId: 'client-1',
    riderId: 'rider-1',
    amount,
    currency: 'INR',
    method: 'UPI',
    provider: 'CASHFREE',
    providerPaymentId: 'cf-123',
    sourceId: 'collection-1',
    invoiceId: 'invoice-1',
  };
  return { service, tx, input };
}
describe('provider payment financial settlement', () => {
  it('allocates only current outstanding and keeps surplus cash unallocated', async () => {
    const { service, tx, input } = fixture('900.00');
    await service.confirmProviderPaymentInTransaction(tx as never, input);
    expect(tx.riderPaymentAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: new Prisma.Decimal('900.00') }),
    });
    expect(tx.riderPayment.update).toHaveBeenCalledWith({
      where: { id: 'receipt-1' },
      data: { unallocatedAmount: new Prisma.Decimal('300.00') },
    });
    expect(tx.riderLedgerEntry.create).toHaveBeenCalledOnce();
  });
  it('keeps a late provider success fully unallocated when the invoice is paid', async () => {
    const { service, tx, input } = fixture('0.00');
    await service.confirmProviderPaymentInTransaction(tx as never, input);
    expect(tx.riderPaymentAllocation.create).not.toHaveBeenCalled();
    expect(tx.riderPayment.update).not.toHaveBeenCalled();
  });
  it('does not post a duplicate financial effect for the same provider collection', async () => {
    const { service, tx, input } = fixture('900.00', {
      id: 'receipt-1',
      riderId: 'rider-1',
      amount,
      currency: 'INR',
      externalReference: 'cf-123',
    });
    await service.confirmProviderPaymentInTransaction(tx as never, input);
    expect(tx.riderPayment.create).not.toHaveBeenCalled();
    expect(tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });
});
