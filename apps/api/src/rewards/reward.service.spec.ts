import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RewardService } from './reward.service.js';
const d = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const claim = { id: 'claim-1', clientId: 'client-1', riderId: 'rider-1', status: 'CREDITED', currency: 'INR', creditedAmount: d('500.00') };
  const lot = { id: 'lot-1', claimId: claim.id, remainingAmount: d('200.00') };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]),
    rewardClaim: { findFirstOrThrow: vi.fn().mockResolvedValue(claim), update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...claim, ...data })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    rewardLot: { findFirst: vi.fn().mockResolvedValue({ ...lot, clientId: 'client-1', riderId: 'rider-1', status: 'AVAILABLE', expiresAt: new Date('2020-01-01') }), update: vi.fn().mockResolvedValue({}) },
    walletAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'reward', accountType: 'REWARD' }, { id: 'clearing', accountType: 'CLEARING' }]) },
    rewardEvent: { create: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
  const wallet = { ensure: vi.fn().mockResolvedValue({ id: 'wallet-1', currency: 'INR' }), locked: vi.fn((_: string, work: (client: never) => Promise<unknown>) => work(tx as never)), balanceTx: vi.fn().mockResolvedValue({ rewards: { availableBalance: '200.00' } }), postInTransaction: vi.fn().mockResolvedValue({ id: 'reverse-transaction' }) };
  const prisma = { rewardClaim: { findFirst: vi.fn().mockResolvedValue(claim) }, rewardLot: { findMany: vi.fn().mockResolvedValue([{ ...lot, clientId: 'client-1', riderId: 'rider-1', status: 'AVAILABLE', expiresAt: new Date('2020-01-01') }]) } };
  return { tx, wallet, service: new RewardService(prisma as never, wallet as never, {} as never) };
}
describe('reward reversal', () => {
  it('debits only unspent reward and records the unrecovered remainder', async () => {
    const f = fixture();
    await f.service.reverse('client-1', 'claim-1', 'admin-1', 'Invalid referral');
    expect(f.wallet.postInTransaction).toHaveBeenCalledWith(f.tx, expect.objectContaining({ amount: '200.00', referenceType: 'REWARD_REVERSAL', referenceId: 'lot-1' }));
    expect(f.tx.rewardClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: expect.objectContaining({ status: 'REVERSED', unrecoveredAmount: d('300.00') }) });
  });
  it('leaves the wallet alone when the entire reward was already spent', async () => {
    const f = fixture();
    f.tx.rewardLot.findFirst.mockResolvedValue({ id: 'lot-1', claimId: 'claim-1', remainingAmount: d('0.00') });
    await f.service.reverse('client-1', 'claim-1', 'admin-1', 'Invalid referral');
    expect(f.wallet.postInTransaction).not.toHaveBeenCalled();
    expect(f.tx.rewardClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: expect.objectContaining({ unrecoveredAmount: d('500.00') }) });
  });
  it('expires only the remaining lot amount through a targeted ledger debit', async () => {
    const f = fixture();
    const result = await f.service.expire(10, new Date('2026-09-27'));
    expect(result.expired).toBe(1);
    expect(f.wallet.postInTransaction).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      amount: '200.00', referenceType: 'REWARD_EXPIRY', referenceId: 'lot-1', idempotencyKey: 'reward:expire:lot-1',
    }));
  });
});
