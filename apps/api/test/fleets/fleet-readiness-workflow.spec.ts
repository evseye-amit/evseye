import { FleetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from '../../src/fleets/fleets.service.js';

describe('fleet readiness workflow creation contract', () => {
  it('saves the selected workflow and never accepts In transit at creation', async () => {
    const prisma = {
      oem: { findFirst: vi.fn().mockResolvedValue({ id: 'oem-1' }) },
      vehicleCategory: { findFirst: vi.fn().mockResolvedValue({ id: 'category-1' }) },
      vehicleType: { findFirst: vi.fn().mockResolvedValue({ id: 'type-1' }) },
      fleet: { create: vi.fn().mockResolvedValue({ id: 'fleet-1', status: FleetStatus.PENDING_ACTIVATION }) },
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }) },
      clientOnboardingProgress: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.create('client-a', {
        chassisNumber: 'CHASSIS-1',
        oemId: 'oem-1',
        vehicleCategoryId: 'category-1',
        vehicleTypeId: 'type-1',
        speedType: 'SLOW_SPEED',
        status: FleetStatus.IN_TRANSIT,
        readinessWorkflow: 'STAGED_PREPARATION_QC',
        readinessStagePlanCode: 'standard',
      }),
    ).rejects.toThrow('Fleet transfers start after creation');
  });
});
