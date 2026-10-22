import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { defaultPolicy } from './readiness-policy.js';
import { FleetReadinessService } from './readiness.service.js';

const actor = (id: string, role: string) =>
  ({ id, clientId: 'client-1', roles: [role] }) as AuthUser;

describe('FleetReadinessService status history', () => {
  it('records the available-to-inspection transition when re-preparation starts', async () => {
    const fleet = {
      id: 'fleet-1',
      clientId: 'client-1',
      status: 'AVAILABLE',
      onboardingStatus: 'ACTIVE',
      allocationBlockedByAdmin: false,
      currentHubId: 'hub-1',
      vehicleTypeId: 'type-1',
      batteryHistory: [],
      controllerHistory: [],
      iotDevice: null,
    };
    const preparation = { id: 'preparation-1', clientId: 'client-1' };
    const tx = {
      $queryRaw: vi.fn(),
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetPreparation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(preparation),
      },
      fleet: { update: vi.fn().mockResolvedValue(fleet) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const db = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetReadinessService(db as never, {} as never);
    vi.spyOn(service, 'policy').mockResolvedValue({
      operatingMode: 'PREPARATION_QC',
      version: 0,
      installationStageTemplates: [],
      configuration: defaultPolicy,
    });
    vi.spyOn(service, 'fleet').mockResolvedValue(fleet as never);
    vi.spyOn(service, 'access').mockResolvedValue(undefined);
    vi.spyOn(service, 'event').mockResolvedValue(undefined);

    await service.start('client-1', actor('rfd-1', 'RFD_MANAGER'), fleet.id);

    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: fleet.id },
      data: {
        readinessApprovedPreparationId: null,
        status: 'INSPECTION_PENDING',
      },
    });
    expect(tx.fleetStatusHistory.create).toHaveBeenCalledWith({
      data: {
        fleetId: fleet.id,
        fromStatus: 'AVAILABLE',
        toStatus: 'INSPECTION_PENDING',
        changedByUserId: 'rfd-1',
        reason: 'Fleet preparation started.',
      },
    });
  });

  it('does not record a no-op available-to-available approval history entry', async () => {
    const preparation = {
      id: 'preparation-1',
      clientId: 'client-1',
      fleetId: 'fleet-1',
      hubId: 'hub-1',
      assignedToId: 'rfd-1',
      createdById: 'rfd-1',
      status: 'AWAITING_QC',
      currentRevision: 1,
      policySnapshot: { configuration: defaultPolicy },
    };
    const revision = {
      id: 'revision-1',
      preparationId: preparation.id,
      revision: 1,
      decision: null,
      reviewedById: null,
      reviewedAt: null,
      submittedById: 'rfd-1',
      rejectionReason: null,
      failedItems: [],
      photoIds: [],
      componentSnapshot: {},
      checklist: { odometerKm: 123 },
    };
    const fleet = {
      id: preparation.fleetId,
      status: 'AVAILABLE',
      onboardingStatus: 'ACTIVE',
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleetPreparation: {
        findFirst: vi.fn().mockResolvedValue(preparation),
        findFirstOrThrow: vi.fn().mockResolvedValue(preparation),
        update: vi.fn(),
      },
      fleetPreparationRevision: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(revision),
        update: vi.fn(),
      },
      fleetPreparationEvent: { count: vi.fn().mockResolvedValue(0) },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      vehicleSubmission: { count: vi.fn().mockResolvedValue(0) },
      photo: { count: vi.fn().mockResolvedValue(0) },
      fleet: { update: vi.fn() },
      fleetStatusHistory: { create: vi.fn() },
    };
    const db = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new FleetReadinessService(db as never, {} as never);
    vi.spyOn(service, 'access').mockResolvedValue(undefined);
    vi.spyOn(service, 'fleet').mockResolvedValue(fleet as never);
    vi.spyOn(service, 'snapshot').mockReturnValue({} as never);
    vi.spyOn(service, 'requireStages').mockResolvedValue(undefined);
    vi.spyOn(service, 'event').mockResolvedValue(undefined);

    await service.review(
      'client-1',
      actor('qc-1', 'QC_MANAGER'),
      preparation.id,
      { revision: 1 },
      true,
    );

    expect(tx.fleetStatusHistory.create).not.toHaveBeenCalled();
  });
});
