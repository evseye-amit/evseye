import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { WalletBillingService } from './wallet-billing.service.js';
import { defaultPolicy } from './wallet-policy.service.js';

const d = (value: string) => new Prisma.Decimal(value);
function setup() {
  const invoice = { id: 'invoice-a', clientId: 'client-a', riderId: 'rider-a', invoiceType: 'RENTAL', invoiceNumber: 'EVS/1', currency: 'INR', status: 'FINALIZED', totalAmount: d('1500.00'), paidAmount: d('0.00'), outstandingAmount: d('1500.00'), lines: [] };
  const accounts = ['CASH', 'REWARD', 'CLEARING'].map(accountType => ({ id: accountType.toLowerCase(), accountType, status: 'ACTIVE' }));
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: invoice.id }]),
    riderInvoice: { findFirst: vi.fn().mockResolvedValue(invoice), update: vi.fn().mockImplementation(({ data }) => ({ ...invoice, ...data })) },
    walletTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
    walletInvoiceAllocation: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    walletAccount: { findMany: vi.fn().mockResolvedValue(accounts) },
    walletPolicy: { findFirst: vi.fn().mockResolvedValue({ ...defaultPolicy, allowRewardUsage: true, maxRewardUsagePercent: d('20.00'), rewardCategories: ['RENTAL'] }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const wallet = { ensure: vi.fn().mockResolvedValue({ id: 'wallet-a', currency: 'INR' }), locked: vi.fn((_: string, fn: (tx: never) => Promise<unknown>) => fn(tx as never)), balanceTx: vi.fn().mockResolvedValue({ cash: { availableBalance: '800.00' }, rewards: { availableBalance: '500.00' } }), postInTransaction: vi.fn().mockResolvedValue({ id: 'wallet-tx-a' }) };
  const prisma = { riderInvoice: { findFirst: vi.fn().mockResolvedValue(invoice) } };
  return { invoice, tx, wallet, service: new WalletBillingService(prisma as never, wallet as never, {} as never) };
}
describe('wallet invoice settlement', () => {
  it('uses reward and cash and leaves external remainder outstanding', async () => {
    const { tx, wallet, service } = setup();
    const result = await service.settle('client-a', 'invoice-a', 'admin-a', 'settle-key-1');
    expect(wallet.postInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: '1100.00', entries: [
      { accountId: 'reward', entryType: 'DEBIT', amount: '300.00' },
      { accountId: 'cash', entryType: 'DEBIT', amount: '800.00' },
      { accountId: 'clearing', entryType: 'CREDIT', amount: '1100.00' },
    ] }));
    expect(tx.walletInvoiceAllocation.create).toHaveBeenCalledTimes(2);
    expect(result.outstandingAmount.toFixed(2)).toBe('400.00');
    expect(result.status).toBe('PARTIALLY_PAID');
  });
  it('fully settles from reward and cash when eligible balances cover the invoice', async () => {
    const { invoice, tx, wallet, service } = setup();
    invoice.totalAmount = d('1000.00'); invoice.outstandingAmount = d('1000.00');
    const result = await service.settle('client-a', 'invoice-a', 'admin-a', 'settle-key-2');
    expect(wallet.postInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: '1000.00' }));
    expect(result.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(result.status).toBe('PAID');
  });
  it('does not consume the security deposit bucket for rental', async () => {
    const { wallet, service } = setup();
    wallet.balanceTx.mockResolvedValue({ cash: { availableBalance: '0.00' }, rewards: { availableBalance: '0.00' }, securityDepositBucket: { availableBalance: '3000.00' } });
    const result = await service.settle('client-a', 'invoice-a', 'admin-a', 'settle-key-3');
    expect(wallet.postInTransaction).not.toHaveBeenCalled();
    expect(result.outstandingAmount.toFixed(2)).toBe('1500.00');
  });
  it('returns the existing invoice on an idempotent retry', async () => {
    const { tx, wallet, service } = setup();
    tx.walletTransaction.findUnique.mockResolvedValue({ id: 'wallet-tx-a' });
    tx.walletInvoiceAllocation.findFirst.mockResolvedValue({ invoiceId: 'invoice-a' });
    (tx.riderInvoice as typeof tx.riderInvoice & { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'invoice-a' });
    await service.settle('client-a', 'invoice-a', 'admin-a', 'settle-key-1');
    expect(wallet.postInTransaction).not.toHaveBeenCalled();
    expect(tx.walletInvoiceAllocation.create).not.toHaveBeenCalled();
  });
});
