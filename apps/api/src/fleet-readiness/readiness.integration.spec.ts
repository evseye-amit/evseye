import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FleetReadinessService } from './readiness.service.js';
import { defaultPolicy } from './readiness-policy.js';
import { FleetsService } from '../fleets/fleets.service.js';
import { FleetStatusPolicy } from '../fleets/fleet-status.policy.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { MobileDeploymentService } from '../allocations/mobile-deployment.service.js';
import { MediaService } from '../media/media.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
const url = process.env.READINESS_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
const storage = {
  createUploadUrl: vi.fn().mockResolvedValue('http://storage/upload'),
  createDownloadUrl: vi.fn().mockResolvedValue('http://storage/photo'),
  createPublicUrl: vi.fn(),
  assertObjectExists: vi.fn().mockResolvedValue(undefined),
  sealObject: vi.fn().mockResolvedValue(undefined),
};
const service = new FleetReadinessService(db as never, storage);
const fleets = new FleetsService(db as never, new FleetStatusPolicy());
const allocations = new AllocationsService(db as never, {} as never);
const mobile = new MobileDeploymentService(
  db as never,
  allocations,
  {} as never,
  {} as never,
  {} as never,
);
afterAll(() => db.$disconnect());

describe.skipIf(!url)('Preparation + QC lifecycle in PostgreSQL', () => {
  async function fixture(prepMode = true) {
    const key = randomUUID();
    const client = await db.client.create({
      data: { name: 'Readiness test', slug: key, status: 'ACTIVE' },
    });
    const createUser = async (role: UserRole, mobile: string) =>
      db.user.create({
        data: { clientId: client.id, name: role, mobile, role },
      });
    const admin = await createUser('CLIENT_ADMIN', '+919000000001');
    const rfd = await createUser('RFD_MANAGER', '+919000000002');
    const qc = await createUser('QC_MANAGER', '+919000000003');
    const manager = await createUser('FLEET_MANAGER', '+919000000004');
    const secondQc = await createUser('QC_MANAGER', '+919000000005');
    const actor = (user: typeof admin): AuthUser => ({
      id: user.id,
      clientId: client.id,
      roles: [user.role],
    });
    const hub = await db.hub.create({
      data: { clientId: client.id, code: 'HUB', name: 'Hub' },
    });
    const otherHub = await db.hub.create({
      data: { clientId: client.id, code: 'OTHER', name: 'Other' },
    });
    const oem = await db.oem.create({
      data: { code: key, name: key, displayName: key },
    });
    const cat = await db.vehicleCategory.create({
      data: { code: key, name: key },
    });
    const type = await db.vehicleType.create({
      data: {
        code: key,
        name: key,
        categoryId: cat.id,
        energyType: 'ELECTRIC',
      },
    });
    const fleet = await fleets.create(client.id, {
      fleetCode: 'TEST',
      chassisNumber: key,
      oemId: oem.id,
      vehicleCategoryId: cat.id,
      vehicleTypeId: type.id,
      speedType: 'SLOW_SPEED',
      ownershipType: 'CLIENT_OWNED',
      currentHubId: hub.id,
    });
    await service.saveStaff(client.id, actor(admin), rfd.id, {
      assignments: [{ hubId: hub.id, canPrepare: true, canReview: true }],
    });
    await service.saveStaff(client.id, actor(admin), qc.id, {
      assignments: [{ hubId: hub.id, canPrepare: false, canReview: true }],
    });
    await service.saveStaff(client.id, actor(admin), secondQc.id, {
      assignments: [{ hubId: hub.id, canPrepare: false, canReview: true }],
    });
    await db.userHub.create({
      data: { clientId: client.id, userId: manager.id, hubId: hub.id },
    });
    const battery = await db.battery.create({
      data: {
        clientId: client.id,
        serialNumber: 'BATTERY',
        batteryType: 'FIXED_SINGLE',
      },
    });
    await db.fleetBatteryHistory.create({
      data: {
        fleetId: fleet.id,
        batteryId: battery.id,
        installedAt: new Date(),
      },
    });
    const controller = await db.controller.create({
      data: { clientId: client.id, controllerNumber: 'CONTROLLER' },
    });
    await db.fleetControllerHistory.create({
      data: {
        fleetId: fleet.id,
        controllerId: controller.id,
        installedAt: new Date(),
      },
    });
    if (prepMode)
      await service.savePolicy(client.id, actor(admin), {
        operatingMode: 'PREPARATION_QC',
        expectedVersion: 0,
        configuration: defaultPolicy,
        reason: 'Enable independent preparation and QC.',
      });
    const start = async () => service.start(client.id, actor(rfd), fleet.id);
    const fill = async (id: string) => {
      let detail = await service.detail(client.id, actor(rfd), id);
      await service.save(client.id, actor(rfd), id, {
        revision: detail.currentRevision,
        odometerKm: 123,
        checklist: Object.fromEntries(
          detail.configuration.items.map((item) => [
            item.code,
            { result: 'PASS', notes: '' },
          ]),
        ),
      });
      detail = await service.detail(client.id, actor(rfd), id);
      for (const photoType of detail.requiredPhotoTypes) {
        const intent = await service.upload(client.id, actor(rfd), id, {
          revision: detail.currentRevision,
          photoType,
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          sizeBytes: 100,
        });
        await service.completePhoto(
          client.id,
          actor(rfd),
          id,
          intent.photo.id,
          { revision: detail.currentRevision },
        );
      }
      return service.detail(client.id, actor(rfd), id);
    };
    const submit = async (id: string) => {
      const detail = await fill(id);
      await service.submit(client.id, actor(rfd), id, {
        revision: detail.currentRevision,
      });
      return service.detail(client.id, actor(qc), id);
    };
    return {
      client,
      admin,
      rfd,
      qc,
      secondQc,
      manager,
      actor,
      hub,
      otherHub,
      fleet,
      battery,
      controller,
      start,
      fill,
      submit,
    };
  }
  it('keeps Simple mode and mandatory inspection policy independent of preparation', async () => {
    const f = await fixture(false);
    expect((await service.policy(f.client.id)).operatingMode).toBe('SIMPLE');
    await fleets.activate(f.client.id, f.fleet.id, f.admin.id);
    expect(
      (await mobile.eligibleFleets(f.client.id, f.manager.id)).map((f) => f.id),
    ).toContain(f.fleet.id);
    await expect(f.start()).rejects.toThrow('Enable Preparation + QC');
    await db.photoRequirement.create({
      data: {
        clientId: f.client.id,
        entityType: 'INSPECTION',
        photoType: 'FRONT',
      },
    });
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'PREPARATION_QC',
      configuration: defaultPolicy,
      reason: 'Enable QC',
      expectedVersion: 0,
    });
    expect(
      await db.photoRequirement.findFirst({
        where: { clientId: f.client.id, entityType: 'INSPECTION' },
      }),
    ).toMatchObject({ isRequired: true });
    expect(
      (await mobile.eligibleFleets(f.client.id, f.manager.id)).map((f) => f.id),
    ).not.toContain(f.fleet.id);
  });
  it('requires installed components, complete checks, and fresh preparation photos', async () => {
    const f = await fixture();
    const p = await f.start();
    await expect(
      service.submit(f.client.id, f.actor(f.rfd), p.id, { revision: 1 }),
    ).rejects.toThrow('Complete all applicable');
    await service.save(f.client.id, f.actor(f.rfd), p.id, {
      revision: 1,
      odometerKm: 123,
      checklist: Object.fromEntries(
        defaultPolicy.items.map((item) => [
          item.code,
          { result: 'PASS', notes: '' },
        ]),
      ),
    });
    await expect(
      service.submit(f.client.id, f.actor(f.rfd), p.id, { revision: 1 }),
    ).rejects.toThrow('Required preparation photos are missing');
    const d = await f.fill(p.id);
    expect(d.requiredPhotoTypes).toHaveLength(9);
    expect(d.requiredPhotoTypes).not.toContain('IOT_INSTALLATION');
    await db.fleetBatteryHistory.updateMany({
      where: { fleetId: f.fleet.id },
      data: { removedAt: new Date() },
    });
    expect(
      (await service.detail(f.client.id, f.actor(f.rfd), p.id)).status,
    ).toBe('INVALIDATED');
    const next = await f.start();
    await expect(
      service.submit(f.client.id, f.actor(f.rfd), next.id, { revision: 1 }),
    ).rejects.toThrow('Required installed components');
  });
  it('prevents self-review, freezes submitted photos, rejects with reason, and keeps rework revisions separate', async () => {
    const f = await fixture();
    const p = await f.start();
    const first = await f.submit(p.id);
    expect(first.photos.every(photo=>photo.objectKey.includes('/sealed/'))).toBe(true);
    await service.submit(f.client.id, f.actor(f.rfd), p.id, { revision: 1 });
    expect(
      await db.fleetPreparationEvent.count({
        where: {
          clientId: f.client.id,
          preparationId: p.id,
          action: 'SUBMITTED',
        },
      }),
    ).toBe(1);
    await expect(
      service.review(f.client.id, f.actor(f.rfd), p.id, { revision: 1 }, true),
    ).rejects.toThrow('cannot approve or reject their own');
    await expect(
      service.review(f.client.id, f.actor(f.qc), p.id, { revision: 1 }, false),
    ).rejects.toThrow('Rejection requires');
    await expect(
      service.upload(f.client.id, f.actor(f.rfd), p.id, {
        revision: 1,
        photoType: 'FRONT',
        mimeType: 'image/jpeg',
        fileName: 'p.jpg',
        sizeBytes: 100,
      }),
    ).rejects.toThrow('not editable');
    const media = new MediaService(db as never, storage);
    await expect(
      media.complete(f.client.id, first.photos[0]!.id),
    ).rejects.toThrow();
    await expect(
      db.photo.update({
        where: { id: first.photos[0]!.id },
        data: { status: 'DELETED' },
      }),
    ).rejects.toThrow('immutable');
    await service.review(
      f.client.id,
      f.actor(f.qc),
      p.id,
      {
        revision: 1,
        reason: 'Front tyre condition unclear.',
        failedItems: ['TYRES'],
      },
      false,
    );
    await service.save(f.client.id, f.actor(f.rfd), p.id, {
      revision: 1,
      odometerKm: 124,
      checklist: Object.fromEntries(
        defaultPolicy.items.map((item) => [
          item.code,
          { result: 'PASS', notes: '' },
        ]),
      ),
    });
    const second = await service.detail(f.client.id, f.actor(f.rfd), p.id);
    expect(second.currentRevision).toBe(2);
    expect(second.current.id).not.toBe(first.current.id);
    await expect(
      service.submit(f.client.id, f.actor(f.rfd), p.id, { revision: 2 }),
    ).rejects.toThrow('Required preparation photos');
    expect(
      second.revisions.find((r) => r.revision === 1)?.rejectionReason,
    ).toBe('Front tyre condition unclear.');
    await f.submit(p.id);
    await service.review(
      f.client.id,
      f.actor(f.qc),
      p.id,
      { revision: 2 },
      true,
    );
    expect(
      (await service.readiness(f.client.id, f.actor(f.admin), f.fleet.id))
        .canAllocate,
    ).toBe(true);
  });
  it('atomically approves once, gates allocation/exchange entry, preserves administrative blocks, and invalidates component changes', async () => {
    const f = await fixture();
    const p = await f.start();
    await f.submit(p.id);
    const user = await db.user.create({
      data: {
        clientId: f.client.id,
        name: 'Rider',
        mobile: '+919000000006',
        role: 'RIDER',
      },
    });
    const rider = await db.rider.create({
      data: {
        clientId: f.client.id,
        userId: user.id,
        name: 'Rider',
        mobile: user.mobile,
        status: 'ACTIVE',
      },
    });
    const allocation = () =>
      db.allocation.create({
        data: {
          clientId: f.client.id,
          fleetId: f.fleet.id,
          riderId: rider.id,
          initiatedById: f.manager.id,
          status: 'INSPECTION_PENDING',
        },
      });
    await expect(allocation()).rejects.toThrow('PREPARATION_QC_REQUIRED');
    await fleets.update(f.client.id, f.fleet.id, { allocationEnabled: false });
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { status: 'AVAILABLE' },
    });
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('INSPECTION_PENDING');
    const results = await Promise.allSettled([
      service.review(f.client.id, f.actor(f.qc), p.id, { revision: 1 }, true),
      service.review(
        f.client.id,
        f.actor(f.secondQc),
        p.id,
        { revision: 1 },
        true,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    let current = await db.fleet.findUniqueOrThrow({
      where: { id: f.fleet.id },
    });
    expect(current.status).toBe('AVAILABLE');
    expect(current.allocationEnabled).toBe(false);
    expect(
      (await service.readiness(f.client.id, f.actor(f.admin), f.fleet.id))
        .blockers,
    ).toContain('Allocation is administratively disabled.');
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { allocationEnabled: true, allocationBlockedByAdmin: false },
    });
    const a = await allocation();
    await db.battery.update({
      where: { id: f.battery.id },
      data: { serialNumber: 'REPLACED-SERIAL' },
    });
    current = await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } });
    expect(current.readinessApprovedPreparationId).toBeNull();
    await expect(
      db.allocation.update({ where: { id: a.id }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow('PREPARATION_QC_REQUIRED');
  });
  it('scopes preparations, photos and permissions to client/hub and invalidates hub transfers', async () => {
    const f = await fixture();
    const p = await f.start();
    await f.submit(p.id);
    const other = await fixture();
    await expect(
      service.detail(other.client.id, other.actor(other.admin), p.id),
    ).rejects.toThrow('Preparation not found');
    await service.saveStaff(f.client.id, f.actor(f.admin), f.qc.id, {
      assignments: [
        { hubId: f.otherHub.id, canReview: true, canPrepare: false },
      ],
    });
    await expect(
      service.review(f.client.id, f.actor(f.qc), p.id, { revision: 1 }, true),
    ).rejects.toThrow('requires readiness permission');
    await expect(
      service.saveStaff(f.client.id, f.actor(f.rfd), f.rfd.id, {
        assignments: [],
      }),
    ).rejects.toThrow('Client Admin');
    await expect(
      service.saveStaff(f.client.id, f.actor(f.admin), other.rfd.id, {
        assignments: [],
      }),
    ).rejects.toThrow('Active operations user');
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { currentHubId: f.otherHub.id },
    });
    expect(
      (await db.fleetPreparation.findUniqueOrThrow({ where: { id: p.id } }))
        .status,
    ).toBe('INVALIDATED');
    await expect(
      service.download(
        f.client.id,
        f.actor(f.rfd),
        p.id,
        (
          await db.photo.findFirstOrThrow({
            where: { clientId: f.client.id, entityType: 'PREPARATION' },
          })
        ).id,
      ),
    ).rejects.toThrow('requires readiness permission');
  });
  it('allows management to cancel submitted preparation without permitting stale QC approval', async () => {
    const f = await fixture();
    const p = await f.start();
    await f.submit(p.id);
    await expect(
      service.cancel(f.client.id, f.actor(f.rfd), p.id, {
        revision: 1,
        reason: 'Wrong cycle',
      }),
    ).rejects.toThrow('Operations management');
    await service.cancel(f.client.id, f.actor(f.admin), p.id, {
      revision: 1,
      reason: 'Scooter removed from preparation schedule',
    });
    await expect(
      service.review(f.client.id, f.actor(f.qc), p.id, { revision: 1 }, true),
    ).rejects.toThrow('no longer awaiting review');
    expect(
      (
        await service.preview(f.client.id, f.actor(f.admin), {
          operatingMode: 'SIMPLE',
        })
      ).blocked,
    ).toBe(false);
  });
  it('previews mode changes, blocks changes during preparation, and snapshots policy versions', async () => {
    const f = await fixture();
    const p = await f.start();
    expect(
      (
        await service.preview(f.client.id, f.actor(f.admin), {
          operatingMode: 'SIMPLE',
        })
      ).blocked,
    ).toBe(true);
    await expect(
      service.savePolicy(f.client.id, f.actor(f.admin), {
        operatingMode: 'SIMPLE',
        configuration: defaultPolicy,
        reason: 'Switch mode',
        expectedVersion: 1,
      }),
    ).rejects.toThrow();
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'PREPARATION_QC',
      configuration: { ...defaultPolicy, minBatteryCount: 2 },
      reason: 'Require two batteries for future cycles',
      expectedVersion: 1,
    });
    const d = await service.detail(f.client.id, f.actor(f.rfd), p.id);
    expect(d.configuration.minBatteryCount).toBe(1);
    await expect(
      service.savePolicy(f.client.id, f.actor(f.admin), {
        operatingMode: 'PREPARATION_QC',
        configuration: defaultPolicy,
        reason: 'Stale save',
        expectedVersion: 1,
      }),
    ).rejects.toThrow('Policy changed');
    await service.maintenance(f.client.id, f.actor(f.rfd), p.id, {
      revision: 1,
      reason: 'Brake repair required',
    });
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('MAINTENANCE');
    await expect(f.start()).rejects.toThrow('Finish maintenance');
  });
});
