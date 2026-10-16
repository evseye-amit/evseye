import { MobileDeploymentService } from '../allocations/mobile-deployment.service.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FleetManagerHomeService } from './home.service.js';
import {
  homeCountsQuery,
  homeDates,
  pendingRiderIdsQuery,
  type HomeCounts,
} from './home-metrics.js';

const url = process.env.HOME_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error(
    'HOME_TEST_DATABASE_URL must be a disposable _test_ database.',
  );
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
const service = new FleetManagerHomeService(db as never);
afterAll(() => db.$disconnect());
describe.skipIf(!url)('Fleet Manager home in PostgreSQL', () => {
  async function fixture() {
    const key = randomUUID();
    const client = await db.client.create({
      data: { name: 'Home integration', slug: key, status: 'ACTIVE' },
    });
    const clientId = client.id;
    const manager = await db.user.create({
      data: {
        clientId,
        name: 'Manager',
        mobile: '9876543210',
        role: 'FLEET_MANAGER',
      },
    });
    const hub = await db.hub.create({
      data: { clientId, code: 'HOME', name: 'Home hub', parkingSlots: 20 },
    });
    const otherHub = await db.hub.create({
      data: { clientId, code: 'OTHER', name: 'Other hub' },
    });
    await db.userHub.createMany({
      data: [
        { clientId, userId: manager.id, hubId: otherHub.id },
        { clientId, userId: manager.id, hubId: hub.id, isPrimary: true },
      ],
    });
    const oem = await db.oem.create({
      data: { code: key, name: key, displayName: key },
    });
    const category = await db.vehicleCategory.create({
      data: { code: key, name: key },
    });
    const type = await db.vehicleType.create({
      data: {
        categoryId: category.id,
        code: key,
        name: key,
        energyType: 'ELECTRIC',
      },
    });
    const fleet = (
      status: 'AVAILABLE' | 'MAINTENANCE' | 'ALLOCATED' = 'AVAILABLE',
      hubId = hub.id,
    ) =>
      db.fleet.create({
        data: {
          clientId,
          fleetCode: randomUUID(),
          chassisNumber: randomUUID(),
          oemId: oem.id,
          vehicleCategoryId: category.id,
          vehicleTypeId: type.id,
          speedType: 'SLOW_SPEED',
          onboardingStatus: 'ACTIVE',
          allocationEnabled: true,
          status,
          homeHubId: hubId,
          currentHubId: hubId,
        },
      });
    const rider = async (hubId: string | null = hub.id) => {
      const user = await db.user.create({
        data: {
          clientId,
          mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          name: 'Rider',
          role: 'RIDER',
        },
      });
      const rider = await db.rider.create({
        data: {
          clientId,
          userId: user.id,
          mobile: user.mobile,
          name: 'Rider',
          status: 'ACTIVE',
        },
      });
      if (hubId)
        await db.userHub.create({
          data: { clientId, userId: user.id, hubId, isPrimary: true },
        });
      return { ...rider, user };
    };
    return { clientId, manager, hub, otherHub, fleet, rider };
  }

  it('selects primary hub, rejects unassigned hubs and returns a useful no-hub state', async () => {
    const f = await fixture();
    const result = await service.get(f.clientId, f.manager.id);
    expect(result.hub?.id).toBe(f.hub.id);
    expect(result.summary?.fleetUtilisation.percentage).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/uptime|serviceBays|baysFree/);
    expect(
      (await service.get(f.clientId, f.manager.id, f.otherHub.id)).hub?.id,
    ).toBe(f.otherHub.id);
    const other = await fixture();
    await expect(
      service.get(f.clientId, f.manager.id, other.hub.id),
    ).rejects.toThrow('assigned hubs');
    await db.userHub.deleteMany({ where: { userId: f.manager.id } });
    expect((await service.get(f.clientId, f.manager.id)).state).toBe(
      'HUB_NOT_ASSIGNED',
    );
  });

  it('counts ready and maintenance fleet, uses allocation rows for utilisation and excludes deployed parking', async () => {
    const f = await fixture();
    await f.fleet();
    await f.fleet('MAINTENANCE');
    const allocated = await f.fleet('ALLOCATED');
    await f.fleet('AVAILABLE', f.otherHub.id);
    const rider = await f.rider();
    await db.allocation.create({
      data: {
        clientId: f.clientId,
        fleetId: allocated.id,
        riderId: rider.id,
        initiatedById: f.manager.id,
        status: 'ACTIVE',
      },
    });
    const result = await service.get(f.clientId, f.manager.id);
    expect(result.summary).toMatchObject({
      fleetUtilisation: { allocated: 1, total: 3, percentage: 33.33 },
      readyForDeployment: 1,
      underMaintenance: 1,
      pendingAllocation: 0,
    });
    expect(result.hub?.parking).toMatchObject({
      occupiedSlots: 2,
      capacity: 20,
    });
    expect(result.yesterday?.counts).toBeNull();
    expect(result.yesterday?.status).toBe('UNAVAILABLE');
  });

  it('assigns each pending rider once and matches the pending-riders drill-down', async () => {
    const f = await fixture();
    const first = await f.rider();
    const second = await f.rider(f.otherHub.id);
    await f.rider(null);
    await db.userHub.create({
      data: {
        clientId: f.clientId,
        userId: first.user.id,
        hubId: f.otherHub.id,
      },
    });
    const foreign = await fixture();
    await foreign.rider();
    expect(
      (await service.get(f.clientId, f.manager.id)).summary?.pendingAllocation,
    ).toBe(1);
    const ids = await db.$queryRaw<{ id: string }[]>(
      pendingRiderIdsQuery(f.clientId, [f.hub.id]),
    );
    expect(ids.map((r) => r.id)).toEqual([first.id]);
    const deployments = new MobileDeploymentService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(
      (await deployments.pendingRiders(f.clientId, f.manager.id, f.hub.id)).map(
        (r) => r.id,
      ),
    ).toEqual([first.id]);
    await expect(
      deployments.pendingRiders(f.clientId, f.manager.id, foreign.hub.id),
    ).rejects.toThrow('assigned hubs');
    expect(
      (
        await db.$queryRaw<{ id: string }[]>(
          pendingRiderIdsQuery(f.clientId, [f.otherHub.id]),
        )
      ).map((r) => r.id),
    ).toEqual([second.id]);
  });

  it('uses current attendance including overnight periods and counts people rather than periods', async () => {
    const f = await fixture();
    const rider = await f.rider();
    const checkInAt = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await db.attendancePeriod.createMany({
      data: [
        { clientId: f.clientId, userId: f.manager.id, checkInAt },
        { clientId: f.clientId, userId: rider.user.id, checkInAt },
      ],
    });
    const result = await service.get(f.clientId, f.manager.id);
    expect(result.manager.attendance.status).toBe('PRESENT');
    expect(result.summary).toMatchObject({
      onShift: { present: 1, total: 1 },
      riders: { present: 1, active: 1 },
    });
    await db.attendancePeriod.updateMany({
      where: { userId: rider.user.id },
      data: { checkOutAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await service.get(f.clientId, f.manager.id)).summary?.riders.present,
    ).toBe(0);
  });

  it('reconstructs yesterday from captured revisions after changes and deletion, without storing PII', async () => {
    const f = await fixture();
    const fleet = await f.fleet();
    const rider = await f.rider();
    const { cutoff } = homeDates(new Date());
    const past = new Date(cutoff.getTime() - 1000);
    await db.fleetManagerHomeHistory.updateMany({
      where: { clientId: f.clientId },
      data: { recordedAt: past },
    });
    const revision = await db.fleetManagerHomeHistory.findFirstOrThrow({
      where: { entityId: rider.user.id, entityType: 'User' },
    });
    expect(revision.data).not.toHaveProperty('mobile');
    expect(revision.data).not.toHaveProperty('name');
    await db.fleet.update({
      where: { id: fleet.id },
      data: { status: 'MAINTENANCE' },
    });
    await db.userHub.deleteMany({ where: { userId: rider.user.id } });
    const [history] = await db.$queryRaw<HomeCounts[]>(
      homeCountsQuery(f.clientId, f.hub.id, new Date(), cutoff),
    );
    expect(history).toMatchObject({
      readyForDeployment: 1,
      underMaintenance: 0,
      pendingAllocation: 1,
    });
    expect((await service.get(f.clientId, f.manager.id)).summary).toMatchObject(
      { readyForDeployment: 0, underMaintenance: 1, pendingAllocation: 0 },
    );
    // Only the isolated database's marker is moved backwards to exercise a covered yesterday.
    const coverage = await db.fleetManagerHomeHistoryCoverage.findUniqueOrThrow(
      { where: { id: 'initial' } },
    );
    try {
      await db.fleetManagerHomeHistoryCoverage.update({
        where: { id: 'initial' },
        data: { availableFrom: past },
      });
      expect(
        (await service.get(f.clientId, f.manager.id)).yesterday,
      ).toMatchObject({
        status: 'AVAILABLE',
        counts: {
          readyForDeployment: 1,
          underMaintenance: 0,
          pendingAllocation: 1,
        },
      });
    } finally {
      await db.fleetManagerHomeHistoryCoverage.update({
        where: { id: 'initial' },
        data: { availableFrom: coverage.availableFrom },
      });
    }
  });

  it('deduplicates historical return/exchange work, excludes future requests and includes unfinished checks', async () => {
    const f = await fixture();
    const { cutoff } = homeDates(new Date());
    const recordedAt = new Date(cutoff.getTime() - 1000);
    const allocationId = randomUUID();
    const returnId = randomUUID();
    const exchangeId = randomUUID();
    const history = (entityType: string, data: Record<string, unknown>) => ({
      clientId: f.clientId,
      entityType,
      entityId: String(data.id),
      recordedAt,
      data: { ...data, clientId: f.clientId },
    });
    await db.fleetManagerHomeHistory.createMany({
      data: [
        history('RentalTerminationRequest', {
          id: returnId,
          allocationId,
          plannedHubId: f.hub.id,
          status: 'RETURNED',
          submissionRequired: true,
          requestedTerminationDate: recordedAt.toISOString(),
        }),
        history('VehicleExchangeRequest', {
          id: exchangeId,
          oldAllocationId: allocationId,
          plannedHubId: f.hub.id,
          status: 'RETURN_PENDING',
          submissionRequired: true,
          plannedReturnDate: recordedAt.toISOString(),
        }),
        history('VehicleSubmission', {
          id: randomUUID(),
          allocationId,
          returnRequestId: returnId,
          exchangeRequestId: exchangeId,
          hubId: f.hub.id,
          status: 'CONFIRMED',
          mechanicChecksComplete: false,
        }),
        history('RentalTerminationRequest', {
          id: randomUUID(),
          allocationId: randomUUID(),
          plannedHubId: f.hub.id,
          status: 'REQUESTED',
          submissionRequired: true,
          requestedTerminationDate: new Date(
            cutoff.getTime() + 1000,
          ).toISOString(),
        }),
      ],
    });
    const [counts] = await db.$queryRaw<HomeCounts[]>(
      homeCountsQuery(f.clientId, f.hub.id, new Date(), cutoff),
    );
    expect(counts.pendingSubmission).toBe(1);
    const [otherCounts] = await db.$queryRaw<HomeCounts[]>(
      homeCountsQuery(f.clientId, f.otherHub.id, new Date(), cutoff),
    );
    expect(otherCounts.pendingSubmission).toBe(0);
  });

  it('does not record irrelevant updates and rolls history back with the business transaction', async () => {
    const f = await fixture();
    const fleet = await f.fleet();
    const count = () =>
      db.fleetManagerHomeHistory.count({ where: { entityId: fleet.id } });
    const original = await count();
    await db.fleet.update({
      where: { id: fleet.id },
      data: { colour: 'Blue' },
    });
    expect(await count()).toBe(original);
    await expect(
      db.$transaction(async (tx) => {
        await tx.fleet.update({
          where: { id: fleet.id },
          data: { status: 'MAINTENANCE' },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await count()).toBe(original);
    await db.fleet.delete({ where: { id: fleet.id } });
    const last = await db.fleetManagerHomeHistory.findFirstOrThrow({
      where: { entityId: fleet.id },
      orderBy: { id: 'desc' },
    });
    expect(last.data).toBeNull();
  });
});
