import {
  AllocationStatus,
  InspectionStatus,
  PhotoEntityType,
  PhotoStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { InspectionsService } from './inspections.service.js';

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
    const service = new InspectionsService(prisma as never);

    await expect(
      service.complete('client-a', 'inspection-1', 'operator-1'),
    ).rejects.toMatchObject({
      response: {
        message: 'Required inspection photos are missing.',
        missing: ['REAR'],
      },
    });
    expect(prisma.photo.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        entityType: PhotoEntityType.INSPECTION,
        entityId: 'inspection-1',
        status: PhotoStatus.COMPLETE,
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
    const service = new InspectionsService(prisma as never);

    await expect(
      service.complete('client-a', 'inspection-1', 'operator-1'),
    ).rejects.toThrow('Inspection has already been completed.');
  });
});
