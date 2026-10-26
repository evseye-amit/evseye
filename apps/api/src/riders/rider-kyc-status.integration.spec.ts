import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RiderKycStatusService } from './rider-kyc-status.service.js';
import { RiderDocumentReviewService } from './rider-document-review.service.js';
import { RiderAppService } from './rider-app.service.js';

const url = process.env.RIDER_KYC_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());

describe.skipIf(!url)(
  'document approval and overall rider KYC in PostgreSQL',
  () => {
    async function fixture(withRider = true) {
      const client = await db.client.create({
        data: { name: 'KYC test', slug: randomUUID(), status: 'ACTIVE' },
      });
      const user = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Rider',
          mobile: '9876543210',
          role: 'RIDER',
        },
      });
      const manager = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Manager',
          mobile: '9876543211',
          role: 'FLEET_MANAGER',
        },
      });
      const hub = await db.hub.create({
        data: { clientId: client.id, code: 'HUB', name: 'Hub' },
      });
      await db.userHub.create({
        data: { clientId: client.id, userId: manager.id, hubId: hub.id },
      });
      const rider = withRider
        ? await db.rider.create({
            data: {
              clientId: client.id,
              userId: user.id,
              name: 'Rider',
              mobile: user.mobile,
              status: 'ACTIVE',
            },
          })
        : null;
      const feature = await db.feature.create({
        data: {
          code: randomUUID(),
          name: 'Proof',
          featureType: 'BOOLEAN',
          billingUnit: 'UPLOAD',
        },
      });
      const fields = ['AADHAAR', 'PAN'].map((fieldCode) => ({
        fieldCode,
        featureId: feature.id,
        isUpload: true,
        required: true,
        disabled: false,
      }));
      const configuration = {
        getEffectiveConfiguration: async () => ({
          package: { id: 'test' },
          onboarding: { steps: [{ fields }] },
        }),
      };
      const kyc = new RiderKycStatusService(
        db as never,
        configuration as never,
      );
      const review = new RiderDocumentReviewService(
        db as never,
        configuration as never,
        kyc,
      );
      await db.riderOnboardingProgress.create({
        data: { clientId: client.id, userId: user.id, packageId: 'test' },
      });
      const photo = async (code: string, pending = false) =>
        db.photo.create({
          data: {
            clientId: client.id,
            workFlowType: 'RIDER_ONBOARDING', subjectType: 'RIDER_DOCUMENT', entityType: 'RIDER_ONBOARDING',
            entityId: randomUUID(),
            photoType: "DOCUMENT",
            objectKey: randomUUID(),
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            status: pending ? 'PENDING_UPLOAD' : 'COMPLETE',
            uploadedById: user.id,
          },
        });
      const documents = await Promise.all(
        fields.map(async (field) =>
          db.riderOnboardingDocument.create({
            data: {
              clientId: client.id,
              userId: user.id,
              riderId: rider?.id,
              featureId: feature.id,
              fieldCode: field.fieldCode,
              photoId: (await photo(field.fieldCode)).id,
            },
          }),
        ),
      );
      const actor = {
        id: manager.id,
        clientId: client.id,
        roles: [UserRole.FLEET_MANAGER],
      };
      const app = new RiderAppService(
        db as never,
        configuration as never,
        {
          complete: async (_clientId: string, id: string) =>
            db.photo.update({ where: { id }, data: { status: 'COMPLETE' } }),
        } as never,
        kyc,
      );
      return {
        client,
        user,
        rider,
        manager,
        documents,
        fields,
        kyc,
        review,
        actor,
        photo,
        app,
      };
    }

    it.each(['dashboard', 'fleet-manager'] as const)(
      'updates KYC after the final approval through %s access',
      async (source) => {
        const f = await fixture();
        const actor =
          source === 'fleet-manager'
            ? f.actor
            : { ...f.actor, roles: [UserRole.CLIENT_ADMIN] };
        expect(
          (
            await f.review.approve(
              f.client.id,
              f.manager.id,
              f.documents[0].id,
              actor,
            )
          ).kycStatus,
        ).toBe('PENDING');
        const result = await f.review.approve(
          f.client.id,
          f.manager.id,
          f.documents[1].id,
          actor,
        );
        expect(result.kycStatus).toBe('VERIFIED');
        const rider = await db.rider.findUniqueOrThrow({
          where: { id: f.rider!.id },
        });
        expect(rider.kycStatus).toBe('VERIFIED');
        expect(rider.kycVerifiedAt).toEqual(result.kycVerifiedAt);
        expect(await f.kyc.summary(f.client.id)).toMatchObject({
          VERIFIED: 1,
          PENDING: 0,
        });
        expect(await db.riderKyc.count({ where: { riderId: rider.id } })).toBe(
          0,
        );
      },
    );

    it('clears verification on replacement, records rejection, and verifies again after reapproval', async () => {
      const f = await fixture();
      for (const document of f.documents)
        await f.review.approve(f.client.id, f.manager.id, document.id);
      const upload = await f.photo('AADHAAR', true);
      const { document } = await f.app.completeDocumentUpload(
        f.client.id,
        f.user.id,
        upload.id,
      );
      expect(
        await db.rider.findUnique({ where: { id: f.rider!.id } }),
      ).toMatchObject({ kycStatus: 'PENDING', kycVerifiedAt: null });
      await expect(
        f.review.approve(f.client.id, f.manager.id, f.documents[0].id),
      ).rejects.toThrow('not found');
      await f.review.reject(
        f.client.id,
        f.manager.id,
        document.id,
        'Unreadable proof',
      );
      expect(
        await db.rider.findUnique({ where: { id: f.rider!.id } }),
      ).toMatchObject({ kycStatus: 'FAILED', kycVerifiedAt: null });
      const second = await f.photo('AADHAAR', true);
      const replacement = await f.app.completeDocumentUpload(
        f.client.id,
        f.user.id,
        second.id,
      );
      await f.review.approve(
        f.client.id,
        f.manager.id,
        replacement.document.id,
      );
      expect(await f.kyc.summary(f.client.id)).toMatchObject({
        VERIFIED: 1,
        FAILED: 0,
      });
    });

    it('preserves approvals before a Rider exists and synchronizes when the Rider is created', async () => {
      const f = await fixture(false);
      for (const document of f.documents)
        await f.review.approve(f.client.id, f.manager.id, document.id, f.actor);
      const rider = await db.rider.create({
        data: {
          clientId: f.client.id,
          userId: f.user.id,
          name: 'Rider',
          mobile: f.user.mobile,
        },
      });
      await db.$transaction(async (tx) => {
        await f.kyc.lockUser(tx, f.client.id, f.user.id);
        await f.kyc.sync(tx, f.client.id, f.user.id, f.fields);
      });
      expect(
        await db.rider.findUnique({ where: { id: rider.id } }),
      ).toMatchObject({ kycStatus: 'VERIFIED' });
    });

    it('serializes concurrent approvals so the last document cannot leave KYC pending', async () => {
      const f = await fixture();
      await Promise.all(
        f.documents.map((document) =>
          f.review.approve(f.client.id, f.manager.id, document.id),
        ),
      );
      expect(
        await db.rider.findUnique({ where: { id: f.rider!.id } }),
      ).toMatchObject({ kycStatus: 'VERIFIED' });
    });

    it('keeps client isolation and counts historical approvals once, excluding deleted riders', async () => {
      const f = await fixture();
      await db.riderOnboardingDocument.updateMany({
        where: { clientId: f.client.id },
        data: { status: 'APPROVED', reviewedAt: new Date() },
      });
      await db.riderKyc.createMany({
        data: ['AADHAAR', 'PAN'].map((type) => ({
          clientId: f.client.id,
          riderId: f.rider!.id,
          type: type as 'AADHAAR' | 'PAN',
          status: 'VERIFIED',
        })),
      });
      expect(await f.kyc.summary(f.client.id)).toMatchObject({ VERIFIED: 1 });
      expect((await f.kyc.decorate(f.client.id, [f.rider!]))[0].kycStatus).toBe(
        'VERIFIED',
      );
      await expect(
        f.review.approve(randomUUID(), f.manager.id, f.documents[0].id),
      ).rejects.toThrow('not found');
      await db.rider.update({
        where: { id: f.rider!.id },
        data: { deletedAt: new Date() },
      });
      expect(await f.kyc.summary(f.client.id)).toMatchObject({ VERIFIED: 0 });
    });
  },
);
