import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ReferralQualificationService } from './referral-qualification.service.js';

const D = (value: string) => new Prisma.Decimal(value);

function setup(budget = '1000') {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'row' }]),
    referral: {
      findFirst: vi.fn().mockResolvedValue({ id: 'ref-1', clientId: 'client-a', campaignId: 'campaign-a', referrerRiderId: 'referrer', refereeRiderId: 'referee', registeredAt: new Date(), status: 'MILESTONE_IN_PROGRESS', qualifiedAt: null, qualificationDeadlineAt: new Date(Date.now() + 86400000), ruleSnapshot: { referrerRewardType: 'CASH', referrerRewardValue: '500', refereeRewardType: 'CASH', refereeRewardValue: '200' }, progress: [{ mandatory: true, completedAt: new Date() }] }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    referralCampaign: { findFirst: vi.fn().mockResolvedValue({ id: 'campaign-a', campaignBudget: D(budget), budgetReserved: D('0'), maxQualifiedReferralsPerRider: null, maxRewardPerRider: null, currency: 'INR' }), update: vi.fn().mockResolvedValue({}) },
    referralReward: { create: vi.fn().mockResolvedValue({}) },
    referralNotificationOutbox: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn((fn: (client: never) => Promise<unknown>) => fn(tx as never)) };
  const service = new ReferralQualificationService(prisma as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, { record: vi.fn().mockResolvedValue({}) } as never);
  return { tx, prisma, service };
}

describe('ReferralQualificationService', () => {
  it('reserves and creates both rewards in one transaction after qualification', async () => {
    const { tx, service } = setup();
    await expect(service.manuallyQualify('client-a', 'admin', 'ref-1', 'Verified')).resolves.toEqual({ qualified: true });
    expect(tx.referralReward.create).toHaveBeenCalledTimes(2);
    expect(tx.referralReward.create).toHaveBeenCalledWith({ data: expect.objectContaining({ beneficiary: 'REFERRER', amount: D('500') }) });
    expect(tx.referralReward.create).toHaveBeenCalledWith({ data: expect.objectContaining({ beneficiary: 'REFEREE', amount: D('200') }) });
    expect(tx.referralCampaign.update).toHaveBeenCalledWith({ where: { id: 'campaign-a' }, data: { budgetReserved: { increment: D('700') } } });
  });

  it('blocks qualification before exceeding the hard campaign budget', async () => {
    const { tx, service } = setup('600');
    await expect(service.manuallyQualify('client-a', 'admin', 'ref-1', 'Verified')).rejects.toMatchObject({ status: 409 });
    expect(tx.referral.updateMany).not.toHaveBeenCalled();
    expect(tx.referralReward.create).not.toHaveBeenCalled();
  });

  it('ignores repeated source events without incrementing progress', async () => {
    const { tx, service } = setup();
    const prisma = service as unknown as { prisma: { referral: { findFirst: ReturnType<typeof vi.fn> } } };
    prisma.prisma.referral = { findFirst: vi.fn().mockResolvedValue({ id: 'ref-1' }) };
    tx.referral.findFirst.mockResolvedValue({ id: 'ref-1', status: 'REGISTERED', qualificationDeadlineAt: new Date(Date.now() + 86400000), progress: [{ id: 'progress-1', milestoneType: 'COMPLETED_RIDES', currentValue: D('42'), targetValue: D('50'), operator: 'GTE' }] });
    Object.assign(tx, { referralActivityEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) }, referralMilestoneProgress: { update: vi.fn() } });
    await expect(service.recordEvent('client-a', 'referee', 'COMPLETED_RIDES', 'ride-123', '1')).resolves.toEqual({ processed: false, reason: 'DUPLICATE_EVENT' });
    expect((tx as typeof tx & { referralMilestoneProgress: { update: ReturnType<typeof vi.fn> } }).referralMilestoneProgress.update).not.toHaveBeenCalled();
  });
});
