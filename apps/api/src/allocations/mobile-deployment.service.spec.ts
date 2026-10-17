import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MobileDeploymentService } from './mobile-deployment.service.js';

describe('MobileDeploymentService.fleetRequests', () => {
  it('loads completed fleet evidence from Photo without including a nonexistent Fleet relation', async () => {
    const requests = [
      {
        id: 'allocation-1',
        fleetId: 'fleet-1',
        fleet: { id: 'fleet-1', iotDevice: null },
      },
      {
        id: 'allocation-2',
        fleetId: 'fleet-2',
        fleet: { id: 'fleet-2', iotDevice: null },
      },
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
    const service = new MobileDeploymentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.fleetRequests('client-1', 'manager-1');

    expect(prisma.allocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          rider: true,
          fleet: { include: { iotDevice: true } },
          mobileDeployment: true,
        },
      }),
    );
    expect(prisma.photo.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        entityType: PhotoEntityType.FLEET,
        entityId: { in: ['fleet-1', 'fleet-2'] },
        status: PhotoStatus.COMPLETE,
      },
      orderBy: { uploadedAt: 'asc' },
    });
    expect(
      result.map((request) => request.fleet.photos.map((photo) => photo.id)),
    ).toEqual([['photo-1'], ['photo-2']]);
  });
});

describe('MobileDeploymentService.requestFleet', () => {
  it.each([null, { lastHeartbeatAt: null }, { lastHeartbeatAt: new Date(0) }])(
    'allows deployment with missing or stale IoT: %j',
    async (iotDevice) => {
      const prisma = {
        userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
        allocation: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'allocation-1',
            fleetId: 'fleet-1',
            fleet: { iotDevice },
          }),
        },
        mobileDeploymentWorkflow: {
          upsert: vi
            .fn()
            .mockResolvedValue({ id: 'workflow-1', status: 'RIDER_WAITING' }),
          update: vi
            .fn()
            .mockResolvedValue({ id: 'workflow-1', status: 'FLEET_REQUESTED' }),
        },
        photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
        photo: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const service = new MobileDeploymentService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(
        service.requestFleet('client-1', 'manager-1', 'allocation-1'),
      ).resolves.toMatchObject({ status: 'FLEET_REQUESTED' });
    },
  );
});

describe('mobile PDI submission', () => {
  it('advances the allocation together with the completed inspection and rider workflow', async () => {
    const tx = {
      inspection: { update: vi.fn().mockResolvedValue({}) },
      allocation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      mobileDeploymentWorkflow: { update: vi.fn().mockResolvedValue({ status: 'PDI_PENDING_RIDER' }) },
    };
    const prisma = {
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      allocation: { findFirst: vi.fn().mockResolvedValue({ id: 'allocation-1' }) },
      mobileDeploymentWorkflow: { upsert: vi.fn().mockResolvedValue({ id: 'workflow-1', status: 'PAYMENT_PAID' }) },
      inspection: { findFirst: vi.fn().mockResolvedValue({ id: 'inspection-1' }) },
      photoRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(fn => fn(tx)),
    };
    const service = new MobileDeploymentService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.submitPdi('client-1', 'manager-1', 'allocation-1', 'Partner', [{ code: 'FRONT', mandatory: true }]))
      .resolves.toMatchObject({ status: 'PDI_PENDING_RIDER' });
    expect(tx.inspection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
    expect(tx.allocation.updateMany).toHaveBeenCalledWith({
      where: { id: 'allocation-1', clientId: 'client-1', status: 'INSPECTION_PENDING' },
      data: { status: 'OTP_PENDING' },
    });
  });
});

describe('deployment without IoT pairing', () => {
  function fixture(status = 'TRAINING_PENDING', viewed = ['SAFETY']) {
    const workflow = {
      id: 'workflow-1',
      status,
      trainingViewedContentCodes: viewed,
      trainingCompletedAt:
        status === 'DEVICE_PAIRING_PENDING' ? new Date('2026-10-01') : null,
    };
    const tx = {
      allocation: {
        findFirst: vi.fn().mockResolvedValue({ fleetId: 'fleet-1', status: 'OTP_PENDING' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fleet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inspection: { findFirst: vi.fn().mockResolvedValue({ id: 'inspection-1' }) },
      mobileDeploymentWorkflow: {
        update: vi
          .fn()
          .mockImplementation(({ data }) => ({ ...workflow, ...data })),
      },
    };
    const prisma = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      allocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          fleet: { iotDevice: null },
        }),
      },
      mobileDeploymentWorkflow: {
        upsert: vi.fn().mockResolvedValue(workflow),
        update: tx.mobileDeploymentWorkflow.update,
      },
      clientSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          package: {
            features: [
              {
                feature: {
                  trainingContents: [{ code: 'SAFETY', isMandatory: true }],
                },
              },
            ],
          },
        }),
      },
      $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    };
    return {
      prisma,
      tx,
      workflow,
      service: new MobileDeploymentService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }
  it('activates allocation and fleet immediately after mandatory training', async () => {
    const { service, tx } = fixture();
    await expect(
      service.completeTraining('client-1', 'rider-user', 'allocation-1'),
    ).resolves.toMatchObject({
      status: 'DEPLOYED',
      trainingCompletedAt: expect.any(Date),
    });
    expect(tx.allocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'ACTIVE', allocatedAt: expect.any(Date) },
      }),
    );
    expect(tx.fleet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ALLOCATED' } }),
    );
  });
  it('still blocks deployment before mandatory training is viewed', async () => {
    const { service, prisma } = fixture('TRAINING_PENDING', []);
    await expect(
      service.completeTraining('client-1', 'rider-user', 'allocation-1'),
    ).rejects.toThrow('Complete mandatory training');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('allows old pairing-pending allocations to finish without a mapped device', async () => {
    const { service, prisma, workflow } = fixture('DEVICE_PAIRING_PENDING');
    await expect(
      service.pair('client-1', 'rider-user', 'allocation-1', ''),
    ).resolves.toMatchObject({
      status: 'DEPLOYED',
      trainingCompletedAt: workflow.trainingCompletedAt,
    });
    expect(prisma.clientSubscription.findFirst).not.toHaveBeenCalled();
  });
  it('does not activate an already deployed allocation twice', async () => {
    const { service, prisma } = fixture('DEPLOYED');
    await expect(
      service.completeTraining('client-1', 'rider-user', 'allocation-1'),
    ).resolves.toMatchObject({ status: 'DEPLOYED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('directs older pairing-pending workflows to training completion', async () => {
    const { service, prisma, workflow } = fixture('DEVICE_PAIRING_PENDING');
    prisma.allocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      fleet: { iotDevice: null },
      mobileDeployment: workflow,
    } as never);
    Object.assign(prisma, {
      deploymentPayment: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.riderCurrent('client-1', 'rider-user'),
    ).resolves.toMatchObject({ screen: 'TRAINING' });
  });
  it('keeps legacy fleet-manager completion available without IoT health', async () => {
    const { service } = fixture('DEVICE_PAIRING_PENDING');
    await expect(
      service.bypassPairing(
        'client-1',
        'manager-1',
        'allocation-1',
        'Client does not use IoT',
      ),
    ).resolves.toMatchObject({ status: 'DEPLOYED' });
  });
  function packageWithoutTraining(
    prisma: ReturnType<typeof fixture>['prisma'],
  ) {
    prisma.clientSubscription.findFirst.mockResolvedValue({
      package: { features: [] },
    });
  }
  it('finishes a stuck training workflow when the package excludes training without recording fake training completion', async () => {
    const { service, prisma, tx } = fixture('TRAINING_PENDING', []);
    packageWithoutTraining(prisma);
    await expect(
      service.completeTraining('client-1', 'rider-user', 'allocation-1'),
    ).resolves.toMatchObject({ status: 'DEPLOYED', trainingCompletedAt: null });
    expect(tx.allocation.updateMany).toHaveBeenCalled();
  });
  it.each([
    { contents: [] },
    { contents: [{ code: 'OPTIONAL', isMandatory: false }] },
  ])(
    'allows training completion with no mandatory content: %j',
    async ({ contents }) => {
      const { service, prisma } = fixture('TRAINING_PENDING', []);
      prisma.clientSubscription.findFirst.mockResolvedValue({
        package: { features: [{ feature: { trainingContents: contents } }] },
      });
      await expect(
        service.completeTraining('client-1', 'rider-user', 'allocation-1'),
      ).resolves.toMatchObject({
        status: 'DEPLOYED',
        trainingCompletedAt: expect.any(Date),
      });
    },
  );
  it('skips training atomically after PDI acceptance when it is excluded from the package', async () => {
    const { service, prisma, workflow } = fixture('PDI_PENDING_RIDER', []);
    Object.assign(workflow, {
      pdiChecklist: [{ code: 'FRONT', mandatory: true }],
    });
    packageWithoutTraining(prisma);
    await expect(
      service.acceptPdi('client-1', 'rider-user', 'allocation-1', [
        { code: 'FRONT', accepted: true },
      ]),
    ).resolves.toMatchObject({
      status: 'DEPLOYED',
      riderPdiAcceptedAt: expect.any(Date),
      trainingCompletedAt: null,
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
  it.each([true, false])('handles legacy inspection-pending PDI acceptance only with completed inspection: %s', async (completed) => {
    const { service, prisma, tx, workflow } = fixture('PDI_PENDING_RIDER', []);
    Object.assign(workflow, { pdiChecklist: [{ code: 'FRONT', mandatory: true }] });
    packageWithoutTraining(prisma);
    tx.allocation.findFirst.mockResolvedValue({ fleetId: 'fleet-1', status: 'INSPECTION_PENDING' });
    tx.inspection.findFirst.mockResolvedValue(completed ? { id: 'inspection-1' } : null as never);
    const result = service.acceptPdi('client-1', 'rider-user', 'allocation-1', [{ code: 'FRONT', accepted: true }]);
    if (completed) {
      await expect(result).resolves.toMatchObject({ status: 'DEPLOYED' });
      expect(tx.allocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'allocation-1', clientId: 'client-1', status: 'INSPECTION_PENDING' },
        data: { status: 'ACTIVE', allocatedAt: expect.any(Date) },
      });
    } else {
      await expect(result).rejects.toThrow('Complete PDI first');
      expect(tx.fleet.updateMany).not.toHaveBeenCalled();
      expect(tx.allocation.updateMany).not.toHaveBeenCalled();
    }
  });
  it('keeps training as a package-included step after accepting PDI', async () => {
    const { service, prisma, workflow } = fixture('PDI_PENDING_RIDER', []);
    Object.assign(workflow, {
      pdiChecklist: [{ code: 'FRONT', mandatory: true }],
    });
    await expect(
      service.acceptPdi('client-1', 'rider-user', 'allocation-1', [
        { code: 'FRONT', accepted: true },
      ]),
    ).resolves.toMatchObject({
      status: 'TRAINING_PENDING',
      riderPdiAcceptedAt: expect.any(Date),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('preserves PDI and allocation readiness checks when skipping training', async () => {
    const { service, prisma, tx, workflow } = fixture('PDI_PENDING_RIDER', []);
    Object.assign(workflow, {
      pdiChecklist: [{ code: 'FRONT', mandatory: true }],
    });
    packageWithoutTraining(prisma);
    await expect(
      service.acceptPdi('client-1', 'rider-user', 'allocation-1', []),
    ).rejects.toThrow('acknowledged');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    tx.allocation.findFirst.mockResolvedValue(null as never);
    await expect(
      service.acceptPdi('client-1', 'rider-user', 'allocation-1', [
        { code: 'FRONT', accepted: true },
      ]),
    ).rejects.toThrow('not ready for deployment');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('does not treat a missing active subscription as training excluded', async () => {
    const { service, prisma } = fixture('TRAINING_PENDING', []);
    prisma.clientSubscription.findFirst.mockResolvedValue(null as never);
    await expect(
      service.completeTraining('client-1', 'rider-user', 'allocation-1'),
    ).rejects.toThrow('No active package');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('recovers an old excluded-training workflow on the rider current screen', async () => {
    const { service, prisma, workflow } = fixture('TRAINING_PENDING', []);
    packageWithoutTraining(prisma);
    const initial = {
      id: 'allocation-1',
      fleet: { iotDevice: null },
      mobileDeployment: workflow,
    };
    prisma.allocation.findFirst
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValueOnce({ id: 'allocation-1' } as never)
      .mockResolvedValueOnce({
        id: 'allocation-1',
        fleet: { iotDevice: null },
      } as never)
      .mockResolvedValueOnce({
        ...initial,
        mobileDeployment: { ...workflow, status: 'DEPLOYED' },
        status: 'ACTIVE',
      } as never);
    Object.assign(prisma, {
      deploymentPayment: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.riderCurrent('client-1', 'rider-user'),
    ).resolves.toMatchObject({
      screen: 'HOME',
      workflow: { status: 'DEPLOYED' },
      allocation: { status: 'ACTIVE' },
    });
  });
});
