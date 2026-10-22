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
  const pendingActivation = 'PENDING_ACTIVATION' as FleetStatus;

  it('creates new fleets in pending activation by default', async () => {
    const prisma = {
      oem: { findFirst: vi.fn().mockResolvedValue({ id: 'oem-1' }) },
      vehicleCategory: {
        findFirst: vi.fn().mockResolvedValue({ id: 'category-1' }),
      },
      vehicleType: { findFirst: vi.fn().mockResolvedValue({ id: 'type-1' }) },
      fleet: {
        create: vi.fn().mockResolvedValue({
          id: 'fleet-1',
          status: pendingActivation,
          onboardingStatus: FleetOnboardingStatus.DRAFT,
          allocationEnabled: true,
        }),
      },
      clientOnboardingProgress: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new FleetsService(prisma as never, {} as never);

    await service.create('client-a', {
      chassisNumber: 'CHASSIS-1',
      oemId: 'oem-1',
      vehicleCategoryId: 'category-1',
      vehicleTypeId: 'type-1',
      speedType: 'SLOW_SPEED',
    });

    expect(prisma.fleet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: pendingActivation }),
      }),
    );
  });

  it('activates a received fleet only from pending activation', async () => {
    const fleet = {
      id: 'fleet-1',
      status: pendingActivation,
      onboardingStatus: FleetOnboardingStatus.DRAFT,
      allocationEnabled: true,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirstOrThrow: vi.fn().mockResolvedValue(fleet),
        update: vi.fn().mockResolvedValue({
          ...fleet,
          status: FleetStatus.AVAILABLE,
          onboardingStatus: FleetOnboardingStatus.ACTIVE,
        }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
      },
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          ...fleet,
          batteryHistory: [],
          controllerHistory: [],
          iotDevice: null,
        }),
      },
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(service.activate('client-a', fleet.id, 'admin-1')).resolves.toMatchObject({
      status: FleetStatus.AVAILABLE,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
    });
    expect(tx.fleetStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: pendingActivation,
          toStatus: FleetStatus.AVAILABLE,
        }),
      }),
    );
  });

  it.each([
    {
      name: 're-enables allocation after non-admin maintenance recovery',
      allocationBlockedByAdmin: false,
      expectedAllocationEnabled: true,
    },
    {
      name: 'keeps allocation disabled when an administrator blocked it',
      allocationBlockedByAdmin: true,
      expectedAllocationEnabled: false,
    },
  ])('$name', async ({ allocationBlockedByAdmin, expectedAllocationEnabled }) => {
    let current = {
      id: 'fleet-recovery',
      status: FleetStatus.PENDING_ACTIVATION,
      onboardingStatus: FleetOnboardingStatus.DRAFT,
      allocationEnabled: false,
      allocationBlockedByAdmin,
      batteryHistory: [],
      controllerHistory: [],
      iotDevice: null,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirst: vi.fn().mockImplementation(() => current),
        findFirstOrThrow: vi.fn().mockImplementation(() => current),
        update: vi.fn().mockImplementation(({ data }: { data: Partial<typeof current> }) => {
          current = { ...current, ...data };
          return current;
        }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
      },
      fleet: { findFirst: vi.fn().mockImplementation(() => current) },
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());

    await service.changeStatus(
      'client-a',
      current.id,
      FleetStatus.MAINTENANCE,
      'operator-1',
      'Repair required',
    );
    await service.changeStatus(
      'client-a',
      current.id,
      FleetStatus.PENDING_ACTIVATION,
      'operator-1',
      'Repair completed',
    );
    await service.activate('client-a', current.id, 'admin-1');

    expect(tx.fleet.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allocationEnabled: expectedAllocationEnabled,
        }),
      }),
    );
  });

  it('does not treat a received legacy active fleet as already activated', async () => {
    const fleet = {
      id: 'fleet-legacy',
      status: pendingActivation,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: true,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirstOrThrow: vi.fn().mockResolvedValue(fleet),
        update: vi.fn().mockResolvedValue({
          ...fleet,
          status: FleetStatus.AVAILABLE,
        }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
      },
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          ...fleet,
          batteryHistory: [],
          controllerHistory: [],
          iotDevice: null,
        }),
      },
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(service.activate('client-a', fleet.id, 'admin-1')).resolves.toMatchObject({
      status: FleetStatus.AVAILABLE,
    });
    expect(tx.fleet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: FleetStatus.AVAILABLE }) }),
    );
  });

  it('rejects activation while a legacy active fleet is still in transit', async () => {
    const fleet = {
      id: 'fleet-transit',
      status: FleetStatus.IN_TRANSIT,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: true,
    };
    const prisma = {
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          ...fleet,
          batteryHistory: [],
          controllerHistory: [],
          iotDevice: null,
        }),
      },
      $transaction: vi.fn(),
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(service.activate('client-a', fleet.id, 'admin-1')).rejects.toThrow(
      'Receive the fleet before activation',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechecks the locked fleet before allowing activation', async () => {
    const pendingFleet = {
      id: 'fleet-race',
      status: FleetStatus.PENDING_ACTIVATION,
      onboardingStatus: FleetOnboardingStatus.DRAFT,
      allocationEnabled: true,
      batteryHistory: [],
      controllerHistory: [],
      iotDevice: null,
    };
    const lockedFleet = {
      ...pendingFleet,
      status: FleetStatus.IN_TRANSIT,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: { findFirstOrThrow: vi.fn().mockResolvedValue(lockedFleet) },
    };
    const prisma = {
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
      },
      fleet: { findFirst: vi.fn().mockResolvedValue(pendingFleet) },
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(service.activate('client-a', pendingFleet.id, 'admin-1')).rejects.toThrow(
      'Receive the fleet before activation',
    );
  });

  it('checks the freshly locked fleet before applying a status change', async () => {
    const stale = {
      id: 'fleet-1',
      status: FleetStatus.IN_TRANSIT,
      onboardingStatus: FleetOnboardingStatus.DRAFT,
      allocationEnabled: true,
      _count: { allocations: 0 },
    };
    const current = { ...stale, status: pendingActivation };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirst: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue({
          ...current,
          status: FleetStatus.MAINTENANCE,
        }),
      },
      fleetStatusHistory: { create: vi.fn() },
      allocation: { count: vi.fn().mockResolvedValue(0) },
    };
    const statusPolicy = { assertTransition: vi.fn() };
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue(stale) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, statusPolicy as never);

    await service.changeStatus(
      'client-a',
      current.id,
      FleetStatus.MAINTENANCE,
      'operator-1',
      'Repair required',
    );

    expect(statusPolicy.assertTransition).toHaveBeenCalledWith(
      pendingActivation,
      FleetStatus.MAINTENANCE,
    );
    expect(tx.fleetStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: pendingActivation }),
      }),
    );
  });

  it('records receipt for a legacy in-transit fleet without changing onboarding', async () => {
    const fleet = {
      id: 'fleet-legacy',
      status: FleetStatus.IN_TRANSIT,
      onboardingStatus: FleetOnboardingStatus.ACTIVE,
      allocationEnabled: true,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirst: vi.fn().mockResolvedValue(fleet),
        update: vi.fn().mockResolvedValue({
          ...fleet,
          status: pendingActivation,
        }),
      },
      fleetStatusHistory: { create: vi.fn() },
      allocation: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());

    await service.changeStatus(
      'client-a',
      fleet.id,
      pendingActivation,
      'operator-1',
      'Fleet received.',
    );

    expect(tx.fleet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: pendingActivation } }),
    );
    expect(tx.fleetStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: FleetStatus.IN_TRANSIT,
          toStatus: pendingActivation,
          reason: 'Fleet received.',
        }),
      }),
    );
  });

  it('keeps active maintenance recovery on the available path', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fleet-active',
          status: FleetStatus.MAINTENANCE,
          onboardingStatus: FleetOnboardingStatus.ACTIVE,
          allocationEnabled: false,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, new FleetStatusPolicy());

    await expect(
      service.changeStatus(
        'client-a',
        'fleet-active',
        pendingActivation,
        'operator-1',
      ),
    ).rejects.toThrow('Active fleet cannot return to pending activation.');
  });

  it('allows Simple mode activation with missing onboarding photos', async () => {
    const fleet = { id: 'fleet-1', status: FleetStatus.PENDING_ACTIVATION, onboardingStatus: FleetOnboardingStatus.DRAFT, allocationEnabled: true };
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
});
