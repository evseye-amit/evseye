import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RiderDocumentReviewService } from './rider-document-review.service.js';

function setup(nameFieldCode = 'FULL_NAME') {
  const document = {
    id: 'doc-1', rider: null, photo: { objectKey: 'documents/proof.png' },
    user: { name: 'Pending Rider', mobile: '+919000000000', riderOnboardingProgress: { values: { FULL_NAME: 'Aman Singh' } } },
  };
  const prisma = { riderOnboardingDocument: {
    findMany: vi.fn().mockResolvedValue([document]), findFirst: vi.fn().mockResolvedValue(document),
  } };
  const configuration = { getEffectiveConfiguration: vi.fn().mockResolvedValue({ onboarding: { steps: [
    { fields: nameFieldCode ? [{ storageKey: 'name', fieldCode: nameFieldCode }] : [] },
  ] } }) };
  return { document, service: new RiderDocumentReviewService(prisma as never, configuration as never) };
}

describe('RiderDocumentReviewService rider names', () => {
  it.each(['FULL_NAME', 'RENAMED_NAME', ''])('uses saved onboarding names before a Rider exists (%s)', async (code) => {
    const { service } = setup(code);
    expect((await service.list('client-1', {}))[0]).toMatchObject({ riderName: 'Aman Singh', photo: { fileName: 'proof.png' } });
    expect(await service.get('client-1', 'doc-1')).toMatchObject({ riderName: 'Aman Singh' });
  });

  it('does not expose onboarding values and prefers a completed Rider name', async () => {
    const { document, service } = setup();
    Object.assign(document, { rider: { name: 'Updated Rider' } });
    const result = await service.get('client-1', 'doc-1');
    expect(result.riderName).toBe('Updated Rider');
    expect(result.user).not.toHaveProperty('riderOnboardingProgress');
  });
});

describe('RiderDocumentReviewService fleet-manager scope', () => {
  const manager = {
    id: 'manager-1',
    clientId: 'client-a',
    roles: [UserRole.FLEET_MANAGER],
  };

  function scopedSetup(riderIds: string[], hubIds = ['hub-1']) {
    const document = {
      id: 'doc-1',
      rider: { id: 'rider-1', name: 'Rider One' },
      photo: { objectKey: 'documents/proof.png' },
      user: {
        name: 'Rider One',
        mobile: '+919000000000',
        riderOnboardingProgress: { values: {} },
      },
      fieldCode: 'AADHAAR',
      status: 'PENDING',
    };
    const findMany = vi.fn().mockResolvedValue([document]);
    const findFirst = vi.fn().mockImplementation((input?: { where?: { riderId?: { in?: string[] } } }) =>
      input?.where?.riderId?.in?.length === 0 ? null : document,
    );
    const update = vi.fn().mockResolvedValue(document);
    const riderFindMany = vi.fn().mockResolvedValue(riderIds.map((id) => ({ id })));
    const prisma = {
      userHub: { findMany: vi.fn().mockResolvedValue(hubIds.map((hubId) => ({ hubId }))) },
      rider: { findMany: riderFindMany },
      riderOnboardingDocument: { findMany, findFirst, update },
    };
    const configuration = {
      getEffectiveConfiguration: vi.fn().mockResolvedValue({
        onboarding: { steps: [{ fields: [{ storageKey: 'name', fieldCode: 'FULL_NAME' }] }] },
      }),
    };
    return {
      document,
      findMany,
      findFirst,
      update,
      riderFindMany,
      prisma,
      service: new RiderDocumentReviewService(prisma as never, configuration as never),
    };
  }

  it('filters list and get to riders assigned to the manager hubs', async () => {
    const { service, findMany, findFirst, prisma } = scopedSetup(['rider-1']);

    await service.list('client-a', {}, manager);
    await service.get('client-a', 'doc-1', manager);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ riderId: { in: ['rider-1'] } }),
      }),
    );
    expect(prisma.rider.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        deletedAt: null,
        user: {
          is: {
            hubAssignments: {
              some: { clientId: 'client-a', hubId: { in: ['hub-1'] } },
            },
          },
        },
      },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1', clientId: 'client-a', riderId: { in: ['rider-1'] } },
      }),
    );
  });

  it('does not return or review a rider with no assigned hub', async () => {
    const { service, findMany, findFirst, update } = scopedSetup([]);

    await service.list('client-a', {}, manager);
    await expect(service.get('client-a', 'doc-1', manager)).rejects.toThrow('Rider document not found.');
    await expect(service.approve('client-a', manager.id, 'doc-1', manager)).rejects.toThrow('Rider document not found.');
    await expect(service.reject('client-a', manager.id, 'doc-1', 'bad document', manager)).rejects.toThrow('Rider document not found.');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ riderId: { in: [] } }),
      }),
    );
    expect(findFirst).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps document reads scoped to the requested client', async () => {
    const { service, findMany, findFirst, prisma } = scopedSetup(['rider-1']);

    await service.list('client-b', {}, manager);
    await expect(service.get('client-b', 'doc-1', manager)).resolves.toBeDefined();

    expect(prisma.userHub.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-b', userId: manager.id },
      select: { hubId: true },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'client-b' }),
    }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'client-b' }),
    }));
  });

  it('keeps review writes inside the rider hub scope', async () => {
    const { service, findFirst, update } = scopedSetup(['rider-1']);

    await service.approve('client-a', manager.id, 'doc-1', manager);
    await service.reject('client-a', manager.id, 'doc-1', 'Bad document', manager);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'doc-1',
        clientId: 'client-a',
        supersededAt: null,
        riderId: { in: ['rider-1'] },
      },
      select: { status: true },
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('keeps broad access for a fleet manager with an existing client-admin role', async () => {
    const { service, findMany, prisma } = scopedSetup(['rider-1']);
    const dualRoleUser = { ...manager, roles: [UserRole.FLEET_MANAGER, UserRole.CLIENT_ADMIN] };

    await service.list('client-a', {}, dualRoleUser);

    expect(prisma.rider.findMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ riderId: expect.anything() }),
      }),
    );
  });

  it('returns no documents when the fleet manager has no assigned hubs', async () => {
    const { service, findMany, prisma } = scopedSetup(['rider-1'], []);

    await service.list('client-a', {}, manager);

    expect(prisma.rider.findMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ riderId: { in: [] } }),
      }),
    );
  });

  it('keeps broad review access for a fleet manager with an existing KYC-operator role', async () => {
    const { service, findMany, prisma } = scopedSetup(['rider-1']);
    const dualRoleUser = { ...manager, roles: [UserRole.FLEET_MANAGER, UserRole.KYC_OPERATOR] };

    await service.list('client-a', {}, dualRoleUser);

    expect(prisma.rider.findMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ riderId: expect.anything() }),
      }),
    );
  });
});
