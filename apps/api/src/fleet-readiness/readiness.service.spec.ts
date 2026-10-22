import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { defaultPolicy, vehicleReadiness } from './readiness-policy.js';
import { FleetReadinessService } from './readiness.service.js';

const actor = (id: string, role: string) =>
  ({ id, clientId: 'client-1', roles: [role] }) as AuthUser;

describe('FleetReadinessService status history', () => {
  it.each([
    ['SIMPLE', true],
    ['ONBOARDING_EVIDENCE', true],
    ['PREPARATION_QC', false],
    ['STAGED_PREPARATION_QC', false],
  ] as const)('keeps vehicle readiness mode-specific for %s', (operatingMode, ready) => {
    expect(
      vehicleReadiness({
        operatingMode,
        status: 'AVAILABLE',
        allocationEnabled: true,
        onboardingStatus: 'ACTIVE',
        readinessApprovedPreparationId: null,
        unfinishedAllocationCount: 0,
      }),
    ).toMatchObject({ ready });
  });

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

  it('uses the shared vehicle rule for detail blockers and next step', async () => {
    const fleet = {
      id: 'fleet-1',
      status: 'INSPECTION_PENDING',
      onboardingStatus: 'DRAFT',
      allocationEnabled: false,
      readinessApprovedPreparationId: null,
      currentHubId: 'hub-1',
    };
    const db = {
      fleetPreparation: { findFirst: vi.fn().mockResolvedValue(null) },
      allocation: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new FleetReadinessService(db as never, {} as never);
    vi.spyOn(service, 'fleet').mockResolvedValue(fleet as never);
    vi.spyOn(service, 'access').mockResolvedValue(undefined);
    vi.spyOn(service, 'policy').mockResolvedValue({
      operatingMode: 'PREPARATION_QC',
      version: 0,
      installationStageTemplates: [],
      configuration: defaultPolicy,
    });

    await expect(
      service.readiness('client-1', actor('manager-1', 'FLEET_MANAGER'), fleet.id),
    ).resolves.toMatchObject({
      blockers: [
        'Scooter status is INSPECTION_PENDING.',
        'Allocation is administratively disabled.',
        'Fleet activation is incomplete.',
        'Preparation and QC approval are required.',
        'Scooter has an unfinished allocation.',
      ],
      nextStep: 'Complete preparation and QC approval.',
      canAllocate: false,
    });
  });

  it('returns exact vehicle impact rows with overlapping effects on mode change', async () => {
    const impactRows = [
      {
        id: 'fleet-2',
        vehicleNumber: 'EV-2',
        fleetCode: 'FLT-2',
        chassisNumber: 'CHASSIS-2',
        deletedAt: null,
        status: 'AVAILABLE',
        allocationEnabled: true,
        readinessApprovedPreparationId: null,
        allocations: [{ status: 'INSPECTION_PENDING' }],
        preparations: [],
      },
      {
        id: 'fleet-1',
        vehicleNumber: null,
        fleetCode: 'FLT-1',
        chassisNumber: 'CHASSIS-1',
        deletedAt: null,
        status: 'AVAILABLE',
        allocationEnabled: false,
        readinessApprovedPreparationId: 'preparation-approved',
        allocations: [{ status: 'ACTIVE' }, { status: 'INITIATED' }],
        preparations: [{ status: 'APPROVED' }, { status: 'PENDING' }],
      },
      {
        id: 'fleet-3',
        vehicleNumber: 'EV-3',
        fleetCode: 'FLT-3',
        chassisNumber: 'CHASSIS-3',
        deletedAt: null,
        status: 'ALLOCATED',
        allocationEnabled: true,
        readinessApprovedPreparationId: null,
        allocations: [{ status: 'ACTIVE' }],
        preparations: [],
      },
      {
        id: 'fleet-4',
        vehicleNumber: 'EV-4',
        fleetCode: 'FLT-4',
        chassisNumber: 'CHASSIS-4',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'AVAILABLE',
        allocationEnabled: false,
        readinessApprovedPreparationId: 'deleted-approval',
        allocations: [],
        preparations: [{ status: 'APPROVED' }],
      },
    ];
    const tx = {
      allocation: { count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1) },
      fleetPreparation: { count: vi.fn().mockResolvedValue(1) },
      fleet: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue(impactRows),
      },
    };
    const service = new FleetReadinessService({} as never, {} as never);
    vi.spyOn(service, 'policy').mockResolvedValue({
      operatingMode: 'SIMPLE',
      version: 1,
      installationStageTemplates: [],
      configuration: defaultPolicy,
    });

    const result = await service.preview(
      'client-1',
      actor('admin-1', 'CLIENT_ADMIN'),
      { operatingMode: 'PREPARATION_QC' },
      tx as never,
    );

    expect(result.vehicleImpact).toEqual([
      {
        fleetId: 'fleet-1',
        vehicleNumber: null,
        fleetCode: 'FLT-1',
        chassisNumber: 'CHASSIS-1',
        effects: [
          'MOVE_TO_INSPECTION_PENDING',
          'PRESERVE_ADMIN_ALLOCATION_BLOCK',
          'CLEAR_READINESS_APPROVAL',
          'INVALIDATE_APPROVED_PREPARATION',
          'BLOCKED_BY_ALLOCATION_WORK',
          'BLOCKED_BY_OPEN_PREPARATION',
          'ACTIVE_ALLOCATION_UNCHANGED',
        ],
      },
      {
        fleetId: 'fleet-2',
        vehicleNumber: 'EV-2',
        fleetCode: 'FLT-2',
        chassisNumber: 'CHASSIS-2',
        effects: ['MOVE_TO_INSPECTION_PENDING', 'BLOCKED_BY_ALLOCATION_WORK'],
      },
      {
        fleetId: 'fleet-3',
        vehicleNumber: 'EV-3',
        fleetCode: 'FLT-3',
        chassisNumber: 'CHASSIS-3',
        effects: ['ACTIVE_ALLOCATION_UNCHANGED'],
      },
      {
        fleetId: 'fleet-4',
        vehicleNumber: 'EV-4',
        fleetCode: 'FLT-4',
        chassisNumber: 'CHASSIS-4',
        effects: [
          'PRESERVE_ADMIN_ALLOCATION_BLOCK',
          'INVALIDATE_APPROVED_PREPARATION',
        ],
      },
    ]);
    expect(result).toMatchObject({
      currentMode: 'SIMPLE',
      proposedMode: 'PREPARATION_QC',
      inProgressAllocations: 2,
      openPreparations: 1,
      unallocatedScooters: 3,
      activeAllocations: 1,
      blocked: true,
    });
    expect(tx.fleet.findMany).toHaveBeenCalledTimes(1);
    expect(tx.fleet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1' },
        select: expect.objectContaining({
          id: true,
          fleetCode: true,
          allocations: expect.any(Object),
          preparations: expect.any(Object),
        }),
      }),
    );
  });

  it('keeps preview counts and returns no vehicle impact for an unchanged mode', async () => {
    const tx = {
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetPreparation: { count: vi.fn().mockResolvedValue(0) },
      fleet: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn() },
    };
    const service = new FleetReadinessService({} as never, {} as never);
    vi.spyOn(service, 'policy').mockResolvedValue({
      operatingMode: 'SIMPLE',
      version: 1,
      installationStageTemplates: [],
      configuration: defaultPolicy,
    });

    const result = await service.preview(
      'client-1',
      actor('admin-1', 'CLIENT_ADMIN'),
      { operatingMode: 'SIMPLE' },
      tx as never,
    );

    expect(result.vehicleImpact).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(tx.fleet.findMany).not.toHaveBeenCalled();
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
