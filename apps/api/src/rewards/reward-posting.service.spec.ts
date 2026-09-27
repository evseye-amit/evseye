import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RewardPostingService } from './reward-posting.service.js';
const amount = new Prisma.Decimal('500.00');
function fixture(status = 'APPROVED') {
  const claim = { id: 'claim-1', clientId: 'client-1', riderId: 'rider-1', programId: 'program-1', ruleId: 'rule-1', sourceType: 'REFERRAL', currency: 'INR', calculatedAmount: amount, expiresAt: null, status, program: { name: 'Refer & Earn' }, rule: {} };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]), rewardClaim: { findFirst: vi.fn().mockResolvedValue(claim), update: vi.fn().mockResolvedValue({ ...claim, status: 'CREDITED' }) },
    riderWallet: { findFirst: vi.fn().mockResolvedValue({ id: 'wallet-1', currency: 'INR' }) },
    walletAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'reward', accountType: 'REWARD', status: 'ACTIVE' }, { id: 'clearing', accountType: 'CLEARING', status: 'ACTIVE' }]) },
    rewardLot: { create: vi.fn().mockResolvedValue({}) }, rewardEvent: { create: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const wallet = { ensure: vi.fn().mockResolvedValue({ id: 'wallet-1' }), locked: vi.fn((_: string, work: (client: never) => Promise<unknown>) => work(tx as never)), postInTransaction: vi.fn().mockResolvedValue({ id: 'transaction-1' }) };
  const prisma = { rewardClaim: { findFirst: vi.fn().mockResolvedValue(claim) } };
  return { tx, wallet, claim, service: new RewardPostingService(prisma as never, wallet as never) };
}
describe('reward wallet posting', () => {
  it('credits the existing REWARD account with a balanced immutable transaction and one lot', async () => {
    const f = fixture();
    await f.service.post('client-1', 'claim-1');
    expect(f.wallet.postInTransaction).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      type: 'REFERRAL_REWARD', amount: '500.00', idempotencyKey: 'reward:claim:claim-1',
      entries: [{ accountId: 'clearing', entryType: 'DEBIT', amount: '500.00' }, { accountId: 'reward', entryType: 'CREDIT', amount: '500.00' }],
    }));
    expect(f.tx.rewardLot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ claimId: 'claim-1', remainingAmount: amount }) });
  });
  it('does not post or create another lot for a credited claim', async () => {
    const f = fixture('CREDITED');
    await f.service.post('client-1', 'claim-1');
    expect(f.wallet.postInTransaction).not.toHaveBeenCalled();
    expect(f.tx.rewardLot.create).not.toHaveBeenCalled();
  });
});
