import { createTestPrisma } from '../helpers/prisma-client.js';
import 'reflect-metadata';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type FleetStatus } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { FleetSearchService } from '../../src/allocations/fleet-search.service.js';
import { FleetSearchQueryDto } from '../../src/allocations/fleet-search.controller.js';
import { FleetManagerActionGuard } from '../../src/auth/guards/fleet-manager-action.guard.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { FleetsController } from '../../src/fleets/fleets.controller.js';
import { InspectionsController } from '../../src/inspections/inspections.controller.js';
import { MediaController } from '../../src/media/media.controller.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';

const url = process.env.FLEET_SEARCH_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());
const media = {
  downloadUrl: vi.fn(async (_client: string, id: string) => ({
    url: `https://signed.test/${id}`,
  })),
};
const service = new FleetSearchService(
  db as never,
  media as never,
  { get: () => 300 } as never,
);
const guard = new FleetManagerActionGuard(
  db as never,
  new ClientContextService(),
  new Reflector(),
);
const query = (overrides: Partial<FleetSearchQueryDto> = {}) =>
  Object.assign(new FleetSearchQueryDto(), overrides);
function context(
  actor: AuthUser,
  controller:
    | typeof FleetsController
    | typeof InspectionsController
    | typeof MediaController,
  params: Record<string, string>,
  body: Record<string, unknown> = {},
  method = 'PATCH',
) {
  return {
    getClass: () => controller,
    getHandler: () => function action() {},
    switchToHttp: () => ({
      getRequest: () => ({ user: actor, params, body, method }),
    }),
  } as unknown as ExecutionContext;
}

describe.skipIf(!url)(
  'Global scooter search and action permissions in PostgreSQL',
  () => {
    async function fixture() {
      const key = randomUUID();
      const client = await db.client.create({
        data: { name: 'Global search', slug: key, status: 'ACTIVE' },
      });
      const manager = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Manager',
          mobile: '9876543210',
          role: 'FLEET_MANAGER',
        },
      });
      const own = await db.hub.create({
        data: { clientId: client.id, name: 'Assigned hub', code: 'OWN' },
      });
      const other = await db.hub.create({
        data: { clientId: client.id, name: 'Other hub', code: 'OTHER' },
      });
      await db.userHub.create({
        data: { clientId: client.id, userId: manager.id, hubId: own.id },
      });
      const oem = await db.oem.create({
        data: { code: key, name: 'OEM', displayName: 'OEM' },
      });
      const category = await db.vehicleCategory.create({
        data: { code: key, name: 'Scooter' },
      });
      const type = await db.vehicleType.create({
        data: {
          categoryId: category.id,
          code: key,
          name: 'Electric',
          energyType: 'ELECTRIC',
        },
      });
      const fleet = (
        code: string,
        hubId: string | null = own.id,
        status: FleetStatus = 'AVAILABLE',
      ) =>
        db.fleet.create({
          data: {
            clientId: client.id,
            fleetCode: code,
            chassisNumber: `CH-${code}`,
            vehicleNumber: `DL-${code}`,
            oemId: oem.id,
            vehicleCategoryId: category.id,
            vehicleTypeId: type.id,
            modelName: 'Model',
            currentHubId: hubId,
            status,
            onboardingStatus: 'ACTIVE',
            speedType: 'SLOW_SPEED',
          },
        });
      const actor: AuthUser = {
        id: manager.id,
        clientId: client.id,
        roles: ['FLEET_MANAGER'],
      };
      async function inspection(fleetId: string) {
        const rider = await db.rider.create({
          data: {
            clientId: client.id,
            name: 'Rider name',
            mobile: randomUUID().slice(0, 10),
            status: 'ACTIVE',
          },
        });
        const allocation = await db.allocation.create({
          data: {
            clientId: client.id,
            riderId: rider.id,
            fleetId,
            initiatedById: manager.id,
            status: 'ACTIVE',
          },
        });
        const inspection = await db.inspection.create({
          data: {
            clientId: client.id,
            allocationId: allocation.id,
            type: 'PRE_ALLOCATION',
          },
        });
        const photo = await db.photo.create({
          data: {
            clientId: client.id,
            entityId: inspection.id,
            workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', photoType: 'FRONT',
            objectKey: randomUUID(),
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            uploadedById: manager.id,
            status: 'COMPLETE',
            uploadedAt: new Date(),
          },
        });
        return { rider, allocation, inspection, photo };
      }
      return { client, manager, actor, own, other, fleet, inspection };
    }

    it('searches all client hubs, scopes tenants, supports filters and pagination', async () => {
      const f = await fixture();
      const a = await f.fleet('A-001');
      const b = await f.fleet('B-002', f.other.id, 'MAINTENANCE');
      await f.fleet('C-003', null);
      const deleted = await f.fleet('D-004');
      await db.fleet.update({
        where: { id: deleted.id },
        data: { deletedAt: new Date() },
      });
      const foreign = await fixture();
      const foreignFleet = await foreign.fleet('B-002');
      const first = await service.search(
        f.client.id,
        f.manager.id,
        query({ limit: 2 }),
      );
      expect(first.meta.total).toBe(3);
      expect(first.data.map((r) => r.id)).toEqual([a.id, b.id]);
      expect(first.data.map((r) => r.access.canManage)).toEqual([true, false]);
      expect(
        (
          await service.search(
            f.client.id,
            f.manager.id,
            query({ page: 2, limit: 2 }),
          )
        ).data[0]!.access.canManage,
      ).toBe(false);
      expect(
        (
          await service.search(
            f.client.id,
            f.manager.id,
            query({
              search: 'ch-b-002',
              hubId: f.other.id,
              status: 'MAINTENANCE',
            }),
          )
        ).data.map((r) => r.id),
      ).toEqual([b.id]);
      expect(
        (
          await service.search(
            f.client.id,
            f.manager.id,
            query({ search: 'dl-b' }),
          )
        ).data.map((r) => r.id),
      ).toEqual([b.id]);
      await expect(
        service.get(f.client.id, f.manager.id, foreignFleet.id),
      ).rejects.toThrow('not found');
      await expect(
        service.get(f.client.id, f.manager.id, deleted.id),
      ).rejects.toThrow('not found');
    });

    it('shows cross-hub details and signed front photo with limited rider information', async () => {
      const f = await fixture();
      const fleet = await f.fleet('DETAILS', f.other.id);
      const evidence = await f.inspection(fleet.id);
      const detail = await service.get(f.client.id, f.manager.id, fleet.id);
      expect(detail).toMatchObject({
        id: fleet.id,
        access: { canManage: false },
        allocation: {
          id: evidence.allocation.id,
          rider: { name: 'Rider name' },
        },
        frontPhoto: {
          id: evidence.photo.id,
          url: `https://signed.test/${evidence.photo.id}`,
        },
      });
      expect(detail.allocation!.rider).not.toHaveProperty('mobile');
      expect(detail).not.toHaveProperty('metadata');
      expect(detail.submission).toBeNull();
      const empty = await f.fleet('EMPTY');
      expect(
        await service.get(f.client.id, f.manager.id, empty.id),
      ).toMatchObject({ frontPhoto: null, allocation: null, submission: null });
    });

    it('does not grant management for inactive hubs or a manager without assignments', async () => {
      const f = await fixture();
      const fleet = await f.fleet('INACTIVE');
      await db.hub.update({
        where: { id: f.own.id },
        data: { status: 'INACTIVE' },
      });
      expect(
        (await service.get(f.client.id, f.manager.id, fleet.id)).access
          .canManage,
      ).toBe(false);
      await expect(
        guard.canActivate(context(f.actor, FleetsController, { id: fleet.id })),
      ).rejects.toMatchObject({
        response: { code: 'FLEET_HUB_ACCESS_REQUIRED' },
      });
      await db.userHub.deleteMany({ where: { userId: f.manager.id } });
      expect(
        (await service.search(f.client.id, f.manager.id, query())).data,
      ).toHaveLength(1);
    });

    it('denies cross-hub actions after search while allowing assigned-hub actions', async () => {
      const f = await fixture();
      const own = await f.fleet('OWN');
      const outside = await f.fleet('OUTSIDE', f.other.id);
      const foreign = await fixture();
      const alien = await foreign.fleet('ALIEN');
      for (const fleet of [outside, alien])
        await expect(
          guard.canActivate(
            context(
              f.actor,
              FleetsController,
              { id: fleet.id },
              { status: 'MAINTENANCE' },
            ),
          ),
        ).rejects.toThrow('active assigned hubs');
      expect(
        (await db.fleet.findUniqueOrThrow({ where: { id: outside.id } }))
          .status,
      ).toBe('AVAILABLE');
      expect(
        await guard.canActivate(
          context(
            f.actor,
            FleetsController,
            { id: own.id },
            { status: 'MAINTENANCE' },
          ),
        ),
      ).toBe(true);
      await expect(
        guard.canActivate(
          context(
            f.actor,
            FleetsController,
            { id: own.id },
            { currentHubId: f.other.id },
          ),
        ),
      ).rejects.toThrow('active assigned hubs');
      const admin: AuthUser = { ...f.actor, roles: ['CLIENT_ADMIN'] };
      expect(
        await guard.canActivate(
          context(admin, FleetsController, { id: outside.id }),
        ),
      ).toBe(true);
    });

    it('denies outside inspection completion and photo upload/completion', async () => {
      const f = await fixture();
      for (const outside of [false, true]) {
        const fleet = await f.fleet(
          outside ? 'OUTSIDE' : 'OWN',
          outside ? f.other.id : f.own.id,
        );
        const evidence = await f.inspection(fleet.id);
        const contexts = [
          context(
            f.actor,
            InspectionsController,
            { id: evidence.inspection.id },
            {},
            'POST',
          ),
          context(
            f.actor,
            MediaController,
            {},
            { workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: evidence.inspection.id },
            'POST',
          ),
          context(
            f.actor,
            MediaController,
            { id: evidence.photo.id },
            {},
            'POST',
          ),
          context(
            f.actor,
            MediaController,
            {},
            { entityType: 'FLEET', entityId: fleet.id },
            'POST',
          ),
        ];
        for (const ctx of contexts) {
          if (outside)
            await expect(guard.canActivate(ctx)).rejects.toThrow(
              'active assigned hubs',
            );
          else expect(await guard.canActivate(ctx)).toBe(true);
        }
      }
    });

    it('blocks cross-hub bulk mappings and moving an outside battery into an assigned scooter', async () => {
      const f = await fixture();
      const own = await f.fleet('OWN');
      const outside = await f.fleet('OUTSIDE', f.other.id);
      await expect(
        guard.canActivate(
          context(
            f.actor,
            FleetsController,
            {},
            { rows: [{ fleetCode: outside.fleetCode }] },
            'POST',
          ),
        ),
      ).rejects.toThrow('active assigned hubs');
      const battery = await db.battery.create({
        data: {
          clientId: f.client.id,
          serialNumber: 'BAT-OUTSIDE',
          batteryType: 'FIXED_SINGLE',
          status: 'INSTALLED',
        },
      });
      await db.fleetBatteryHistory.create({
        data: {
          fleetId: outside.id,
          batteryId: battery.id,
          installedAt: new Date(),
        },
      });
      await expect(
        guard.canActivate(
          context(
            f.actor,
            FleetsController,
            {},
            { fleetId: own.id, batteryIds: [battery.id] },
            'POST',
          ),
        ),
      ).rejects.toThrow('active assigned hubs');
      await expect(
        guard.canActivate(
          context(
            f.actor,
            FleetsController,
            { batteryId: battery.id },
            {},
            'PATCH',
          ),
        ),
      ).rejects.toThrow('active assigned hubs');
    });
  },
);
