import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RiderBillingService } from './rider-billing.service.js';
const D = (value: string) => new Prisma.Decimal(value);

function setup() {
  const tx = {
    rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-a' }) },
    riderPaymentProfile: { findUnique: vi.fn().mockResolvedValue({ currency: 'INR' }), create: vi.fn() },
    riderCharge: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'charge-a', description: 'Rent' }), update: vi.fn() },
    riderCredit: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'credit-a', description: 'Reward', effectiveAt: new Date() }), update: vi.fn() },
    riderLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    riderInvoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'invoice-a' }), update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'invoice-a', lines: [] }) },
    riderInvoiceLine: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = { $transaction: vi.fn((fn: (client: never) => Promise<unknown>) => fn(tx as never)), rider: tx.rider };
  return { tx, prisma, service: new RiderBillingService(prisma as never) };
}

describe('RiderBillingService', () => {
  it('posts a charge and one immutable debit with client and rider scope', async () => {
    const { tx, service } = setup();
    await service.postCharge('client-a', 'rider-a', 'admin-a', 'charge-key-123', { chargeType: 'RENT', description: 'Rent', quantity: '2', unitAmount: '100.25' });
    expect(tx.rider.findFirst).toHaveBeenCalledWith({ where: { id: 'rider-a', clientId: 'client-a', deletedAt: null }, select: { id: true } });
    expect(tx.riderCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clientId: 'client-a', riderId: 'rider-a', amount: D('200.50'), sourceKey: 'charge-key-123' }) });
    expect(tx.riderLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ debitAmount: D('200.50'), entryType: 'CHARGE' }) });
  });

  it('returns an existing charge without posting another ledger entry', async () => {
    const { tx, service } = setup();
    tx.riderCharge.findUnique.mockResolvedValue({ id: 'charge-a', riderId: 'rider-a', chargeType: 'RENT', description: 'Rent', quantity: D('1'), unitAmount: D('50'), amount: D('50'), currency: 'INR', referenceType: null, referenceId: null });
    await service.postCharge('client-a', 'rider-a', 'admin-a', 'charge-key-123', { chargeType: 'RENT', description: 'Rent', quantity: '1', unitAmount: '50' });
    expect(tx.riderCharge.create).not.toHaveBeenCalled();
    expect(tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('refuses a rider from a different client', async () => {
    const { tx, service } = setup();
    tx.rider.findFirst.mockResolvedValue(null);
    await expect(service.postCharge('client-b', 'rider-a', 'admin-b', 'charge-key-123', { chargeType: 'RENT', description: 'Rent', quantity: '1', unitAmount: '50' })).rejects.toMatchObject({ status: 404 });
    expect(tx.riderCharge.create).not.toHaveBeenCalled();
  });

  it('creates a zero payable finalized invoice with charge and credit snapshots', async () => {
    const { tx, service } = setup();
    tx.riderCharge.findMany.mockResolvedValue([{ id: 'charge-a', description: 'Rent', amount: D('100'), currency: 'INR' }]);
    tx.riderCredit.findMany.mockResolvedValue([{ id: 'credit-a', description: 'Reward', remainingAmount: D('150'), currency: 'INR' }]);
    await service.finalizeInvoice('client-a', 'rider-a', 'admin-a', { billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30', dueDate: '2026-10-05' });
    expect(tx.riderInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ subtotal: D('100'), creditAmount: D('100'), totalAmount: D('0'), status: 'DRAFT' }) });
    expect(tx.riderInvoiceLine.create).toHaveBeenCalledTimes(2);
    expect(tx.riderCredit.update).toHaveBeenCalledWith({ where: { id: 'credit-a' }, data: { remainingAmount: D('50'), status: 'PARTIALLY_APPLIED' } });
    expect(tx.riderInvoice.update).toHaveBeenCalledWith({ where: { id: 'invoice-a' }, data: expect.objectContaining({ status: 'PAID' }) });
  });

  it('refuses invalid billing dates', async () => {
    const { tx, service } = setup();
    await expect(service.finalizeInvoice('client-a', 'rider-a', 'admin-a', { billingPeriodStart: '2026-09-30', billingPeriodEnd: '2026-09-01', dueDate: '2026-10-05' })).rejects.toMatchObject({ status: 400 });
    expect(tx.riderInvoice.create).not.toHaveBeenCalled();
  });
});
