import { describe, expect, it, vi } from 'vitest';
import { ReferralService } from './referral.service.js';

function setup() {
  const prisma = {
    referralIdentity: { findFirst: vi.fn().mockResolvedValue({ riderId: 'rider-a', rider: { userId: 'referrer-user', mobile: '+919876543210', status: 'ACTIVE', deletedAt: null } }) },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'new-user', mobile: '+919123456789' }) },
    referral: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const service = new ReferralService(prisma as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never, {} as never);
  return { prisma, service };
}

describe('ReferralService.attribute', () => {
  it('does not resolve a code outside the authenticated Client', async () => {
    const { prisma, service } = setup();
    prisma.referralIdentity.findFirst.mockResolvedValue(null);
    await expect(service.attribute('client-a', 'new-user', { referralCode: 'EVS-ABCDEFGH' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.referralIdentity.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a', code: 'EVS-ABCDEFGH' } }));
  });

  it('prevents a Rider referring their own normalized mobile', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'new-user', mobile: '+919876543210' });
    await expect(service.attribute('client-a', 'new-user', { referralCode: 'evs-abcdefgh' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.referral.findFirst).not.toHaveBeenCalled();
  });

  it('preserves first valid attribution', async () => {
    const { prisma, service } = setup();
    prisma.referral.findFirst.mockResolvedValue({ id: 'existing', referrerRiderId: 'other-rider' });
    await expect(service.attribute('client-a', 'new-user', { referralCode: 'EVS-ABCDEFGH' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.referral.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a', refereeUserId: 'new-user' } }));
  });

  it('does not reassign a campaign-bound link to a later campaign', async () => {
    const { prisma, service } = setup();
    const findFirst = vi.fn().mockResolvedValue(null);
    Object.assign(prisma, { referralCampaign: { findFirst } });
    const activeCampaign = vi.spyOn(service, 'activeCampaign');
    await expect(service.attribute('client-a', 'new-user', {
      referralCode: 'EVS-ABCDEFGH', campaignCode: 'OLD_CAMPAIGN',
    })).rejects.toMatchObject({ status: 400 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'client-a', code: 'OLD_CAMPAIGN', status: 'ACTIVE' }),
    }));
    expect(activeCampaign).not.toHaveBeenCalled();
  });
});

describe('ReferralService.resolveInput', () => {
  it('extracts a QR share-link code and validates it in the current Client', async () => {
    const findFirst = vi.fn().mockResolvedValue({ code: 'EVS-ABCDEFGH', rider: { status: 'ACTIVE', deletedAt: null } });
    const service = new ReferralService({ referralIdentity: { findFirst } } as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never, {} as never);
    await expect(service.resolveInput('client-a', 'https://example.test/rider/referral?code=EVS-ABCDEFGH')).resolves.toEqual({ referralCode: 'EVS-ABCDEFGH' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a', code: 'EVS-ABCDEFGH' } }));
  });

  it('resolves a referrer mobile to a canonical code', async () => {
    const rider = { findFirst: vi.fn().mockResolvedValue({ id: 'rider-a' }) };
    const referralIdentity = { findUnique: vi.fn().mockResolvedValue({ code: 'EVS-ABCDEFGH' }) };
    const service = new ReferralService({ rider, referralIdentity } as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never, {} as never);
    await expect(service.resolveInput('client-a', '9876543210')).resolves.toEqual({ referralCode: 'EVS-ABCDEFGH' });
    expect(rider.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-a', status: 'ACTIVE', deletedAt: null }) }));
  });
});

describe('ReferralService.notifications', () => {
  it('limits in-app events to referrals belonging to the authenticated Client and Rider', async () => {
    const findMany = vi.fn().mockReturnValue(Promise.resolve([]));
    const count = vi.fn().mockReturnValue(Promise.resolve(0));
    const prisma = {
      referralNotificationOutbox: { findMany, count },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const access = { requireFeature: vi.fn().mockResolvedValue({}), requireRider: vi.fn().mockResolvedValue({ id: 'rider-a' }) };
    const service = new ReferralService(prisma as never, access as never, {} as never, {} as never);
    await service.notifications('client-a', 'user-a', { page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      clientId: 'client-a', referral: { clientId: 'client-a', OR: [{ referrerRiderId: 'rider-a' }, { refereeRiderId: 'rider-a' }] },
    } }));
  });
});

describe('ReferralService.listForOperations', () => {
  it('scopes fraud and reward filters to the authenticated Client', async () => {
    const findMany = vi.fn().mockReturnValue(Promise.resolve([]));
    const count = vi.fn().mockReturnValue(Promise.resolve(0));
    const prisma = {
      referral: { findMany, count },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const service = new ReferralService(prisma as never, { requireFeature: vi.fn().mockResolvedValue({}) } as never, {} as never, {} as never);
    await service.listForOperations('client-a', { page: 1, pageSize: 20, fraudResult: 'REVIEW', rewardStatus: 'APPROVED' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      clientId: 'client-a', fraudChecks: { some: { result: 'REVIEW' } }, rewards: { some: { status: 'APPROVED' } },
    } }));
  });
});
