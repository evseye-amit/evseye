import {
  AllocationStatus,
  FleetStatus,
  InspectionStatus,
  InspectionType,
  PhotoEntityType,
  RiderStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AllocationsService } from './allocations.service.js';

describe('AllocationsService concurrency guard', () => {
  it('uses a conditional AVAILABLE fleet update to prevent double allocation', async () => {
    const tx = {
      rider: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'rider-1',
          status: RiderStatus.ACTIVE,
        }),
      },
      fleet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      allocation: { create: vi.fn() },
      inspection: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never);

    await expect(
      service.initiate('client-a', 'fleet-busy', 'rider-1', 'operator-1'),
    ).rejects.toThrow('Fleet is not available');
    expect(tx.fleet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-a',
          status: FleetStatus.AVAILABLE,
        }),
        data: { status: FleetStatus.RESERVED },
      }),
    );
  });

  it('rejects allocation when a required fleet onboarding photo is missing', async () => {
    const tx = {
      rider: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'rider-1',
          status: RiderStatus.ACTIVE,
        }),
      },
      fleet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      photoRequirement: {
        findMany: vi.fn().mockResolvedValue([{ photoType: 'FRONT' }]),
      },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      allocation: { create: vi.fn() },
      inspection: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never);

    await expect(
      service.initiate('client-a', 'fleet-1', 'rider-1', 'operator-1'),
    ).rejects.toThrow('Fleet onboarding photos are incomplete: FRONT.');
    expect(tx.photoRequirement.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        entityType: PhotoEntityType.FLEET,
        isRequired: true,
      },
      select: { photoType: true },
    });
  });

  it('rejects allocation for an inactive rider even when called directly', async () => {
    const tx = {
      rider: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'rider-1',
          status: RiderStatus.BLOCKED,
        }),
      },
      fleet: { updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never);

    await expect(
      service.initiate('client-a', 'fleet-1', 'rider-1', 'operator-1'),
    ).rejects.toThrow('Rider must be active before allocation.');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });

  it('only activates an allocation after its completed pre-allocation inspection', async () => {
    const tx = {
      allocation: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'allocation-1', fleetId: 'fleet-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inspection: {
        findFirst: vi.fn().mockResolvedValue({ id: 'inspection-1' }),
      },
      fleet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never);

    await expect(service.activate('client-a', 'allocation-1')).resolves.toEqual(
      { activated: true, allocationId: 'allocation-1' },
    );
    expect(tx.inspection.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        clientId: 'client-a',
        type: InspectionType.PRE_ALLOCATION,
        status: InspectionStatus.COMPLETED,
      }),
    });
    expect(tx.allocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AllocationStatus.OTP_PENDING,
        }),
      }),
    );
    expect(tx.fleet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-a',
          status: FleetStatus.RESERVED,
        }),
        data: { status: FleetStatus.ALLOCATED },
      }),
    );
  });
});
