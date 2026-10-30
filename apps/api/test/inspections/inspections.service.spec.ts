import {
  AllocationStatus,
  InspectionStatus,
  PhotoStatus,
  UserRole,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { InspectionsService } from '../../src/inspections/inspections.service.js';

describe('InspectionsService', () => {
  it('does not complete an inspection with missing required evidence', async () => {
    const prisma = {
      inspection: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          status: InspectionStatus.DRAFT,
          allocation: { status: AllocationStatus.INSPECTION_PENDING },
        }),
      },
      photoRequirement: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ photoType: 'FRONT' }, { photoType: 'REAR' }]),
      },
      photo: { findMany: vi.fn().mockResolvedValue([{ photoType: 'FRONT' }]) },
    };
    const service = new InspectionsService(prisma as never, {} as never);

    await expect(
      service.complete('client-a', 'inspection-1', {
        id: 'operator-1',
        clientId: 'client-a',
        roles: [UserRole.FLEET_MANAGER],
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Required inspection photos are missing.',
        missing: ['REAR'],
      },
    });
    expect(prisma.photo.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        subjectType: 'FLEET',
        entityId: 'inspection-1',
        status: PhotoStatus.COMPLETE,
        workFlowType: 'FLEET_SUBMISSION',
      },
      select: { photoType: true },
    });
  });

  it('does not complete an inspection twice', async () => {
    const prisma = {
      inspection: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          status: InspectionStatus.COMPLETED,
          allocation: { status: AllocationStatus.OTP_PENDING },
        }),
      },
    };
    const service = new InspectionsService(prisma as never, {} as never);

    await expect(
      service.complete('client-a', 'inspection-1', {
        id: 'operator-1',
        clientId: 'client-a',
        roles: [UserRole.FLEET_MANAGER],
      }),
    ).rejects.toThrow('Inspection has already been completed.');
  });

  it('requires an unsafe reason when completing a post-return inspection', async () => {
    const prisma = {
      inspection: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          status: InspectionStatus.DRAFT,
          type: 'POST_DEALLOCATION',
          allocation: { status: AllocationStatus.INSPECTION_PENDING },
        }),
      },
      photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };
    const service = new InspectionsService(prisma as never, {} as never);

    await expect(
      service.complete(
        'client-a',
        'inspection-1',
        {
          id: 'operator-1',
          clientId: 'client-a',
          roles: [UserRole.FLEET_MANAGER],
        },
        { safeForReuse: false } as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'UNSAFE_REASON_REQUIRED' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('finalizes a physically received return from the safety inspection', async () => {
    const finalize = vi.fn().mockResolvedValue({ completed: true });
    const tx = {
      inspection: {
        update: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          allocationId: 'allocation-1',
          type: 'POST_DEALLOCATION',
          status: InspectionStatus.COMPLETED,
          safeForReuse: true,
        }),
      },
      rentalTerminationRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: 'return-1' }),
      },
      allocation: { update: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: 'allocation-1' }) },
      fleet: { update: vi.fn() },
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-a' }]) },
    };
    const prisma = {
      inspection: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          allocationId: 'allocation-1',
          status: InspectionStatus.DRAFT,
          type: 'POST_DEALLOCATION',
          allocation: { status: AllocationStatus.DEALLOCATION_INITIATED },
        }),
      },
      photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new InspectionsService(
      prisma as never,
      { completeDeallocationInTransaction: finalize } as never,
    );

    await expect(
      service.complete('client-a', 'inspection-1', {
        id: 'operator-1',
        clientId: 'client-a',
        roles: [UserRole.FLEET_MANAGER],
      }, {
        safeForReuse: true,
      }),
    ).resolves.toMatchObject({ status: InspectionStatus.COMPLETED });
    expect(finalize).toHaveBeenCalledWith(tx, 'client-a', 'allocation-1');
    expect(tx.allocation.update).not.toHaveBeenCalled();
  });

  it('keeps fleet-manager inspection completion inside assigned Hub scope', async () => {
    const tx = {
      inspection: { update: vi.fn() },
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-a' }]) },
      allocation: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      inspection: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inspection-1',
          allocationId: 'allocation-1',
          status: InspectionStatus.DRAFT,
          type: 'PRE_ALLOCATION',
          allocation: { status: AllocationStatus.INSPECTION_PENDING },
        }),
      },
      photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new InspectionsService(prisma as never, {} as never);

    await expect(
      service.complete('client-a', 'inspection-1', {
        id: 'fleet-manager-1',
        clientId: 'client-a',
        roles: [UserRole.FLEET_MANAGER],
      }),
    ).rejects.toThrow('Inspection is not in an assigned Hub.');
  });
});
