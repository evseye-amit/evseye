import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { WalletStatementService } from './wallet-statement.service.js';

describe('WalletStatementService', () => {
  it('reconciles each bucket and keeps the deposit outside spendable balance', async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([
        { accountId: 'cash', entryType: 'CREDIT', _sum: { amount: new Prisma.Decimal('100') } },
        { accountId: 'deposit', entryType: 'CREDIT', _sum: { amount: new Prisma.Decimal('500') } },
      ])
      .mockResolvedValueOnce([
        { accountId: 'cash', entryType: 'CREDIT', _sum: { amount: new Prisma.Decimal('20') } },
        { accountId: 'cash', entryType: 'DEBIT', _sum: { amount: new Prisma.Decimal('30') } },
        { accountId: 'reward', entryType: 'CREDIT', _sum: { amount: new Prisma.Decimal('10') } },
      ]);
    const prisma = {
      riderWallet: { findFirst: vi.fn().mockResolvedValue({
        clientId: 'client-1', riderId: 'rider-1', currency: 'INR',
        accounts: [
          { id: 'cash', accountType: 'CASH' },
          { id: 'reward', accountType: 'REWARD' },
          { id: 'deposit', accountType: 'SECURITY_DEPOSIT' },
          { id: 'clearing', accountType: 'CLEARING' },
        ],
        rider: { name: 'Rider', mobile: '9876543210', riderCode: 'R1' },
        client: { name: 'Client' },
      }) },
      walletLedgerEntry: { groupBy },
      walletTransaction: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    };
    const service = new WalletStatementService(prisma as never);
    const result = await service.statement('client-1', 'wallet-1', '2026-01-01', '2026-01-31');
    expect(result.spendable).toEqual({ opening: '100.00', credits: '30.00', debits: '30.00', closing: '100.00' });
    expect(result.buckets.SECURITY_DEPOSIT.closing).toBe('500.00');
    expect(result.rider.maskedMobile).toBe('******3210');
    expect(prisma.riderWallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wallet-1', clientId: 'client-1' } }));
  });

  it('rejects inverted and excessive periods', () => {
    const service = new WalletStatementService({} as never);
    expect(() => service.period('2026-02-01', '2026-01-01')).toThrow();
    expect(() => service.period('2024-01-01', '2026-01-01')).toThrow();
    expect(() => service.period('2026-02-30', '2026-03-01')).toThrow();
  });
});
