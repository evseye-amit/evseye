import { PhotoEntityType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService photo requirements', () => {
  it('maps upload and download targets while retaining legacy URL fields', async () => {
    const photo = {
      id: 'photo-1',
      objectKey: 'clients/client-a/fleet/fleet-1/photo-1.jpg',
      status: 'COMPLETE',
    };
    const uploadTarget = {
      url: '/api/v1/storage/local/upload',
      headers: { 'X-Upload-Token': 'upload-token' },
    };
    const downloadTarget = {
      url: '/api/v1/storage/local/download',
      headers: { 'X-Download-Token': 'download-token' },
    };
    const storage = {
      createUploadUrl: vi.fn().mockResolvedValue(uploadTarget),
      createDownloadUrl: vi.fn().mockResolvedValue(downloadTarget),
    };
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) },
      photo: {
        create: vi.fn().mockResolvedValue(photo),
        findFirst: vi.fn().mockResolvedValue(photo),
      },
    };
    const service = new MediaService(prisma as never, storage as never);

    await expect(
      service.createUploadIntent('client-a', 'operator-1', {
        entityType: 'FLEET',
        entityId: 'fleet-1',
        photoType: 'FRONT',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        sizeBytes: 3,
      }),
    ).resolves.toMatchObject({
      photo,
      uploadUrl: uploadTarget.url,
      uploadHeaders: uploadTarget.headers,
    });
    await expect(service.downloadUrl('client-a', 'photo-1')).resolves.toEqual({
      url: downloadTarget.url,
      headers: downloadTarget.headers,
    });
  });

  it('queries configurable requirements within the caller client only', async () => {
    const prisma = {
      photoRequirement: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ photoType: 'FRONT', isRequired: true }]),
      },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.requirements('client-a', PhotoEntityType.INSPECTION),
    ).resolves.toEqual([{ photoType: 'FRONT', isRequired: true }]);
    expect(prisma.photoRequirement.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-a', entityType: PhotoEntityType.INSPECTION },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  });

  it('upserts a requirement scoped to the caller client', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'requirement-1' });
    const service = new MediaService(
      { photoRequirement: { upsert } } as never,
      {} as never,
    );

    await expect(
      service.upsertRequirement(
        'client-a',
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
          clientId_entityType_photoType: {
            clientId: 'client-a',
            entityType: PhotoEntityType.INSPECTION,
            photoType: 'FRONT',
          },
        },
      }),
    );
  });

  it('lists entity photos only after confirming client ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([{ photoType: 'FRONT' }]);
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) },
      photo: { findMany },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.listEntityPhotos('client-a', PhotoEntityType.FLEET, 'fleet-1'),
    ).resolves.toEqual([{ photoType: 'FRONT' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        entityType: PhotoEntityType.FLEET,
        entityId: 'fleet-1',
      },
      orderBy: { uploadedAt: 'asc' },
    });
  });

  it('does not reveal Client B fleet photos to a Client A caller', async () => {
    const photoFindMany = vi.fn();
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue(null) },
      photo: { findMany: photoFindMany },
    };
    const service = new MediaService(prisma as never, {} as never);

    await expect(
      service.listEntityPhotos(
        'client-a',
        PhotoEntityType.FLEET,
        'fleet-owned-by-client-b',
      ),
    ).rejects.toThrow('Media entity not found.');
    expect(prisma.fleet.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'fleet-owned-by-client-b',
        clientId: 'client-a',
        deletedAt: null,
      },
    });
    expect(photoFindMany).not.toHaveBeenCalled();
  });

  it('checks a battery belongs to the requesting client before media access', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new MediaService(
      { battery: { findFirst } } as never,
      {} as never,
    );

    await expect(
      service.listEntityPhotos(
        'client-a',
        PhotoEntityType.BATTERY,
        'battery-1',
      ),
    ).rejects.toThrow('Media entity not found.');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'battery-1', clientId: 'client-a' },
    });
  });
});
