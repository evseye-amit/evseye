import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ReferralService } from '../../src/referrals/referral.service.js';

const url = process.env.REFERRAL_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());

describe.skipIf(!url)(
  'referral creation with composite client scope in PostgreSQL',
  () => {
    async function fixture() {
      const client = await db.client.create({
        data: { name: 'Referral test', slug: randomUUID(), status: 'ACTIVE' },
      });
      const user = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Referrer',
          mobile: '9876543210',
          role: 'RIDER',
        },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          userId: user.id,
          name: user.name,
          mobile: user.mobile,
          status: 'ACTIVE',
        },
      });
      const campaign = await db.referralCampaign.create({
        data: {
          clientId: client.id,
          code: 'TEST',
          name: 'Test campaign',
          status: 'ACTIVE',
          termsAndConditions: 'Terms',
          startAt: new Date(Date.now() - 86400000),
          endAt: new Date(Date.now() + 86400000),
          registrationValidityDays: 7,
          qualificationValidityDays: 14,
          createdById: user.id,
          updatedById: user.id,
          milestones: {
            create: [
              { milestoneType: 'KYC_VERIFIED', targetValue: 1, sequence: 1 },
              {
                milestoneType: 'VEHICLE_ALLOCATED',
                targetValue: 1,
                sequence: 2,
              },
            ],
          },
        },
        include: { milestones: true },
      });
      const service = new ReferralService(
        db as never,
        {
          requireFeature: async () => undefined,
          requireRider: async () => rider,
        } as never,
        {
          shareLink: async (
            _client: string,
            code: string,
            token?: string,
            campaign?: string,
          ) =>
            `https://example.test/referral?code=${code}${token ? `&invite=${token}` : ''}${campaign ? `&campaign=${campaign}` : ''}`,
        } as never,
        {} as never,
      );
      let friendNumber = 0;
      const referee = () =>
        db.user.create({
          data: {
            clientId: client.id,
            name: 'New Rider',
            mobile: String(9123456780 + friendNumber++),
            role: 'RIDER',
          },
        });
      return { client, user, rider, campaign, service, referee };
    }
    async function assertProgress(
      referralId: string,
      clientId: string,
      milestoneIds: string[],
    ) {
      const rows = await db.referralMilestoneProgress.findMany({
        where: { referralId },
      });
      expect(rows).toHaveLength(milestoneIds.length);
      expect(rows.map((row) => row.milestoneId).sort()).toEqual(
        milestoneIds.sort(),
      );
      expect(
        rows.every(
          (row) => row.clientId === clientId && row.referralId === referralId,
        ),
      ).toBe(true);
    }
    it('repeated and cancelled shares create no referrals, progress or notifications, even at the limit', async () => {
      const f = await fixture();
      await db.referralCampaign.update({
        where: { id: f.campaign.id },
        data: { maxReferralsPerRider: 1 },
      });
      const shares = await Promise.all(
        Array.from({ length: 5 }, () =>
          f.service.invite(f.client.id, f.user.id),
        ),
      );
      expect(new Set(shares.map((s) => s.shareLink)).size).toBe(1);
      expect(shares[0]).toMatchObject({
        inviteToken: null,
        campaignCode: 'TEST',
      });
      expect(shares[0].shareLink).toContain('&campaign=TEST');
      expect(
        await db.referral.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
      expect(
        await db.referralMilestoneProgress.count({
          where: { clientId: f.client.id },
        }),
      ).toBe(0);
      expect(
        await db.referralNotificationOutbox.count({
          where: { clientId: f.client.id },
        }),
      ).toBe(0);
      const friend = await f.referee();
      await f.service.attribute(f.client.id, friend.id, {
        referralCode: shares[0].referralCode,
      });
      await expect(
        f.service.invite(f.client.id, f.user.id),
      ).resolves.toMatchObject({ shareLink: shares[0].shareLink });
    });
    it('creates a referral for code-only attribution and retains its notification outbox event', async () => {
      const f = await fixture();
      const identity = await f.service.identity(f.client.id, f.rider.id);
      const referee = await f.referee();
      const result = await f.service.attribute(f.client.id, referee.id, {
        referralCode: identity.code,
      });
      expect(result).toMatchObject({
        attributed: true,
        alreadyAttributed: false,
      });
      const row = await db.referral.findUniqueOrThrow({
        where: { id: result.referralId },
      });
      expect(row).toMatchObject({
        clientId: f.client.id,
        refereeUserId: referee.id,
        status: 'REGISTERED',
      });
      await assertProgress(
        row.id,
        f.client.id,
        f.campaign.milestones.map((m) => m.id),
      );
      expect(
        await db.referralNotificationOutbox.count({
          where: {
            clientId: f.client.id,
            referralId: row.id,
            eventType: 'REFERRAL_REGISTERED',
          },
        }),
      ).toBe(1);
    });
    it('attributes an existing invite without recreating referral or progress rows', async () => {
      const f = await fixture();
      const invite = await f.service.invite(f.client.id, f.user.id);
      const original = await db.referral.create({
        data: {
          clientId: f.client.id,
          campaignId: f.campaign.id,
          referrerRiderId: f.rider.id,
          referralCode: invite.referralCode,
          inviteToken: randomUUID(),
          attributionSource: 'MOBILE_INVITE',
          ruleSnapshot: {},
          termsSnapshot: 'Legacy terms',
          expiresAt: f.campaign.endAt,
          progress: {
            create: f.campaign.milestones.map((m) => ({
              milestoneId: m.id,
              milestoneType: m.milestoneType,
              operator: m.operator,
              targetValue: m.targetValue,
              mandatory: m.mandatory,
            })),
          },
        },
      });
      const originalIds = (
        await db.referralMilestoneProgress.findMany({
          where: { referralId: original.id },
        })
      )
        .map((p) => p.id)
        .sort();
      const referee = await f.referee();
      const result = await f.service.attribute(f.client.id, referee.id, {
        referralCode: invite.referralCode,
        inviteToken: original.inviteToken!,
      });
      expect(result.referralId).toBe(original.id);
      expect(
        await db.referral.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        (
          await db.referralMilestoneProgress.findMany({
            where: { referralId: original.id },
          })
        )
          .map((p) => p.id)
          .sort(),
      ).toEqual(originalIds);
      await assertProgress(
        original.id,
        f.client.id,
        f.campaign.milestones.map((m) => m.id),
      );
    });
    it('supports many friends using one link and idempotent concurrent retries', async () => {
      const f = await fixture();
      const shared = await f.service.invite(f.client.id, f.user.id);
      const friends = await Promise.all([
        f.referee(),
        f.referee(),
        f.referee(),
      ]);
      const results = await Promise.all(
        friends.flatMap((friend) =>
          Array.from({ length: 3 }, () =>
            f.service.attribute(f.client.id, friend.id, {
              referralCode: shared.referralCode,
              campaignCode: shared.campaignCode,
            }),
          ),
        ),
      );
      expect(new Set(results.map((r) => r.referralId)).size).toBe(3);
      expect(results.filter((r) => !r.alreadyAttributed)).toHaveLength(3);
      expect(
        await db.referralNotificationOutbox.count({
          where: { clientId: f.client.id },
        }),
      ).toBe(3);
      expect(
        await db.referralMilestoneProgress.count({
          where: { clientId: f.client.id },
        }),
      ).toBe(6);
    });
    it('ignores unclaimed legacy invitations in limits, lists and summary, and serializes the final slot', async () => {
      const f = await fixture();
      await db.referralCampaign.update({
        where: { id: f.campaign.id },
        data: { maxReferralsPerRider: 1 },
      });
      const shared = await f.service.invite(f.client.id, f.user.id);
      await db.referral.create({
        data: {
          clientId: f.client.id,
          campaignId: f.campaign.id,
          referrerRiderId: f.rider.id,
          referralCode: shared.referralCode,
          inviteToken: randomUUID(),
          attributionSource: 'MOBILE_INVITE',
          ruleSnapshot: {},
          termsSnapshot: 'Old',
          expiresAt: f.campaign.endAt,
        },
      });
      expect(
        (
          await f.service.mine(f.client.id, f.user.id, {
            page: 1,
            pageSize: 20,
          })
        ).meta.total,
      ).toBe(0);
      expect(
        (await f.service.home(f.client.id, f.user.id)).summary.totalInvited,
      ).toBe(0);
      const friends = await Promise.all([f.referee(), f.referee()]);
      const results = await Promise.allSettled(
        friends.map((friend) =>
          f.service.attribute(f.client.id, friend.id, {
            referralCode: shared.referralCode,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failed.reason.getResponse().code).toBe('REFERRAL_LIMIT_EXCEEDED');
      expect(
        (await f.service.home(f.client.id, f.user.id)).summary,
      ).toMatchObject({ totalInvited: 1, registered: 1 });
      expect(
        (
          await f.service.mine(f.client.id, f.user.id, {
            page: 1,
            pageSize: 20,
          })
        ).meta.total,
      ).toBe(1);
    });
    it('counts legacy claims in the month applied and enforces limits on old links too', async () => {
      const f = await fixture();
      await db.referralCampaign.update({
        where: { id: f.campaign.id },
        data: { maxReferralsPerRider: 1, referralLimitPeriod: 'MONTHLY' },
      });
      const shared = await f.service.invite(f.client.id, f.user.id);
      const legacy = await db.referral.create({
        data: {
          clientId: f.client.id,
          campaignId: f.campaign.id,
          referrerRiderId: f.rider.id,
          referralCode: shared.referralCode,
          attributionSource: 'MOBILE_INVITE',
          inviteToken: randomUUID(),
          ruleSnapshot: {},
          termsSnapshot: 'Old',
          expiresAt: f.campaign.endAt,
          createdAt: new Date('2020-01-01'),
        },
      });
      const friend = await f.referee();
      await f.service.attribute(f.client.id, friend.id, {
        referralCode: shared.referralCode,
        inviteToken: legacy.inviteToken!,
      });
      const next = await f.referee();
      await expect(
        f.service.attribute(f.client.id, next.id, {
          referralCode: shared.referralCode,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFERRAL_LIMIT_EXCEEDED' },
      });
      const unused = await db.referral.create({
        data: {
          clientId: f.client.id,
          campaignId: f.campaign.id,
          referrerRiderId: f.rider.id,
          referralCode: shared.referralCode,
          attributionSource: 'MOBILE_INVITE',
          inviteToken: randomUUID(),
          ruleSnapshot: {},
          termsSnapshot: 'Old',
          expiresAt: f.campaign.endAt,
        },
      });
      await expect(
        f.service.attribute(f.client.id, next.id, {
          referralCode: shared.referralCode,
          inviteToken: unused.inviteToken!,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFERRAL_LIMIT_EXCEEDED' },
      });
      expect(
        (await db.referral.findUniqueOrThrow({ where: { id: unused.id } }))
          .refereeUserId,
      ).toBeNull();
    });
    it('rejects self referral, unknown codes, expired invitations and inactive campaigns without attribution', async () => {
      const f = await fixture();
      const shared = await f.service.invite(f.client.id, f.user.id);
      const friend = await f.referee();
      await expect(
        f.service.attribute(f.client.id, f.user.id, {
          referralCode: shared.referralCode,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFERRAL_SELF_NOT_ALLOWED' },
      });
      await expect(
        f.service.attribute(f.client.id, friend.id, {
          referralCode: 'EVS-ZZZZZZZZ',
        }),
      ).rejects.toMatchObject({ response: { code: 'REFERRAL_CODE_INVALID' } });
      await expect(
        f.service.attribute(f.client.id, friend.id, {
          referralCode: shared.referralCode,
          inviteToken: 'missing',
        }),
      ).rejects.toMatchObject({ response: { code: 'REFERRAL_CODE_INVALID' } });
      const legacy = await db.referral.create({
        data: {
          clientId: f.client.id,
          campaignId: f.campaign.id,
          referrerRiderId: f.rider.id,
          referralCode: shared.referralCode,
          attributionSource: 'MOBILE_INVITE',
          inviteToken: randomUUID(),
          ruleSnapshot: {},
          termsSnapshot: 'Old',
          expiresAt: new Date(0),
        },
      });
      await expect(
        f.service.attribute(f.client.id, friend.id, {
          referralCode: shared.referralCode,
          inviteToken: legacy.inviteToken!,
        }),
      ).rejects.toMatchObject({ response: { code: 'REFERRAL_CODE_EXPIRED' } });
      await db.referralCampaign.update({
        where: { id: f.campaign.id },
        data: { endAt: new Date(0) },
      });
      await expect(
        f.service.attribute(f.client.id, friend.id, {
          referralCode: shared.referralCode,
          campaignCode: shared.campaignCode,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFERRAL_CAMPAIGN_INACTIVE' },
      });
      expect(
        await db.referral.count({
          where: { clientId: f.client.id, refereeUserId: { not: null } },
        }),
      ).toBe(0);
    });
    it('keeps client boundaries and refuses a second referrer', async () => {
      const f = await fixture();
      const other = await fixture();
      const shared = await f.service.invite(f.client.id, f.user.id);
      const foreign = await other.referee();
      await expect(
        other.service.attribute(other.client.id, foreign.id, {
          referralCode: shared.referralCode,
        }),
      ).rejects.toMatchObject({ response: { code: 'REFERRAL_CODE_INVALID' } });
      await expect(
        f.service.attribute(f.client.id, foreign.id, {
          referralCode: shared.referralCode,
        }),
      ).rejects.toMatchObject({ response: { code: 'REFERRAL_NOT_ELIGIBLE' } });
      const friend = await f.referee();
      const anotherUser = await f.referee();
      const anotherRider = await db.rider.create({
        data: {
          clientId: f.client.id,
          userId: anotherUser.id,
          name: 'Another referrer',
          mobile: anotherUser.mobile,
          status: 'ACTIVE',
        },
      });
      const anotherCode = await f.service.identity(
        f.client.id,
        anotherRider.id,
      );
      await f.service.attribute(f.client.id, friend.id, {
        referralCode: shared.referralCode,
      });
      await expect(
        f.service.attribute(f.client.id, friend.id, {
          referralCode: anotherCode.code,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFERRAL_ALREADY_ATTRIBUTED' },
      });
      expect(
        await db.referral.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
    });
  },
);
