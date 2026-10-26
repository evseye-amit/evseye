import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FleetReadinessService } from './readiness.service.js';
import { FleetInstallationService } from './installation.service.js';
import { defaultPolicy, defaultStages } from './readiness-policy.js';
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
  readObject: vi.fn().mockResolvedValue(new Uint8Array()),
  createPublicUrl: vi.fn(),
  assertObjectExists: vi.fn().mockResolvedValue(undefined),
  sealObject: vi.fn().mockResolvedValue(undefined),
};
const service = new FleetReadinessService(db as never, storage);
const installations = new FleetInstallationService(
  db as never,
  service,
  storage,
);
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
    const rfd = await createUser('ADVISOR', '+919000000002');
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
    // Provision fixture accounts in a dedicated mode. Simple mode disallows
    // dedicated staff management; their existing assignments survive a mode change.
    await db.client.update({ where: { id: client.id }, data: { fleetOperatingMode: 'PREPARATION_QC' } });
    await service.saveStaff(client.id, actor(admin), rfd.id, {
      assignments: [{ hubId: hub.id, canPrepare: true, canReview: true }],
    });
    await service.saveStaff(client.id, actor(admin), qc.id, {
      assignments: [{ hubId: hub.id, canPrepare: false, canReview: true }],
    });
    await service.saveStaff(client.id, actor(admin), secondQc.id, {
      assignments: [{ hubId: hub.id, canPrepare: false, canReview: true }],
    });
    await db.client.update({ where: { id: client.id }, data: { fleetOperatingMode: 'SIMPLE' } });
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
    if (prepMode) {
      await service.savePolicy(client.id, actor(admin), {
        operatingMode: 'PREPARATION_QC',
        expectedVersion: 0,
        configuration: defaultPolicy,
        reason: 'Enable independent preparation and QC.',
      });
      await db.fleet.update({
        where: { id: fleet.id },
        data: { readinessWorkflow: 'PREPARATION_QC' },
      });
    }
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
    await expect(f.start()).rejects.toThrow('does not use a preparation');
    await db.photoRequirement.create({
      data: {
        clientId: f.client.id,
        workFlowType: 'FLEET_ALLOTMENT',
        subjectType: 'FLEET',
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
        where: { clientId: f.client.id, subjectType: 'FLEET' },
      }),
    ).toMatchObject({ isRequired: true });
    expect(
      (await mobile.eligibleFleets(f.client.id, f.manager.id)).map((f) => f.id),
    ).toContain(f.fleet.id);
  });
  it('requires installed components, complete checks, and fresh preparation photos', async () => {
    const f = await fixture();
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { status: 'IN_TRANSIT' },
    });
    await expect(f.start()).rejects.toThrow('Receive the fleet');
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { status: 'PENDING_ACTIVATION' },
    });
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
    expect(
      (await service.candidates(f.client.id, f.actor(f.rfd), {})).items.map(
        (item) => item.id,
      ),
    ).toContain(f.fleet.id);
    const p = await f.start();
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('PENDING_ACTIVATION');
    const first = await f.submit(p.id);
    expect(
      first.photos.every((photo) => photo.objectKey.includes('/sealed/')),
    ).toBe(true);
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
    ).toBe(false);
    await fleets.activate(f.client.id, f.fleet.id, f.admin.id);
    expect(
      (await service.readiness(f.client.id, f.actor(f.admin), f.fleet.id))
        .canAllocate,
    ).toBe(true);
    expect(
      await db.fleetStatusHistory.count({
        where: {
          fleetId: f.fleet.id,
          fromStatus: 'PENDING_ACTIVATION',
          toStatus: 'AVAILABLE',
        },
      }),
    ).toBe(1);
  });
  it('does not approve a preparation while an active fleet remains in transit', async () => {
    const f = await fixture();
    const p = await f.start();
    await f.submit(p.id);
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { status: 'IN_TRANSIT', onboardingStatus: 'ACTIVE' },
    });

    await expect(
      service.review(f.client.id, f.actor(f.qc), p.id, { revision: 1 }, true),
    ).rejects.toThrow('Resolve maintenance or operational blocks before approval.');
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
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('PENDING_ACTIVATION');
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
    expect(current.status).toBe('PENDING_ACTIVATION');
    expect(current.allocationEnabled).toBe(false);
    expect(
      (await service.readiness(f.client.id, f.actor(f.admin), f.fleet.id))
        .blockers,
    ).toContain('Allocation is administratively disabled.');
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: { allocationEnabled: true, allocationBlockedByAdmin: false },
    });
    await fleets.activate(f.client.id, f.fleet.id, f.admin.id);
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
            where: { clientId: f.client.id, workFlowType: 'FLEET_PREPARATION', subjectType: 'FLEET' },
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
  it('previews mode changes without rewriting active preparation snapshots', async () => {
    const f = await fixture();
    const p = await f.start();
    expect(
      (
        await service.preview(f.client.id, f.actor(f.admin), {
          operatingMode: 'SIMPLE',
        })
    ).blocked,
    ).toBe(false);
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'SIMPLE',
      configuration: defaultPolicy,
      reason: 'Switch mode for new fleets',
      expectedVersion: 1,
    });
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'PREPARATION_QC',
      configuration: { ...defaultPolicy, minBatteryCount: 2 },
      reason: 'Require two batteries for future cycles',
      expectedVersion: 2,
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
  async function staged(verify = false, iot = false) {
    const definitions = iot
      ? [
          ...defaultStages,
          {
            ...defaultStages[2],
            code: 'IOT',
            name: 'IoT installation',
            component: 'IOT' as const,
          },
        ]
      : defaultStages;
    const f = await fixture(false);
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'STAGED_PREPARATION_QC',
      expectedVersion: 0,
      reason: 'Enable team stages in isolated client',
      configuration: {
        ...defaultPolicy,
        iotRequired: iot,
        stages: definitions.map((s) => ({
          ...s,
          verificationRequired: verify,
        })),
      },
    });
    await db.fleet.update({
      where: { id: f.fleet.id },
      data: {
        readinessWorkflow: 'STAGED_PREPARATION_QC',
        readinessStagePlanCode: 'standard',
      },
    });
    for (const [user, canPrepare, canReview] of [
      [f.rfd, true, false],
      [f.qc, false, true],
    ] as const)
      await service.saveStaff(f.client.id, f.actor(f.admin), user.id, {
        assignments: [
          {
            hubId: f.hub.id,
            canPrepare,
            canReview,
            stageCodes:
              user.id === f.rfd.id ? definitions.map((s) => s.code) : [],
            reviewStageCodes:
              user.id === f.qc.id ? definitions.map((s) => s.code) : [],
          },
        ],
      });
    const p = await f.start();
    const stages = await db.fleetInstallationStage.findMany({
      where: { preparationId: p.id },
    });
    const complete = async (code: string, review = verify) => {
      const row = await db.fleetInstallationStage.findUniqueOrThrow({
        where: { preparationId_code: { preparationId: p.id, code } },
      });
      await installations.action(f.client.id, f.actor(f.rfd), row.id, 'claim', {
        revision: row.revision,
      });
      let d = await installations.detail(f.client.id, f.actor(f.rfd), row.id);
      if (d.status === 'REWORK_REQUIRED') {
        await installations.action(
          f.client.id,
          f.actor(f.rfd),
          row.id,
          'rework',
          { revision: d.revision },
        );
        d = await installations.detail(f.client.id, f.actor(f.rfd), row.id);
      }
      await installations.action(f.client.id, f.actor(f.rfd), row.id, 'save', {
        revision: d.revision,
        checklist: Object.fromEntries(
          d.definition.items.map((i) => [
            i.code,
            { result: 'PASS', notes: '' },
          ]),
        ),
      });
      for (const photoType of d.requiredPhotoTypes) {
        const upload = await installations.upload(
          f.client.id,
          f.actor(f.rfd),
          row.id,
          {
            revision: d.revision,
            photoType,
            mimeType: 'image/jpeg',
            sizeBytes: 100,
          },
        );
        await installations.complete(
          f.client.id,
          f.actor(f.rfd),
          row.id,
          upload.photo.id,
          { revision: d.revision },
        );
      }
      await installations.action(
        f.client.id,
        f.actor(f.rfd),
        row.id,
        'submit',
        { revision: d.revision },
      );
      if (review)
        await installations.action(
          f.client.id,
          f.actor(f.qc),
          row.id,
          'approve',
          { revision: d.revision },
        );
      return installations.detail(f.client.id, f.actor(f.rfd), row.id);
    };
    return { ...f, p, stages, complete };
  }
  it('runs dependency stages before RFD/QC and preserves the final allocation gate', async () => {
    const f = await staged();
    const battery = f.stages.find((s) => s.code === 'BATTERY')!;
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), battery.id, 'claim', {
        revision: 1,
      }),
    ).rejects.toThrow('prerequisite');
    await expect(f.submit(f.p.id)).rejects.toThrow('installation stages');
    await f.complete('INTAKE');
    await Promise.all([f.complete('BATTERY'), f.complete('CONTROLLER')]);
    const detail = await f.submit(f.p.id);
    await service.review(
      f.client.id,
      f.actor(f.qc),
      f.p.id,
      { revision: detail.currentRevision },
      true,
    );
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('PENDING_ACTIVATION');
    await fleets.activate(f.client.id, f.fleet.id, f.admin.id);
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('AVAILABLE');
    const reprepare = await service.start(
      f.client.id,
      f.actor(f.rfd),
      f.fleet.id,
    );
    expect(reprepare.existing).toBe(false);
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('INSPECTION_PENDING');
    expect(
      await db.fleetStatusHistory.count({
        where: {
          fleetId: f.fleet.id,
          fromStatus: 'AVAILABLE',
          toStatus: 'INSPECTION_PENDING',
        },
      }),
    ).toBe(1);
    expect(
      await db.fleetInstallationStage.count({
        where: { preparationId: f.p.id, status: 'COMPLETED' },
      }),
    ).toBe(3);
  }, 30000);
  it('requires proofs, independent stage review and reasoned rejection; freezes old photos during rework', async () => {
    const f = await staged(true);
    const intake = f.stages.find((s) => s.code === 'INTAKE')!;
    await installations.action(
      f.client.id,
      f.actor(f.rfd),
      intake.id,
      'claim',
      { revision: 1 },
    );
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), intake.id, 'submit', {
        revision: 1,
      }),
    ).rejects.toThrow('checklist');
    const submitted = await f.complete('INTAKE', false);
    await service.saveStaff(f.client.id, f.actor(f.admin), f.rfd.id, {
      assignments: [
        {
          hubId: f.hub.id,
          canPrepare: true,
          canReview: true,
          stageCodes: defaultStages.map((s) => s.code),
          reviewStageCodes: ['INTAKE'],
        },
      ],
    });
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), intake.id, 'approve', {
        revision: 1,
      }),
    ).rejects.toThrow('own installation');
    await expect(
      installations.action(f.client.id, f.actor(f.qc), intake.id, 'reject', {
        revision: 1,
      }),
    ).rejects.toThrow('reason');
    await installations.action(
      f.client.id,
      f.actor(f.qc),
      intake.id,
      'reject',
      {
        revision: 1,
        reason: 'Chassis label unreadable',
        failedItems: ['IDENTITY'],
      },
    );
    await expect(
      db.photo.update({
        where: { id: submitted.photos[0].id },
        data: { status: 'DELETED' },
      }),
    ).rejects.toThrow('immutable');
    await installations.action(
      f.client.id,
      f.actor(f.rfd),
      intake.id,
      'rework',
      { revision: 1 },
    );
    const rework = await installations.detail(
      f.client.id,
      f.actor(f.rfd),
      intake.id,
    );
    expect(rework.revision).toBe(2);
    expect(rework.photos).toHaveLength(0);
    expect(rework.history).toHaveLength(2);
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), intake.id, 'save', {
        revision: 1,
        checklist: {},
      }),
    ).rejects.toThrow('Revision');
    expect(
      (
        await installations.download(
          f.client.id,
          f.actor(f.rfd),
          intake.id,
          submitted.photos[0].id,
        )
      ).url,
    ).toBeTruthy();
  });
  it('invalidates battery work after replacement while retaining unrelated controller work', async () => {
    const f = await staged();
    await f.complete('INTAKE');
    await f.complete('BATTERY');
    await f.complete('CONTROLLER');
    const row = f.stages.find((s) => s.code === 'BATTERY')!;
    await db.battery.update({
      where: { id: f.battery.id },
      data: { serialNumber: 'REVISED-SERIAL' },
    });
    const battery = await db.fleetInstallationStage.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(battery.status).toBe('WAITING');
    expect(battery.revision).toBe(2);
    expect(
      (
        await db.fleetInstallationStage.findUniqueOrThrow({
          where: { id: f.stages.find((s) => s.code === 'CONTROLLER')!.id },
        })
      ).status,
    ).toBe('COMPLETED');
    expect(
      (await db.fleetPreparation.findUniqueOrThrow({ where: { id: f.p.id } }))
        .status,
    ).toBe('IN_PROGRESS');
    await expect(f.submit(f.p.id)).rejects.toThrow('installation stages');
  });
  it('enforces tenant, hub and explicit stage permissions and cannot steal installed hardware', async () => {
    const f = await staged(),
      other = await staged();
    const intake = f.stages.find((s) => s.code === 'INTAKE')!;
    await expect(
      installations.detail(
        f.client.id,
        other.actor(other.admin),
        other.stages[0].id,
      ),
    ).rejects.toThrow('not found');
    await expect(
      installations.action(
        f.client.id,
        f.actor(f.manager),
        intake.id,
        'claim',
        { revision: 1 },
      ),
    ).rejects.toThrow();
    await f.complete('INTAKE');
    const battery = f.stages.find((s) => s.code === 'BATTERY')!;
    await installations.action(
      f.client.id,
      f.actor(f.rfd),
      battery.id,
      'claim',
      { revision: 1 },
    );
    await expect(
      installations.action(
        f.client.id,
        f.actor(f.rfd),
        battery.id,
        'components',
        { revision: 1, batteryIds: [other.battery.id] },
      ),
    ).rejects.toThrow('unavailable');
    const foreign = await db.fleet.create({
      data: {
        clientId: f.client.id,
        fleetCode: 'OTHER',
        chassisNumber: randomUUID(),
        oemId: f.fleet.oemId,
        vehicleCategoryId: f.fleet.vehicleCategoryId,
        vehicleTypeId: f.fleet.vehicleTypeId,
        speedType: 'SLOW_SPEED',
        ownershipType: 'CLIENT_OWNED',
        currentHubId: f.hub.id,
      },
    });
    const owned = await db.battery.create({
      data: {
        clientId: f.client.id,
        serialNumber: 'OWNED',
        batteryType: 'FIXED_SINGLE',
        status: 'INSTALLED',
      },
    });
    await db.fleetBatteryHistory.create({
      data: {
        fleetId: foreign.id,
        batteryId: owned.id,
        installedAt: new Date(),
      },
    });
    await expect(
      installations.action(
        f.client.id,
        f.actor(f.rfd),
        battery.id,
        'components',
        { revision: 1, batteryIds: [owned.id] },
      ),
    ).rejects.toThrow('another scooter');
    const inventory = await installations.inventory(
      f.client.id,
      f.actor(f.rfd),
      battery.id,
      { search: 'OWNED', page: 1, limit: 1 },
    );
    expect(inventory.items).toHaveLength(0);
    const available = await installations.inventory(
      f.client.id,
      f.actor(f.rfd),
      battery.id,
      { search: 'BATTERY', page: 1, limit: 1 },
    );
    expect(available.total).toBe(1);
    expect(available.items[0].label).toBe('BATTERY');
  });
  it('supports installation-only staff and snapshots stages across policy updates', async () => {
    const f = await staged();
    await service.saveStaff(f.client.id, f.actor(f.admin), f.rfd.id, {
      assignments: [
        {
          hubId: f.hub.id,
          canPrepare: false,
          canReview: false,
          stageCodes: ['INTAKE'],
          reviewStageCodes: [],
        },
      ],
    });
    const context = await service.context(f.client.id, f.actor(f.rfd));
    expect(context.hubs.map((h) => h.id)).toContain(f.hub.id);
    expect(context.prepareHubIds).toHaveLength(0);
    const list = await installations.list(f.client.id, f.actor(f.rfd), {
      page: 1,
      limit: 1,
    });
    expect(list.total).toBe(3);
    expect(list.items).toHaveLength(1);
    await service.savePolicy(f.client.id, f.actor(f.admin), {
      operatingMode: 'STAGED_PREPARATION_QC',
      expectedVersion: 1,
      reason: 'New stage policy for future cycles',
      configuration: { ...defaultPolicy, stages: [defaultStages[0]] },
    });
    expect(
      (await service.detail(f.client.id, f.actor(f.rfd), f.p.id)).stages,
    ).toHaveLength(3);
    const otherHub = await db.fleet.update({
      where: { id: f.fleet.id },
      data: { currentHubId: f.otherHub.id },
    });
    expect(otherHub.readinessApprovedPreparationId).toBeNull();
    await expect(
      installations.action(
        f.client.id,
        f.actor(f.rfd),
        f.stages[0].id,
        'claim',
        { revision: 1 },
      ),
    ).rejects.toThrow('moved hubs');
  });
  it('rejects cyclic stage policies and makes simultaneous claims exclusive', async () => {
    const f = await staged();
    await expect(
      service.savePolicy(f.client.id, f.actor(f.admin), {
        operatingMode: 'STAGED_PREPARATION_QC',
        expectedVersion: 1,
        reason: 'Invalid cycle',
        configuration: {
          ...defaultPolicy,
          stages: [
            { ...defaultStages[0], dependencies: ['BATTERY'] },
            defaultStages[1],
          ],
        },
      }),
    ).rejects.toThrow('cycle');
    await service.saveStaff(f.client.id, f.actor(f.admin), f.secondQc.id, {
      assignments: [
        {
          hubId: f.hub.id,
          canPrepare: false,
          canReview: false,
          stageCodes: ['INTAKE'],
        },
      ],
    });
    const id = f.stages.find((s) => s.code === 'INTAKE')!.id;
    const results = await Promise.allSettled([
      installations.action(f.client.id, f.actor(f.rfd), id, 'claim', {
        revision: 1,
      }),
      installations.action(f.client.id, f.actor(f.secondQc), id, 'claim', {
        revision: 1,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('atomically installs new hardware, resets only dependent evidence, and requires proofs for both batteries', async () => {
    const f = await staged();
    await f.complete('INTAKE');
    await f.complete('CONTROLLER');
    await f.fill(f.p.id);
    const stage = f.stages.find((s) => s.code === 'BATTERY')!;
    await installations.action(f.client.id, f.actor(f.rfd), stage.id, 'claim', {
      revision: 1,
    });
    const added = await db.battery.create({
      data: {
        clientId: f.client.id,
        serialNumber: 'NEW-BATTERY',
        batteryType: 'FIXED_SINGLE',
      },
    });
    const result = await installations.action(
      f.client.id,
      f.actor(f.rfd),
      stage.id,
      'components',
      { revision: 1, batteryIds: [added.id, f.battery.id] },
    );
    expect(result.revision).toBeGreaterThan(1);
    let detail = await installations.detail(
      f.client.id,
      f.actor(f.rfd),
      stage.id,
    );
    expect(detail.requiredPhotoTypes).toHaveLength(4);
    expect(
      (
        await db.fleetBatteryHistory.findMany({
          where: { fleetId: f.fleet.id, removedAt: null },
        })
      )
        .map((b) => b.batterySlot)
        .sort(),
    ).toEqual(['PRIMARY', 'SECONDARY']);
    expect(
      (await db.fleetPreparation.findUniqueOrThrow({ where: { id: f.p.id } }))
        .currentRevision,
    ).toBe(2);
    await installations.action(f.client.id, f.actor(f.rfd), stage.id, 'claim', {
      revision: detail.revision,
    });
    await installations.action(f.client.id, f.actor(f.rfd), stage.id, 'save', {
      revision: detail.revision,
      checklist: { INSTALLATION: { result: 'PASS', notes: '' } },
    });
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), stage.id, 'submit', {
        revision: detail.revision,
      }),
    ).rejects.toThrow('all stage photos');
    detail = await f.complete('BATTERY');
    expect(detail.status).toBe('COMPLETED');
    expect(
      (
        await db.fleetInstallationStage.findUniqueOrThrow({
          where: { id: f.stages.find((s) => s.code === 'CONTROLLER')!.id },
        })
      ).status,
    ).toBe('COMPLETED');
    const submitted = await f.submit(f.p.id);
    await service.review(
      f.client.id,
      f.actor(f.qc),
      f.p.id,
      { revision: submitted.currentRevision },
      true,
    );
    await db.battery.update({
      where: { id: added.id },
      data: { serialNumber: 'EDIT-AFTER-QC' },
    });
    expect(
      (await db.fleetPreparation.findUniqueOrThrow({ where: { id: f.p.id } }))
        .status,
    ).toBe('INVALIDATED');
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } }))
        .readinessApprovedPreparationId,
    ).toBeNull();
  }, 30000);
  it('cancels the complete readiness cycle with a reason and blocks further installation writes', async () => {
    const f = await staged();
    const stage = f.stages.find((s) => s.code === 'INTAKE')!;
    await expect(
      service.cancel(f.client.id, f.actor(f.admin), f.p.id, {
        revision: 1,
        reason: '',
      }),
    ).rejects.toThrow();
    await service.cancel(f.client.id, f.actor(f.admin), f.p.id, {
      revision: 1,
      reason: 'Vehicle withdrawn from preparation',
    });
    await expect(
      installations.action(f.client.id, f.actor(f.rfd), stage.id, 'claim', {
        revision: 1,
      }),
    ).rejects.toThrow('no longer editable');
    const list = await installations.list(f.client.id, f.actor(f.admin), {});
    expect(list.items).toHaveLength(0);
  });
  it('supports optional IoT installation without enabling it for Simple clients', async () => {
    const f = await staged(false, true);
    await f.complete('INTAKE');
    const stage = f.stages.find((s) => s.code === 'IOT')!;
    await installations.action(f.client.id, f.actor(f.rfd), stage.id, 'claim', {
      revision: 1,
    });
    const device = await db.ioTDevice.create({
      data: {
        clientId: f.client.id,
        deviceNumber: 'TEST-IOT',
        ingestSecretHash: 'test-only-hash',
        status: 'DAMAGED',
      },
    });
    await expect(
      installations.action(
        f.client.id,
        f.actor(f.rfd),
        stage.id,
        'components',
        { revision: 1, iotDeviceId: device.id },
      ),
    ).rejects.toThrow('unavailable');
    await db.ioTDevice.update({
      where: { id: device.id },
      data: { status: 'UNASSIGNED' },
    });
    const response = await installations.action(
      f.client.id,
      f.actor(f.rfd),
      stage.id,
      'components',
      { revision: 1, iotDeviceId: device.id },
    );
    expect(response.revision).toBe(2);
    expect(
      (await db.ioTDevice.findUniqueOrThrow({ where: { id: device.id } }))
        .status,
    ).toBe('ACTIVE');
    expect((await f.complete('IOT')).status).toBe('COMPLETED');
    expect((await service.policy(f.client.id)).configuration.iotRequired).toBe(
      true,
    );
  });
});
