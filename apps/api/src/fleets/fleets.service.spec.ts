import {
  FleetOnboardingStatus,
  FleetStatus,
  PhotoEntityType,
  PhotoStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from './fleets.service.js';

describe('FleetsService onboarding evidence', () => {
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
