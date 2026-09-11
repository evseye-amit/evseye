import { PhotoEntityType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService photo requirements', () => {
  it('queries configurable requirements within the caller tenant only', async () => {
    const prisma = {
      photoRequirement: { findMany: vi.fn().mockResolvedValue([{ photoType: 'FRONT', isRequired: true }]) },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(service.requirements('tenant-a', PhotoEntityType.INSPECTION)).resolves.toEqual([
      { photoType: 'FRONT', isRequired: true },
    ]);
    expect(prisma.photoRequirement.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', entityType: PhotoEntityType.INSPECTION },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  });
});
