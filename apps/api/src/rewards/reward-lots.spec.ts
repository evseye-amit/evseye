import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { WalletService } from '../wallet/wallet.service.js';

const d = (value: string) => new Prisma.Decimal(value);
function fixture(lotAmounts: string[]) {
  const accounts = [{ id: 'reward', accountType: 'REWARD', status: 'ACTIVE', currency: 'INR' }, { id: 'clearing', accountType: 'CLEARING', status: 'ACTIVE', currency: 'INR' }];
  const lots = lotAmounts.map((value, index) => ({ id: `lot-${index + 1}`, remainingAmount: d(value), expiresAt: new Date(`2027-0${index + 1}-01`), status: 'AVAILABLE' }));
  const tx = {
    walletTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)), update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)) },
    riderWallet: { findFirst: vi.fn().mockResolvedValue({ id: 'wallet', riderId: 'rider', clientId: 'client', currency: 'INR', status: 'ACTIVE', accounts }) },
    walletPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
    walletLedgerEntry: { createMany: vi.fn().mockResolvedValue({}) },
    rewardLot: { findMany: vi.fn().mockResolvedValue(lots), update: vi.fn().mockResolvedValue({}) },
    rewardLotConsumption: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const service = new WalletService({} as never);
  vi.spyOn(service, 'balanceTx').mockResolvedValue({ rewards: { availableBalance: lotAmounts.reduce((sum, value) => sum.plus(value), d('0')).toFixed(2) }, accounts: [{ accountId: 'reward', accountType: 'REWARD', availableBalance: lotAmounts.reduce((sum, value) => sum.plus(value), d('0')).toFixed(2) }, { accountId: 'clearing', accountType: 'CLEARING', availableBalance: '0.00' }] } as never);
  return { tx, service };
}
describe('reward lot spending', () => {
  it('consumes earliest expiring lots first in the wallet posting transaction', async () => {
    const { tx, service } = fixture(['100.00', '500.00']);
    await service.postInTransaction(tx as never, { clientId: 'client', walletId: 'wallet', actorId: 'SYSTEM', type: 'RENTAL', amount: '150.00', currency: 'INR', description: 'Rental', idempotencyKey: 'reward-spend-1', entries: [{ accountId: 'reward', entryType: 'DEBIT', amount: '150.00' }, { accountId: 'clearing', entryType: 'CREDIT', amount: '150.00' }] });
    expect(tx.rewardLotConsumption.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ lotId: 'lot-1', amount: d('100.00'), kind: 'SPEND' }) });
    expect(tx.rewardLotConsumption.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ lotId: 'lot-2', amount: d('50.00'), kind: 'SPEND' }) });
  });
  it('refuses to spend expired tracked reward as legacy balance', async () => {
    const { tx, service } = fixture(['100.00']);
    tx.rewardLot.findMany.mockResolvedValue([{ id: 'expired', remainingAmount: d('100.00'), expiresAt: new Date('2020-01-01'), status: 'AVAILABLE' }]);
    await expect(service.postInTransaction(tx as never, { clientId: 'client', walletId: 'wallet', actorId: 'SYSTEM', type: 'RENTAL', amount: '100.00', currency: 'INR', description: 'Rental', idempotencyKey: 'reward-spend-2', entries: [{ accountId: 'reward', entryType: 'DEBIT', amount: '100.00' }, { accountId: 'clearing', entryType: 'CREDIT', amount: '100.00' }] })).rejects.toThrow('REWARD_LOTS_INSUFFICIENT');
  });
});
