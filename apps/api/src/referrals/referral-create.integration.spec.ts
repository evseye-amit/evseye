import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ReferralService } from './referral.service.js';

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
          shareLink: async (_client: string, code: string, token?: string) =>
            `https://example.test/referral?code=${code}${token ? `&invite=${token}` : ''}`,
        } as never,
        {} as never,
      );
      const referee = () =>
        db.user.create({
          data: {
            clientId: client.id,
            name: 'New Rider',
            mobile: '9123456789',
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
    it('creates an invite and inherits the parent client on every milestone', async () => {
      const f = await fixture();
      const result = await f.service.invite(f.client.id, f.user.id);
      expect(result.inviteToken).toBeTruthy();
      expect(result.referralCode).toMatch(/^EVS-/);
      expect(result.shareLink).toBe(result.qrPayload);
      const row = await db.referral.findUniqueOrThrow({
        where: { inviteToken: result.inviteToken! },
      });
      expect(row.status).toBe('INVITED');
      await assertProgress(
        row.id,
        f.client.id,
        f.campaign.milestones.map((m) => m.id),
      );
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
      const original = await db.referral.findUniqueOrThrow({
        where: { inviteToken: invite.inviteToken! },
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
        inviteToken: invite.inviteToken!,
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
  },
);
