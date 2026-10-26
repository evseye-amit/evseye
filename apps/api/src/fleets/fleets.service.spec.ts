import {
  FleetOnboardingStatus,
  FleetStatus,
  PhotoStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from './fleets.service.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';
import { defaultPolicy } from '../fleet-readiness/readiness-policy.js';

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

  it('rechecks readiness approval after locking before activation', async () => {
    const pendingFleet = {
      id: 'fleet-readiness-race',
      status: FleetStatus.PENDING_ACTIVATION,
      onboardingStatus: FleetOnboardingStatus.DRAFT,
      allocationEnabled: true,
      readinessWorkflow: 'PREPARATION_QC',
      readinessApprovedPreparationId: 'preparation-1',
      batteryHistory: [],
      controllerHistory: [],
      iotDevice: null,
    };
    const revokedApproval = {
      ...pendingFleet,
      readinessApprovedPreparationId: null,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: {
        findFirstOrThrow: vi.fn().mockResolvedValue(revokedApproval),
        update: vi.fn().mockResolvedValue({ ...revokedApproval, status: FleetStatus.AVAILABLE }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue(pendingFleet) },
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetsService(prisma as never, {} as never);
    vi.spyOn(service, 'onboardingStatus').mockResolvedValue({
      readinessWorkflow: 'PREPARATION_QC',
      ready: true,
    } as never);

    await expect(
      service.activate('client-a', pendingFleet.id, 'admin-1'),
    ).rejects.toThrow('Complete preparation and quality check before activation.');
    expect(tx.fleet.update).not.toHaveBeenCalled();
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
      photoRequirement: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([{ subjectType: 'FLEET', photoType: 'FRONT' }]) },
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
    await expect(service.activate('client-a', fleet.id, 'admin-1')).resolves.toMatchObject({
      status: FleetStatus.AVAILABLE,
    });
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
          { subjectType: 'FLEET', photoType: 'FRONT' },
          { subjectType: 'FLEET', photoType: 'REAR' },
          { subjectType: 'BATTERY', photoType: 'LABEL' },
          {
            subjectType: 'IOT_DEVICE',
            photoType: 'INSTALLATION',
          },
          {
            subjectType: 'IOT_DEVICE',
            photoType: 'SERIAL_LABEL',
          },
        ]),
      },
      photo: {
        findMany: vi.fn().mockResolvedValue([
          {
            subjectType: 'FLEET',
            entityId: 'fleet-1',
            photoType: 'FRONT',
          },
          {
            subjectType: 'BATTERY',
            entityId: 'battery-1',
            photoType: 'LABEL',
          },
          {
            subjectType: 'IOT_DEVICE',
            entityId: 'iot-1',
            photoType: 'INSTALLATION',
          },
        ]),
      },
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.onboardingStatus('client-a', 'fleet-1'),
    ).resolves.toMatchObject({
      operatingMode: 'SIMPLE',
      readinessWorkflow: 'SIMPLE',
      photosRequired: false,
      evidenceComplete: false,
      ready: true,
      items: [
        {
          subjectType: 'FLEET',
          entityId: 'fleet-1',
          label: 'EV-001',
          requiredPhotoTypes: ['FRONT', 'REAR'],
          completedPhotoTypes: ['FRONT'],
          missingPhotoTypes: ['REAR'],
          ready: false,
        },
        {
          subjectType: 'BATTERY',
          entityId: 'battery-1',
          label: 'BAT-001',
          requiredPhotoTypes: ['LABEL'],
          completedPhotoTypes: ['LABEL'],
          missingPhotoTypes: [],
          ready: true,
        },
        {
          subjectType: 'IOT_DEVICE',
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
    expect(prisma.photoRequirement.createMany).not.toHaveBeenCalled();
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
        { fleetOperatingMode: 'SIMPLE' },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items.map((fleet) => fleet.isAllocatable)).toEqual([
      true,
      false,
    ]);
    expect(prisma.$transaction.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('reports ordered vehicle blockers without changing legacy allocatability', async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'fleet-1',
            status: FleetStatus.INSPECTION_PENDING,
            onboardingStatus: FleetOnboardingStatus.DRAFT,
            allocationEnabled: false,
            readinessApprovedPreparationId: null,
            _count: { allocations: 1 },
          },
        ],
        1,
        { fleetOperatingMode: 'PREPARATION_QC' },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      isAllocatable: false,
      vehicleReadiness: {
        ready: false,
        blockers: [
          {
            code: 'STATUS',
            message: 'Scooter status is INSPECTION_PENDING.',
          },
          {
            code: 'ADMIN_DISABLED',
            message: 'Allocation is administratively disabled.',
          },
          {
            code: 'ACTIVATION_INCOMPLETE',
            message: 'Fleet activation is incomplete.',
          },
          {
            code: 'PREPARATION_QC_REQUIRED',
            message: 'Preparation and QC approval are required.',
          },
          {
            code: 'UNFINISHED_ALLOCATION',
            message: 'Scooter has an unfinished allocation.',
          },
        ],
        nextStep: 'Complete preparation and QC approval.',
      },
    });
  });

  it('reports QC approval separately from the legacy allocatable flag', async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'fleet-1',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            readinessApprovedPreparationId: null,
            _count: { allocations: 0 },
          },
        ],
        1,
        { fleetOperatingMode: 'PREPARATION_QC' },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      isAllocatable: true,
      vehicleReadiness: {
        ready: false,
        blockers: [
          {
            code: 'PREPARATION_QC_REQUIRED',
            message: 'Preparation and QC approval are required.',
          },
        ],
        nextStep: 'Complete preparation and QC approval.',
      },
    });
  });

  it('reports a ready Simple-mode fleet with app-only allocation guidance', async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'fleet-1',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            readinessApprovedPreparationId: null,
            _count: { allocations: 0 },
          },
        ],
        1,
        { fleetOperatingMode: 'SIMPLE' },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items[0]?.vehicleReadiness).toEqual({
      ready: true,
      blockers: [],
      nextStep: 'Use the Fleet Manager app to allocate this scooter.',
    });
  });

  it('blocks staged fleets when their selected plan is not configured', async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'fleet-staged',
            readinessWorkflow: 'STAGED_PREPARATION_QC',
            readinessStagePlanCode: 'removed-plan',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            readinessApprovedPreparationId: 'approved-preparation',
            _count: { allocations: 0 },
          },
        ],
        1,
        {
          fleetOperatingMode: 'STAGED_PREPARATION_QC',
          readinessPolicies: [{
            configuration: {
              ...defaultPolicy,
              stagePlans: [{ code: 'current-plan', name: 'Current', stages: [] }],
            },
          }],
        },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items[0]?.vehicleReadiness).toMatchObject({
      ready: false,
      blockers: [{
        code: 'STAGE_PLAN_REQUIRED',
        message: 'Select a stage plan before starting preparation.',
      }],
      nextStep: 'Select a stage plan before starting preparation.',
    });
  });

  it("uses each fleet's saved workflow instead of the company default", async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          {
            id: 'simple-fleet',
            readinessWorkflow: 'SIMPLE',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            readinessApprovedPreparationId: null,
            _count: { allocations: 0 },
          },
          {
            id: 'qc-fleet',
            readinessWorkflow: 'PREPARATION_QC',
            status: FleetStatus.AVAILABLE,
            onboardingStatus: FleetOnboardingStatus.ACTIVE,
            allocationEnabled: true,
            readinessApprovedPreparationId: null,
            _count: { allocations: 0 },
          },
        ],
        2,
        { fleetOperatingMode: 'PREPARATION_QC' },
      ]),
      fleet: { findMany: vi.fn(), count: vi.fn() },
      client: { findUniqueOrThrow: vi.fn() },
    };
    const service = new FleetsService(prisma as never, {} as never);

    const result = await service.list('client-a', { page: 1, pageSize: 20 });

    expect(result.items.map((fleet) => fleet.vehicleReadiness.ready)).toEqual([
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
