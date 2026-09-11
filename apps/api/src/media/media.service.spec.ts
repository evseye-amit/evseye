import { PhotoEntityType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService photo requirements', () => {
  it('queries configurable requirements within the caller tenant only', async () => {
    const prisma = {
      photoRequirement: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ photoType: 'FRONT', isRequired: true }]),
      },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.requirements('tenant-a', PhotoEntityType.INSPECTION),
    ).resolves.toEqual([{ photoType: 'FRONT', isRequired: true }]);
    expect(prisma.photoRequirement.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', entityType: PhotoEntityType.INSPECTION },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  });

  it('upserts a requirement scoped to the caller tenant', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'requirement-1' });
    const service = new MediaService(
      { photoRequirement: { upsert } } as never,
      {} as never,
    );

    await expect(
      service.upsertRequirement(
        'tenant-a',
        PhotoEntityType.INSPECTION,
        'FRONT',
        {
          isRequired: true,
          sortOrder: 1,
        },
      ),
    ).resolves.toEqual({ id: 'requirement-1' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_entityType_photoType: {
            tenantId: 'tenant-a',
            entityType: PhotoEntityType.INSPECTION,
            photoType: 'FRONT',
          },
        },
      }),
    );
  });

  it('lists entity photos only after confirming tenant ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([{ photoType: 'FRONT' }]);
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) },
      photo: { findMany },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.listEntityPhotos('tenant-a', PhotoEntityType.FLEET, 'fleet-1'),
    ).resolves.toEqual([{ photoType: 'FRONT' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        entityType: PhotoEntityType.FLEET,
        entityId: 'fleet-1',
      },
      orderBy: { uploadedAt: 'asc' },
    });
  });

  it('does not reveal Tenant B fleet photos to a Tenant A caller', async () => {
    const photoFindMany = vi.fn();
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue(null) },
      photo: { findMany: photoFindMany },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.listEntityPhotos(
        'tenant-a',
        PhotoEntityType.FLEET,
        'fleet-owned-by-tenant-b',
      ),
    ).rejects.toThrow('Media entity not found.');
    expect(prisma.fleet.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'fleet-owned-by-tenant-b',
        tenantId: 'tenant-a',
        deletedAt: null,
      },
    });
    expect(photoFindMany).not.toHaveBeenCalled();
  });

  it('checks a battery belongs to the requesting tenant before media access', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new MediaService(
      { battery: { findFirst } } as never,
      {} as never,
    );

    await expect(
      service.listEntityPhotos(
        'tenant-a',
        PhotoEntityType.BATTERY,
        'battery-1',
      ),
    ).rejects.toThrow('Media entity not found.');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'battery-1', tenantId: 'tenant-a' },
    });
  });
});
