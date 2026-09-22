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
    const service = new MobileDeploymentService(prisma as never, {} as never, {} as never, {} as never, {} as never);

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

describe('MobileDeploymentService.requestFleet', () => {
  it.each([
    ['development', true],
    ['production', false],
  ] as const)('handles a missing heartbeat in %s', async (nodeEnv, allowed) => {
    const prisma = {
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      allocation: { findFirst: vi.fn().mockResolvedValue({
        id: 'allocation-1', fleetId: 'fleet-1', fleet: { iotDevice: { lastHeartbeatAt: null } },
      }) },
      mobileDeploymentWorkflow: {
        upsert: vi.fn().mockResolvedValue({ id: 'workflow-1', status: 'RIDER_WAITING' }),
        update: vi.fn().mockResolvedValue({ id: 'workflow-1', status: 'FLEET_REQUESTED' }),
      },
      photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const config = { getOrThrow: vi.fn().mockReturnValue(nodeEnv) };
    const service = new MobileDeploymentService(prisma as never, {} as never, {} as never, {} as never, config as never);

    if (allowed) {
      await expect(service.requestFleet('client-1', 'manager-1', 'allocation-1'))
        .resolves.toMatchObject({ status: 'FLEET_REQUESTED' });
      expect(prisma.mobileDeploymentWorkflow.update).toHaveBeenCalledOnce();
    } else {
      await expect(service.requestFleet('client-1', 'manager-1', 'allocation-1'))
        .rejects.toThrow('IoT heartbeat is unavailable or stale.');
      expect(prisma.mobileDeploymentWorkflow.update).not.toHaveBeenCalled();
    }
  });
});
