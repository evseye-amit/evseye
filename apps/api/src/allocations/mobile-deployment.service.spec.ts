import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MobileDeploymentService } from './mobile-deployment.service.js';

describe('MobileDeploymentService.fleetRequests', () => {
  it('loads completed fleet evidence from Photo without including a nonexistent Fleet relation', async () => {
    const requests = [
      { id: 'allocation-1', fleetId: 'fleet-1', fleet: { id: 'fleet-1', iotDevice: null } },
      { id: 'allocation-2', fleetId: 'fleet-2', fleet: { id: 'fleet-2', iotDevice: null } },
    ];
    const photos = [
      { id: 'photo-2', entityId: 'fleet-2', photoType: 'FRONT' },
      { id: 'photo-1', entityId: 'fleet-1', photoType: 'REAR' },
    ];
    const prisma = {
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      allocation: { findMany: vi.fn().mockResolvedValue(requests) },
      photo: { findMany: vi.fn().mockResolvedValue(photos) },
    };
    const service = new MobileDeploymentService(prisma as never, {} as never, {} as never, {} as never);

    const result = await service.fleetRequests('client-1', 'manager-1');

    expect(prisma.allocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { rider: true, fleet: { include: { iotDevice: true } }, mobileDeployment: true },
    }));
    expect(prisma.photo.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1', entityType: PhotoEntityType.FLEET,
        entityId: { in: ['fleet-1', 'fleet-2'] }, status: PhotoStatus.COMPLETE,
      },
      orderBy: { uploadedAt: 'asc' },
    });
    expect(result.map((request) => request.fleet.photos.map((photo) => photo.id))).toEqual([
      ['photo-1'], ['photo-2'],
    ]);
  });
});
