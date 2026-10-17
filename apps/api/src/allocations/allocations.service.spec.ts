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
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'fleet-1' }]),
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      commercialRestriction: { findFirst: vi.fn().mockResolvedValue(null) },
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
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

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
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'fleet-1' }]),
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      commercialRestriction: { findFirst: vi.fn().mockResolvedValue(null) },
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
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

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
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'fleet-1' }]),
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      commercialRestriction: { findFirst: vi.fn().mockResolvedValue(null) },
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
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

    await expect(
      service.initiate('client-a', 'fleet-1', 'rider-1', 'operator-1'),
    ).rejects.toThrow('Rider must be active before allocation.');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });

  it('only activates an allocation after its completed pre-allocation inspection', async () => {
    const tx = {
      $queryRaw: vi.fn(),
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
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

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

describe('collection allocation restriction', () => {
  it('blocks a new allocation before reserving a fleet', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'fleet-1' }]),
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1', status: RiderStatus.ACTIVE }) },
      commercialRestriction: { findFirst: vi.fn().mockResolvedValue({ caseId: 'case-1' }) },
      fleet: { updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) };
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);
    await expect(service.initiate('client-a','fleet-1','rider-1','operator-1')).rejects.toMatchObject({ status: 409 });
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
});

describe('deallocation completion safety gate', () => {
  it('finalizes a received return from its safety result without legacy OTPs', async () => {
    const tx = {
      vehicleSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      allocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          fleetId: 'fleet-1',
          deallocatedAt: new Date('2026-10-13T10:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inspection: {
        findFirst: vi.fn().mockResolvedValue({ safeForReuse: false }),
      },
      rentalTerminationRequest: {
        findFirst: vi.fn().mockImplementation(({ where }) => where.submissionRequired ? null : { id: 'return-1' }),
      },
      otpRequest: { findMany: vi.fn() },
      fleet: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

    await expect(
      service.completeDeallocation('client-a', 'allocation-1'),
    ).resolves.toEqual({ completed: true });
    expect(tx.otpRequest.findMany).not.toHaveBeenCalled();
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: 'fleet-1' },
      data: { status: FleetStatus.MAINTENANCE, allocationEnabled: false },
    });
  });

  it('keeps the legacy dual OTP gate for standalone deallocation', async () => {
    const tx = {
      vehicleSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      allocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          fleetId: 'fleet-1',
          deallocatedAt: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inspection: {
        findFirst: vi.fn().mockResolvedValue({ safeForReuse: null }),
      },
      rentalTerminationRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      otpRequest: {
        findMany: vi.fn().mockResolvedValue([
          { purpose: 'DEALLOCATION_RIDER', context: { allocationId: 'allocation-1' } },
          { purpose: 'DEALLOCATION_OPERATOR', context: { allocationId: 'allocation-1' } },
        ]),
      },
      fleet: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

    await expect(
      service.completeDeallocation('client-a', 'allocation-1'),
    ).resolves.toEqual({ completed: true });
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: 'fleet-1' },
      data: { status: FleetStatus.AVAILABLE, allocationEnabled: true },
    });
  });

  it('reuses an already initiated allocation for a legacy return adapter', async () => {
    const tx = {
      vehicleSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      allocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          status: AllocationStatus.DEALLOCATION_INITIATED,
          fleetId: 'fleet-1',
        }),
        update: vi.fn(),
      },
      fleet: { updateMany: vi.fn() },
      inspection: { upsert: vi.fn().mockResolvedValue({ id: 'inspection-1' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AllocationsService(prisma as never, { activateInTransaction: vi.fn() } as never);

    await expect(
      service.initiateDeallocation('client-a', 'allocation-1'),
    ).resolves.toEqual({ allocationId: 'allocation-1', inspectionId: 'inspection-1' });
    expect(tx.allocation.update).not.toHaveBeenCalled();
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
    expect(tx.inspection.upsert).toHaveBeenCalledOnce();
  });
});
