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
});
