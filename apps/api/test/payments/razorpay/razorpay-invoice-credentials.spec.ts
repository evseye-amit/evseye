import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RazorpayInvoiceService } from '../../../src/payments/razorpay/razorpay-invoice.service.js';

function fixture() {
  const invoice = { invoiceType: 'RENTAL', currency: 'INR', status: 'FINALIZED', outstandingAmount: new Prisma.Decimal(100), totalAmount: new Prisma.Decimal(100) };
  const tx = {
    $queryRaw: vi.fn(),
    paymentCollectionRequest: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'collection', status: 'CREATING', amount: invoice.totalAmount, currency: 'INR' }) },
    paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    riderInvoice: { findFirstOrThrow: vi.fn().mockResolvedValue(invoice) },
    walletTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
    razorpayPenaltyOrder: { create: vi.fn().mockImplementation(async ({ data }) => data) },
    auditLog: { create: vi.fn() },
  };
  const gateway = { assertConfigured: vi.fn(), keyId: 'global-key', configurationFor: vi.fn().mockImplementation(async (id: string) => ({ keyId: `key-${id}`, configurationVersionId: `version-${id}` })) };
  const wallet = { ensure: vi.fn().mockResolvedValue({ id: 'wallet' }), locked: vi.fn().mockImplementation(async (_id, work) => work(tx)) };
  const collections = { startOrder: vi.fn() };
  const subject = new RazorpayInvoiceService({ riderInvoice: { findFirst: vi.fn().mockResolvedValue(invoice) } } as never, gateway as never, wallet as never, {} as never, collections as never);
  return { subject, gateway, wallet, tx, collections };
}

describe('Rental checkout merchant credentials', () => {
  it.each(['client-a', 'client-b'])('persists the checkout key for %s instead of the global key', async (clientId) => {
    const f = fixture();
    await f.subject.payInvoice(clientId, 'rider', 'invoice', 'request-key', false, 'actor');
    expect(f.gateway.configurationFor).toHaveBeenCalledWith(clientId);
    expect(f.tx.razorpayPenaltyOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({ keyId: `key-${clientId}`, configurationVersionId: `version-${clientId}` }) });
    expect(f.collections.startOrder).toHaveBeenCalledWith(clientId, expect.objectContaining({ keyId: `key-${clientId}`, configurationVersionId: `version-${clientId}` }), 'INVOICE_PAYMENT');
  });

  it('does not mutate wallet or create an order when merchant credentials cannot resolve', async () => {
    const f = fixture();
    f.gateway.configurationFor.mockRejectedValue(new Error('merchant unavailable'));
    await expect(f.subject.payInvoice('client-a', 'rider', 'invoice', 'request-key', false, 'actor')).rejects.toThrow('merchant unavailable');
    expect(f.wallet.ensure).not.toHaveBeenCalled();
    expect(f.collections.startOrder).not.toHaveBeenCalled();
  });
});
