import { PhotoEntityType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService photo requirements', () => {
  it('keeps support attachments on the dedicated support routes', async () => {
    const service = new MediaService({} as never, {} as never);

    await expect(service.requirements('client-a', PhotoEntityType.SUPPORT_TICKET)).rejects.toThrow('Support attachments use the support ticket routes.');
    await expect(service.upsertRequirement('client-a', PhotoEntityType.SUPPORT_TICKET, 'CHAT', { isRequired: false })).rejects.toThrow('Support attachments use the support ticket routes.');
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

describe('MediaService fleet-manager rider scope', () => {
  const manager = {
    id: 'manager-1',
    clientId: 'client-a',
    roles: [UserRole.FLEET_MANAGER],
  };

  function setup(photo: Record<string, unknown>) {
    const findFirst = vi.fn().mockResolvedValue({ id: 'rider-1' });
    const riderFindMany = vi.fn().mockResolvedValue([{ id: 'rider-1' }]);
    const findMany = vi.fn().mockResolvedValue([photo]);
    const photoFindFirst = vi.fn().mockResolvedValue(photo);
    const createDownloadUrl = vi.fn().mockResolvedValue('https://storage.example/photo');
    const prisma = {
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      rider: { findFirst, findMany: riderFindMany },
      fleet: { findFirst },
      riderOnboardingProgress: { findFirst },
      riderOnboardingDocument: { findFirst: vi.fn().mockResolvedValue({ riderId: 'rider-1' }) },
      photo: { findMany, findFirst: photoFindFirst },
    };
    const service = new MediaService(prisma as never, { createDownloadUrl } as never);
    return { prisma, findMany, photoFindFirst, riderFindMany, createDownloadUrl, service };
  }

  it('lists rider photos only for riders assigned to an assigned hub', async () => {
    const { service, findMany, prisma } = setup({ id: 'photo-1' });

    await service.listEntityPhotos('client-a', PhotoEntityType.RIDER, 'rider-1', manager);

    expect(prisma.rider.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        deletedAt: null,
        user: {
          is: {
            hubAssignments: {
              some: { clientId: 'client-a', hubId: { in: ['hub-1'] } },
            },
          },
        },
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        entityType: PhotoEntityType.RIDER,
        entityId: 'rider-1',
      },
      orderBy: { uploadedAt: 'asc' },
    });
  });

  it('rejects rider photos outside assigned hubs but preserves non-rider metadata listing', async () => {
    const { service, prisma } = setup({ id: 'photo-1' });
    prisma.rider.findMany = vi.fn().mockResolvedValue([]);

    await expect(
      service.listEntityPhotos('client-a', PhotoEntityType.RIDER, 'rider-1', manager),
    ).rejects.toThrow('Media entity not found.');
    await expect(
      service.listEntityPhotos('client-a', PhotoEntityType.FLEET, 'fleet-1', manager),
    ).resolves.toEqual([{ id: 'photo-1' }]);
  });

  it('does not let a fleet manager download unrelated client media', async () => {
    const { service, createDownloadUrl } = setup({
      id: 'photo-1',
      clientId: 'client-a',
      entityType: PhotoEntityType.FLEET,
      entityId: 'fleet-1',
      status: 'COMPLETE',
      objectKey: 'clients/client-a/fleet/fleet-1/photo.jpg',
    });

    await expect(service.downloadUrl('client-a', 'photo-1', manager)).rejects.toThrow('Photo not found.');
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  it('downloads an assigned rider document photo', async () => {
    const photo = {
      id: 'photo-1',
      clientId: 'client-a',
      entityType: PhotoEntityType.RIDER_ONBOARDING,
      entityId: 'progress-1',
      status: 'COMPLETE',
      objectKey: 'clients/client-a/rider_onboarding/progress-1/photo.jpg',
      riderOnboardingDocument: { riderId: 'rider-1' },
    };
    const { service, createDownloadUrl, prisma } = setup(photo);

    await expect(service.downloadUrl('client-a', 'photo-1', manager)).resolves.toEqual({
      url: 'https://storage.example/photo',
    });
    expect(prisma.rider.findMany).toHaveBeenCalled();
    expect(createDownloadUrl).toHaveBeenCalledWith(photo.objectKey);
  });

  it('keeps broad media access for a fleet manager with an existing client-admin role', async () => {
    const { service, createDownloadUrl, prisma } = setup({
      id: 'photo-1',
      clientId: 'client-a',
      entityType: PhotoEntityType.FLEET,
      entityId: 'fleet-1',
      status: 'COMPLETE',
      objectKey: 'clients/client-a/fleet/fleet-1/photo.jpg',
    });
    const dualRoleUser = { ...manager, roles: [UserRole.FLEET_MANAGER, UserRole.CLIENT_ADMIN] };

    await expect(service.downloadUrl('client-a', 'photo-1', dualRoleUser)).resolves.toEqual({
      url: 'https://storage.example/photo',
    });
    expect(prisma.rider.findMany).not.toHaveBeenCalled();
    expect(createDownloadUrl).toHaveBeenCalledWith('clients/client-a/fleet/fleet-1/photo.jpg');
  });

  it('keeps broad media access for a fleet manager with an existing KYC-operator role', async () => {
    const { service, createDownloadUrl, prisma } = setup({
      id: 'photo-1',
      clientId: 'client-a',
      entityType: PhotoEntityType.FLEET,
      entityId: 'fleet-1',
      status: 'COMPLETE',
      objectKey: 'clients/client-a/fleet/fleet-1/photo.jpg',
    });
    const dualRoleUser = { ...manager, roles: [UserRole.FLEET_MANAGER, UserRole.KYC_OPERATOR] };

    await expect(service.downloadUrl('client-a', 'photo-1', dualRoleUser)).resolves.toEqual({
      url: 'https://storage.example/photo',
    });
    expect(prisma.rider.findMany).not.toHaveBeenCalled();
    expect(createDownloadUrl).toHaveBeenCalledWith('clients/client-a/fleet/fleet-1/photo.jpg');
  });

  it('rejects rider photos when the fleet manager has no assigned hubs', async () => {
    const { service, prisma } = setup({ id: 'photo-1' });
    prisma.userHub.findMany = vi.fn().mockResolvedValue([]);

    await expect(
      service.listEntityPhotos('client-a', PhotoEntityType.RIDER, 'rider-1', manager),
    ).rejects.toThrow('Media entity not found.');
    expect(prisma.rider.findMany).not.toHaveBeenCalled();
  });
});
