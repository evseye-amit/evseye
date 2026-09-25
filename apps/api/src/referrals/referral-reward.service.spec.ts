import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ReferralRewardService } from './referral-reward.service.js';

function setup(status = 'PROCESSING') {
  const tx = {
    referralReward: { findFirst: vi.fn().mockResolvedValue({ id: 'reward-1', campaignId: 'campaign-1', referralId: 'referral-1', status, amount: new Prisma.Decimal('500'), currency: 'INR', rewardType: 'CASH', beneficiaryRiderId: 'rider-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'reward-1' }) },
    referralPayout: { create: vi.fn().mockResolvedValue({ id: 'payout-1' }) },
    referral: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    referralCampaign: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    referralNotificationOutbox: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn((fn: (client: never) => Promise<unknown>) => fn(tx as never)) };
  const billing = { issueCreditInTransaction: vi.fn().mockResolvedValue({ id: 'credit-1' }) };
  const service = new ReferralRewardService(prisma as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, billing as never);
  return { tx, service, billing };
}

describe('ReferralRewardService', () => {
  it('marks only a processing reward paid and records one payout and audit event', async () => {
    const { tx, service } = setup();
    await expect(service.markPaid('client-a', 'admin', 'reward-1', 'UTR123', 'BANK_TRANSFER')).resolves.toMatchObject({ rewardId: 'reward-1' });
    expect(tx.referralPayout.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clientId: 'client-a', action: 'REFERRAL_REWARD_PAID', actorId: 'admin' }) });
  });

  it('does not pay an unapproved reward twice', async () => {
    const { tx, service } = setup('PAID');
    await expect(service.markPaid('client-a', 'admin', 'reward-1', 'UTR123', 'BANK_TRANSFER')).rejects.toMatchObject({ status: 409 });
    expect(tx.referralPayout.create).not.toHaveBeenCalled();
  });

  it('releases reserved budget when a reward is rejected', async () => {
    const { tx, service } = setup('EARNED');
    await service.transition('client-a', 'admin', 'reward-1', 'reject', 'Invalid proof');
    expect(tx.referralCampaign.update).toHaveBeenCalledWith({ where: { id: 'campaign-1' }, data: { budgetReserved: { decrement: new Prisma.Decimal('500') } } });
  });

  it('posts an approved wallet reward as a billing credit in the same transaction', async () => {
    const { tx, service, billing } = setup('EARNED');
    tx.referralReward.findFirst.mockResolvedValueOnce({ id: 'reward-1', campaignId: 'campaign-1', referralId: 'referral-1', status: 'EARNED', amount: new Prisma.Decimal('500'), currency: 'INR', rewardType: 'WALLET_CREDIT', beneficiaryRiderId: 'rider-1' });
    await service.transition('client-a', 'admin', 'reward-1', 'approve');
    expect(billing.issueCreditInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ riderId: 'rider-1', sourceKey: 'referral:reward-1', amount: new Prisma.Decimal('500') }));
    expect(tx.referralReward.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
  });
});
