import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RiderPaymentHomeController } from '../../src/payments/payment-home.controller.js';
function fixture() {
  const db = {
    riderInvoice: { findMany: vi.fn().mockResolvedValue([{ outstandingAmount: new Prisma.Decimal(500), invoiceType: 'RENTAL', dueDate: new Date(0) }]) },
    riderPaymentProfile: { findUnique: vi.fn().mockResolvedValue({ autoPayEnabled: true, currency: 'INR' }) },
    paymentMandate: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE', maxAmount: new Prisma.Decimal(1000), expiresAt: new Date('2099-01-01') }) },
    paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    riderPayment: { findMany: vi.fn().mockResolvedValue([]) },
    paymentCollectionRequest: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const policy = { capabilities: vi.fn().mockResolvedValue({ purposes: { OUTSTANDING: { enabled: true } } }) };
  const controller = new RiderPaymentHomeController(db as never, { requireClientId: () => 'client' } as never, { riderForUser: async () => 'rider' } as never, {} as never, policy as never);
  return { db, policy, home: () => controller.home({ id: 'user' } as never) };
}
describe('payment home eligibility', () => {
  it('honors local disable while retaining the remote mandate status', async () => {
    const f = fixture(); f.db.riderPaymentProfile.findUnique.mockResolvedValue({ autoPayEnabled: false, currency: 'INR' });
    expect((await f.home()).data).toMatchObject({ autoPayStatus: 'NOT_ENABLED', autoPayEnabled: false, mandateStatus: 'ACTIVE', payNowAvailable: true });
  });
  it.each(['checkout', 'debit', 'policy', 'deposit', 'zero', 'minimum'])('does not advertise unusable pay-now: %s', async reason => {
    const f = fixture();
    if (reason === 'checkout') f.db.paymentCollectionRequest.findFirst.mockResolvedValue({ id: 'pending' } as never);
    if (reason === 'debit') f.db.paymentTransaction.findFirst.mockResolvedValue({ scheduledAt: new Date() } as never);
    if (reason === 'policy') f.policy.capabilities.mockResolvedValue({ purposes: { OUTSTANDING: { enabled: false, reason: 'PAYMENT_MERCHANT_UNAVAILABLE' } } } as never);
    if (reason === 'deposit') f.db.riderInvoice.findMany.mockResolvedValue([{ outstandingAmount: new Prisma.Decimal(500), invoiceType: 'SECURITY_DEPOSIT', dueDate: new Date() }]);
    if (reason === 'zero' || reason === 'minimum') f.db.riderInvoice.findMany.mockResolvedValue([{ outstandingAmount: new Prisma.Decimal(reason === 'zero' ? 0 : 0.5), invoiceType: 'RENTAL', dueDate: new Date() }]);
    expect((await f.home()).data).toMatchObject({ payNowAvailable: false, payNowUnavailableReason: expect.any(String) });
    expect(f.db.paymentTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client', riderId: 'rider', status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } } }));
  });
  it('does not turn a database outage into disabled capability', async () => {
    const f = fixture(); f.policy.capabilities.mockRejectedValue(new Error('offline'));
    await expect(f.home()).rejects.toThrow('offline');
  });
});
