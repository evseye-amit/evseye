import {
  FleetOnboardingStatus,
  FleetStatus,
  PhotoEntityType,
  PhotoStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from './fleets.service.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';

describe('FleetsService onboarding evidence', () => {
  it('allows Simple mode activation with missing onboarding photos', async () => {
    const fleet = { id: 'fleet-1', status: FleetStatus.IN_TRANSIT, onboardingStatus: FleetOnboardingStatus.DRAFT, allocationEnabled: true };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirstOrThrow: vi.fn().mockResolvedValue(fleet),
        update: vi.fn().mockResolvedValue({ ...fleet, status: FleetStatus.AVAILABLE, onboardingStatus: FleetOnboardingStatus.ACTIVE }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }) },
      fleet: { findFirst: vi.fn().mockResolvedValue({ ...fleet, batteryHistory: [], controllerHistory: [], iotDevice: null }) },
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([{ entityType: PhotoEntityType.FLEET, photoType: 'FRONT' }]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, {} as never);
    await expect(service.onboardingStatus('client-a', fleet.id)).resolves.toMatchObject({
      operatingMode: 'SIMPLE', photosRequired: false, evidenceComplete: false, ready: true,
      items: [{ missingPhotoTypes: ['FRONT'] }],
    });
    await expect(service.activate('client-a', fleet.id, 'admin-1')).resolves.toMatchObject({
      status: FleetStatus.AVAILABLE, onboardingStatus: FleetOnboardingStatus.ACTIVE, isAllocatable: true,
    });
    prisma.client.findUniqueOrThrow.mockResolvedValue({ fleetOperatingMode: 'ONBOARDING_EVIDENCE' });
    await expect(service.activate('client-a', fleet.id, 'admin-1')).rejects.toThrow('Complete all required operational photos');
    prisma.client.findUniqueOrThrow.mockResolvedValue({ fleetOperatingMode: 'SIMPLE' });
    tx.allocation.count.mockResolvedValue(1);
    await expect(service.activate('client-a', fleet.id, 'admin-1')).rejects.toThrow('Only an unallocated fleet');
    tx.allocation.count.mockResolvedValue(0);
    tx.fleet.findFirstOrThrow.mockResolvedValue({ ...fleet, status: FleetStatus.MAINTENANCE });
    await expect(service.activate('client-a', fleet.id, 'admin-1')).rejects.toThrow('Only an unallocated fleet');
  });

  it('resolves Fleet import master codes on the server and reports invalid rows', async () => {
    const prisma = {
      oem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'oem-1', code: 'ZELIO' }]),
      },
      vehicleCategory: {
        findMany: vi.fn().mockResolvedValue([{ id: 'category-1', code: '2W' }]),
      },
      vehicleType: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'type-1', code: 'E_SCOOTER_ELECTRIC' }]),
      },
      hub: {
        findMany: vi.fn().mockResolvedValue([{ id: 'hub-1', code: 'HUB-1' }]),
      },
      importJob: { create: vi.fn().mockResolvedValue({ id: 'job-1' }) },
      clientOnboardingProgress: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new FleetsService(prisma as never, {} as never);
    const create = vi
      .spyOn(service, 'create')
      .mockResolvedValue({ id: 'fleet-1' } as never);

    const result = await service.bulkCreate('client-a', 'user-a', 'fleet.csv', [
      {
        chassisNumber: 'CHASSIS-1',
        oemCode: 'zelio',
        vehicleCategoryCode: '2w',
        vehicleTypeCode: 'e_scooter_electric',
        speedType: 'HIGH_SPEED',
        ownershipType: 'CLIENT_OWNED',
        homeHubCode: 'hub-1',
      },
      {
        chassisNumber: 'CHASSIS-2',
        oemCode: 'unknown',
        vehicleCategoryCode: '2W',
        vehicleTypeCode: 'E_SCOOTER_ELECTRIC',
        speedType: 'HIGH_SPEED',
        ownershipType: 'CLIENT_OWNED',
      },
    ]);

    expect(create).toHaveBeenCalledWith(
      'client-a',
      expect.objectContaining({
        oemId: 'oem-1',
        vehicleCategoryId: 'category-1',
        vehicleTypeId: 'type-1',
        homeHubId: 'hub-1',
        currentHubId: 'hub-1',
      }),
    );
    expect(result).toMatchObject({
      status: 'PARTIAL_PASS',
      passedRows: 1,
      failedRows: 1,
    });
  });

  it('reports missing required evidence by fleet component', async () => {
    const prisma = {
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'ONBOARDING_EVIDENCE' }) },
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fleet-1',
          vehicleNumber: 'EV-001',
          batteryHistory: [
            { battery: { id: 'battery-1', serialNumber: 'BAT-001' } },
          ],
          controllerHistory: [],
          iotDevice: { id: 'iot-1', deviceNumber: 'IOT-001' },
        }),
      },
      photoRequirement: {
        createMany: vi.fn().mockResolvedValue({ count: 11 }),
        findMany: vi.fn().mockResolvedValue([
          { entityType: PhotoEntityType.FLEET, photoType: 'FRONT' },
          { entityType: PhotoEntityType.FLEET, photoType: 'REAR' },
          { entityType: PhotoEntityType.BATTERY, photoType: 'LABEL' },
          {
            entityType: PhotoEntityType.IOT_DEVICE,
            photoType: 'INSTALLATION',
          },
          {
            entityType: PhotoEntityType.IOT_DEVICE,
            photoType: 'SERIAL_LABEL',
          },
        ]),
      },
      photo: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityType: PhotoEntityType.FLEET,
            entityId: 'fleet-1',
            photoType: 'FRONT',
          },
          {
            entityType: PhotoEntityType.BATTERY,
            entityId: 'battery-1',
            photoType: 'LABEL',
          },
          {
            entityType: PhotoEntityType.IOT_DEVICE,
            entityId: 'iot-1',
            photoType: 'INSTALLATION',
          },
        ]),
      },
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.onboardingStatus('client-a', 'fleet-1'),
    ).resolves.toEqual({
      operatingMode: 'ONBOARDING_EVIDENCE',
      photosRequired: true,
      evidenceComplete: false,
      ready: false,
      items: [
        {
          entityType: PhotoEntityType.FLEET,
          entityId: 'fleet-1',
          label: 'EV-001',
          requiredPhotoTypes: ['FRONT', 'REAR'],
          completedPhotoTypes: ['FRONT'],
          missingPhotoTypes: ['REAR'],
          ready: false,
        },
        {
          entityType: PhotoEntityType.BATTERY,
          entityId: 'battery-1',
          label: 'BAT-001',
          requiredPhotoTypes: ['LABEL'],
          completedPhotoTypes: ['LABEL'],
          missingPhotoTypes: [],
          ready: true,
        },
        {
          entityType: PhotoEntityType.IOT_DEVICE,
          entityId: 'iot-1',
          label: 'IOT-001',
          requiredPhotoTypes: ['INSTALLATION', 'SERIAL_LABEL'],
          completedPhotoTypes: ['INSTALLATION'],
          missingPhotoTypes: ['SERIAL_LABEL'],
          ready: false,
        },
      ],
    });
    expect(prisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: PhotoStatus.COMPLETE }),
      }),
    );
    expect(prisma.photoRequirement.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('derives allocatability from lifecycle, onboarding, policy, and active allocations', async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'fleet-1',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            _count: { allocations: 0 },
          },
          {
            id: 'fleet-2',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            _count: { allocations: 1 },
          },
        ],
        2,
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items.map((fleet) => fleet.isAllocatable)).toEqual([
      true,
      false,
    ]);
  });

  it('uses the client boundary when retrieving a fleet', async () => {
    const prisma = { fleet: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.get('client-a', 'fleet-owned-by-client-b'),
    ).rejects.toThrow('Fleet not found.');
    expect(prisma.fleet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'client-a' }),
      }),
    );
  });

  it.each([
    { fromStatus: FleetStatus.MAINTENANCE, mode: 'SIMPLE', blocked: false, allocationEnabled: true },
    { fromStatus: FleetStatus.BROKEN, mode: 'SIMPLE', blocked: true, allocationEnabled: false },
    { fromStatus: FleetStatus.AWAITING_PARTS, mode: 'PREPARATION_QC', blocked: false, allocationEnabled: false },
    { fromStatus: FleetStatus.BROKEN, mode: 'STAGED_PREPARATION_QC', blocked: false, allocationEnabled: false },
  ])('releases a repaired fleet through status change without bypassing readiness rules', async ({ fromStatus, mode, blocked, allocationEnabled }) => {
    const fleet = {
      id: 'fleet-1',
      status: fromStatus,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: false,
      allocationBlockedByAdmin: blocked,
    };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn().mockResolvedValue(0) },
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: mode }),
      },
      fleet: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          status: fromStatus,
          allocationBlockedByAdmin: blocked,
        }),
        update: vi.fn().mockResolvedValue({
          ...fleet,
          status: FleetStatus.AVAILABLE,
          allocationEnabled,
        }),
      },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());
    vi.spyOn(service, 'get').mockResolvedValue(fleet as never);

    await expect(
      service.changeStatus('client-a', fleet.id, FleetStatus.AVAILABLE, 'manager-1'),
    ).resolves.toMatchObject({ status: FleetStatus.AVAILABLE, allocationEnabled });
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: fleet.id },
      data: expect.objectContaining({
        status: FleetStatus.AVAILABLE,
        allocationEnabled,
      }),
    });
  });

  it('does not release a fleet with an active allocation', async () => {
    const fleet = {
      id: 'fleet-1',
      status: FleetStatus.BROKEN,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: false,
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn().mockResolvedValue(1) },
      fleet: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          status: FleetStatus.BROKEN,
          allocationBlockedByAdmin: false,
        }),
        update: vi.fn(),
      },
      fleetStatusHistory: { create: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());
    vi.spyOn(service, 'get').mockResolvedValue(fleet as never);

    await expect(
      service.changeStatus('client-a', fleet.id, FleetStatus.AVAILABLE, 'manager-1'),
    ).rejects.toThrow('active allocation');
    expect(tx.fleet.update).not.toHaveBeenCalled();
  });

  it('rejects a stale status read after acquiring the fleet lock', async () => {
    const fleet = {
      id: 'fleet-1',
      status: FleetStatus.BROKEN,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: false,
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn() },
      fleet: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          status: FleetStatus.RESERVED,
          allocationBlockedByAdmin: false,
        }),
        update: vi.fn(),
      },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());
    vi.spyOn(service, 'get').mockResolvedValue(fleet as never);

    await expect(
      service.changeStatus('client-a', fleet.id, FleetStatus.AVAILABLE, 'manager-1'),
    ).rejects.toThrow('Fleet status changed');
    expect(tx.allocation.count).not.toHaveBeenCalled();
    expect(tx.fleet.update).not.toHaveBeenCalled();
  });

  it('uses the locked admin block when releasing a repaired fleet', async () => {
    const fleet = {
      id: 'fleet-1',
      status: FleetStatus.BROKEN,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: false,
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleet: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          status: FleetStatus.BROKEN,
          allocationBlockedByAdmin: true,
        }),
        update: vi.fn().mockResolvedValue({ ...fleet, status: FleetStatus.AVAILABLE }),
      },
      fleetStatusHistory: { create: vi.fn() },
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());
    vi.spyOn(service, 'get').mockResolvedValue(fleet as never);

    await service.changeStatus('client-a', fleet.id, FleetStatus.AVAILABLE, 'manager-1');
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: fleet.id },
      data: { status: FleetStatus.AVAILABLE, allocationEnabled: false },
    });
  });

  it('does not add release behavior to unrelated transitions', async () => {
    const fleet = {
      id: 'fleet-1',
      status: FleetStatus.RESERVED,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: false,
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn().mockResolvedValue(1) },
      fleet: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          status: FleetStatus.RESERVED,
          allocationBlockedByAdmin: true,
        }),
        update: vi.fn().mockResolvedValue({ ...fleet, status: FleetStatus.AVAILABLE }),
      },
      fleetStatusHistory: { create: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());
    vi.spyOn(service, 'get').mockResolvedValue(fleet as never);

    await expect(
      service.changeStatus('client-a', fleet.id, FleetStatus.AVAILABLE, 'manager-1'),
    ).resolves.toMatchObject({ status: FleetStatus.AVAILABLE });
    expect(tx.client.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: fleet.id },
      data: { status: FleetStatus.AVAILABLE },
    });
  });
});
