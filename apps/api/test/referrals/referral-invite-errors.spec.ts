import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReferralService } from '../../src/referrals/referral.service.js';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';

const message =
  'Refer and earn is currently unavailable because there is no active campaign.';
function fixture() {
  const tx = {
    $queryRaw: vi.fn(),
    referralCampaign: { count: vi.fn().mockResolvedValue(0) },
  };
  const prisma = {
    referralCampaign: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    referralIdentity: {
      findUnique: vi.fn().mockResolvedValue({ code: 'EVS-ABCDEFGH' }),
    },
    $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
  };
  const access = {
    requireFeature: vi.fn().mockResolvedValue({}),
    requireRider: vi
      .fn()
      .mockResolvedValue({ id: 'rider-a', status: 'ACTIVE' }),
  };
  const links = {
    shareLink: vi.fn().mockResolvedValue('https://example.test/referral'),
  };
  return {
    prisma,
    access,
    links,
    service: new ReferralService(
      prisma as never,
      access as never,
      links as never,
      {} as never,
    ),
  };
}
async function responseFor(service: ReferralService) {
  const exception = await service
    .invite('client-a', 'user-a')
    .catch((cause: unknown) => cause);
  const reply = {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
  new HttpExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({
        id: 'req-invite',
        headers: {},
        method: 'POST',
        url: '/api/v1/rider-app/referrals/invites',
      }),
    }),
  } as never);
  return reply;
}

describe('referral invite error responses', () => {
  it('returns a useful 400 response when no active campaign exists, without writing an invite', async () => {
    const { service, prisma, links } = fixture();
    const reply = await responseFor(service);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'REFERRAL_CAMPAIGN_INACTIVE', message },
      requestId: 'req-invite',
    });
    expect(prisma.referralIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(links.shareLink).not.toHaveBeenCalled();
    expect(prisma.referralCampaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-a',
          status: 'ACTIVE',
          startAt: { lte: expect.any(Date) },
          endAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });
  it('returns the same handled response if the campaign closes before returning share details', async () => {
    const { service, prisma } = fixture();
    prisma.referralCampaign.findFirst.mockResolvedValue({
      id: 'campaign-a',
      endAt: new Date(Date.now() + 86400000),
      registrationValidityDays: 7,
    } as never);
    const reply = await responseFor(service);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'REFERRAL_CAMPAIGN_INACTIVE', message },
      requestId: 'req-invite',
    });
  });
  it('distinguishes a package without referral access from a missing campaign', async () => {
    const { service, access, prisma } = fixture();
    access.requireFeature.mockRejectedValue(
      new ForbiddenException({
        code: 'REFERRAL_FEATURE_NOT_ENABLED',
        message:
          'Referral Benefit is not enabled in the active client package.',
      }),
    );
    const reply = await responseFor(service);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'REFERRAL_FEATURE_NOT_ENABLED',
          message:
            'Referral Benefit is not enabled in the active client package.',
        },
      }),
    );
    expect(prisma.referralCampaign.findFirst).not.toHaveBeenCalled();
  });
  it('returns a handled eligibility error for an inactive rider', async () => {
    const { service, access } = fixture();
    access.requireRider.mockResolvedValue({
      id: 'rider-a',
      status: 'INACTIVE',
    });
    const reply = await responseFor(service);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'REFERRAL_NOT_ELIGIBLE',
          message: 'Only an active Rider may invite.',
        },
      }),
    );
  });
});
