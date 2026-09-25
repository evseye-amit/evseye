import { describe, expect, it, vi } from 'vitest';
import { ReferralCampaignService } from './referral-campaign.service.js';

const campaign = {
  code: 'GURGAON_RIDERS', name: 'Gurgaon Riders', termsAndConditions: 'Terms',
  startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z',
  registrationValidityDays: 7, qualificationValidityDays: 30,
  referrerRewardType: 'CASH', referrerRewardValue: '500', refereeRewardType: 'CASH', refereeRewardValue: '200',
  campaignBudget: '200000', milestones: [{ milestoneType: 'COMPLETED_RIDES', operator: 'GTE', targetValue: '50', sequence: 1 }],
};

describe('ReferralCampaignService', () => {
  it('rejects negative rewards before writing a campaign', async () => {
    const create = vi.fn();
    const service = new ReferralCampaignService({ referralCampaign: { create } } as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never);
    await expect(service.create('client-a', 'admin', { ...campaign, referrerRewardValue: '-500' } as never)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an impossible boolean milestone target', async () => {
    const service = new ReferralCampaignService({ referralCampaign: { create: vi.fn() } } as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never);
    await expect(service.create('client-a', 'admin', { ...campaign, milestones: [{ milestoneType: 'KYC_VERIFIED', operator: 'EQ', targetValue: '2', sequence: 1 }] } as never)).rejects.toMatchObject({ status: 400 });
  });
});
