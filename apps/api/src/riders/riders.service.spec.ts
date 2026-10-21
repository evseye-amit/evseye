import { describe, expect, it, vi } from 'vitest';
import { RidersService } from './riders.service.js';

describe('RidersService client isolation', () => {
  it('looks up a rider with both its ID and the authenticated client ID', async () => {
    const prisma = {
      rider: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new RidersService(prisma as never, {} as never, {} as never);

    await expect(
      service.getById('client-a', 'rider-owned-by-client-b'),
    ).rejects.toThrow('Rider not found');
    expect(prisma.rider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rider-owned-by-client-b',
          clientId: 'client-a',
          deletedAt: null,
        },
      }),
    );
  });
});

function createPersistenceFixture() {
  const transaction = {
    user: { create: vi.fn().mockResolvedValue({ id: 'user-1' }), update: vi.fn() },
    rider: { create: vi.fn().mockResolvedValue({ id: 'rider-1', status: 'ONBOARDING' }), update: vi.fn() },
  };
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    clientOnboardingProgress: { findUnique: vi.fn().mockResolvedValue(null) },
    importJob: { create: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const onboarding = {
    validateAndMapValues: vi.fn().mockResolvedValue({
      data: { name: 'Aman', mobile: '9876543210', metadata: { aadhaarNumber: '123456789012', panNumber: 'ABCDE1234F' } },
    }),
  };
  const service = new RidersService(prisma as never, onboarding as never, {} as never);
  return { service, prisma, transaction, onboarding };
}

describe('RidersService identity claims', () => {
  it('creates the User and Rider in one transaction; the Rider trigger owns claims', async () => {
    const { service, transaction } = createPersistenceFixture();

    await service.create('client-1', { values: {} });

    expect(transaction.user.create).toHaveBeenCalled();
    expect(transaction.rider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', clientId: 'client-1' }),
    }));
  });

  it('maps a duplicate claim to a field-specific conflict without exposing the value', async () => {
    const { service, transaction } = createPersistenceFixture();
    transaction.rider.create.mockRejectedValue({ code: 'P2002', meta: { target: ['clientId', 'panNumber'] } });

    await expect(service.create('client-1', { values: {} })).rejects.toSatisfy((error: unknown) => {
      return Boolean(error && typeof error === 'object'
        && 'status' in error && error.status === 409
        && 'fieldCode' in error && error.fieldCode === 'PAN_NUMBER'
        && !String(error).includes('ABCDE1234F'));
    });
    expect(transaction.rider.create).toHaveBeenCalled();
  });

  it('propagates a PAN conflict as a PAN field in bulk failures', async () => {
    const { service, prisma, transaction, onboarding } = createPersistenceFixture();
    onboarding.validateAndMapValues.mockResolvedValue({
      data: { name: 'Aman', mobile: '9876543210', metadata: { panNumber: 'ABCDE1234F' } },
    });
    transaction.rider.create.mockRejectedValue({ code: 'P2002', meta: { target: ['clientId', 'panNumber'] } });

    await service.bulkCreate('client-1', 'actor-1', 'riders.csv', [{ values: { PAN_NUMBER: 'abcde1234f' } }]);

    expect(prisma.importJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        failedRows: 1,
        metadata: { failures: [expect.objectContaining({ failure_fields: 'PAN_NUMBER' })] },
      }),
    }));
  });

  it('does not allow an identity to be added to an unlinked legacy Rider', async () => {
    const { service, onboarding, prisma } = createPersistenceFixture();
    vi.spyOn(service, 'getById').mockResolvedValue({
      id: 'rider-1', userId: null, metadata: {},
    } as never);
    onboarding.validateAndMapValues.mockResolvedValue({ data: { metadata: { panNumber: 'ABCDE1234F' } } });

    await expect(service.update('client-1', 'rider-1', { values: { PAN_NUMBER: 'abcde1234f' } }))
      .rejects.toThrow('not linked to a user');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes the linked Rider metadata during an admin correction; the Rider trigger replaces the claim', async () => {
    const { service, transaction, onboarding } = createPersistenceFixture();
    vi.spyOn(service, 'getById').mockResolvedValue({
      id: 'rider-1', userId: 'user-1', metadata: { panNumber: 'ABCDE1111A' },
    } as never);
    onboarding.validateAndMapValues.mockResolvedValue({
      data: { metadata: { panNumber: 'ABCDE2222B' } },
    });
    transaction.rider.update.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });

    await service.update('client-1', 'rider-1', { values: { PAN_NUMBER: 'abcde2222b' } });

    expect(transaction.rider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: { panNumber: 'ABCDE2222B' } }),
    }));
  });
});
