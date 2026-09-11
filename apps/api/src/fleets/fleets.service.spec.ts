import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from './fleets.service.js';

describe('FleetsService onboarding evidence', () => {
  it('reports missing required evidence by fleet component', async () => {
    const prisma = {
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fleet-1',
          vehicleNumber: 'EV-001',
          batteries: [{ id: 'battery-1', serialNumber: 'BAT-001' }],
          controllers: [],
        }),
      },
      photoRequirement: {
        findMany: vi.fn().mockResolvedValue([
          { entityType: PhotoEntityType.FLEET, photoType: 'FRONT' },
          { entityType: PhotoEntityType.FLEET, photoType: 'REAR' },
          { entityType: PhotoEntityType.BATTERY, photoType: 'LABEL' },
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
        ]),
      },
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.onboardingStatus('tenant-a', 'fleet-1'),
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
      ],
    });
    expect(prisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: PhotoStatus.COMPLETE }),
      }),
    );
  });
});
