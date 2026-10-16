import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RiderReferenceReviewService } from './rider-reference-review.service.js';

const contact = { name: 'Nisha Singh', mobile: '9876543210', relation: 'Sister' };
const other = { name: 'Vikram Singh', mobile: '+919876543211', relation: 'Friend' };
function setup() {
  const decisions: any[] = [];
  const riders: any[] = [];
  const progresses: any[] = [{ userId: 'user-1', values: { FULL_NAME: 'Aman Singh', RIDER_REFERENCES: [contact, other] },
    createdAt: new Date(), user: { name: 'Pending Rider', mobile: '+919876543212' } }];
  const prisma = {
    rider: { findMany: vi.fn(async (_args: any) => riders), findFirst: vi.fn(async () => riders[0] ?? null) },
    riderOnboardingProgress: { findMany: vi.fn(async (_args: any) => progresses) },
    riderReferenceReview: {
      findMany: vi.fn(async () => decisions),
      create: vi.fn(async ({ data }: any) => {
        if (decisions.some((entry) => entry.id === data.id)) throw new Prisma.PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: '6' });
        const decision = { ...data, reviewedAt: new Date(), reviewedBy: { id: 'manager-1', name: 'Manager' } };
        decisions.push(decision); return decision;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const configuration = { getEffectiveConfiguration: vi.fn().mockResolvedValue({ onboarding: { steps: [{ fields: [
    { featureCode: 'CAPTURE_FULL_NAME', fieldCode: 'FULL_NAME', storageKey: 'name' },
    { featureCode: 'CAPTURE_REFERENCE', fieldCode: 'RIDER_REFERENCES', storageKey: 'metadata.references', fieldType: 'REFERENCE' },
  ] }] } }) };
  return { service: new RiderReferenceReviewService(prisma as never, configuration as never), prisma, decisions, riders, progresses, configuration };
}

describe('RiderReferenceReviewService', () => {
  it('returns pending references and saved rider names before onboarding completes, without writes', async () => {
    const { service, prisma } = setup();
    const refs = await service.list('client-a');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ riderName: 'Aman Singh', riderId: null, userId: 'user-1', status: 'PENDING', mobile: '+919876543210' });
    expect(prisma.riderReferenceReview.create).not.toHaveBeenCalled();
    expect(prisma.rider.findMany.mock.calls[0][0].where.clientId).toBe('client-a');
    expect(prisma.riderOnboardingProgress.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client-a', user: { clientId: 'client-a', role: 'RIDER', rider: null } });
  });

  it('records reviewer/time/reason and retains the decision through reorder and onboarding completion', async () => {
    const { service, progresses, riders } = setup();
    const [reference] = await service.list('client-a');
    expect(await service.review('client-a', 'manager-1', reference.id, 'REJECTED', '  Cannot confirm relationship.  '))
      .toMatchObject({ status: 'REJECTED', rejectionReason: 'Cannot confirm relationship.', reviewedBy: { id: 'manager-1' }, reviewedAt: expect.any(Date) });
    progresses[0].values.RIDER_REFERENCES.reverse();
    expect((await service.list('client-a')).find((entry) => entry.id === reference.id)?.status).toBe('REJECTED');
    riders.push({ id: 'rider-1', userId: 'user-1', name: 'Aman Singh', mobile: '+919876543212', metadata: { references: [contact, other] }, createdAt: new Date() });
    progresses.length = 0;
    expect((await service.forRider('client-a', 'rider-1'))[0]).toMatchObject({ id: reference.id, riderId: 'rider-1', status: 'REJECTED' });
  });

  it('rejects stale details, isolates tenant fingerprints, and resets changed contacts to pending', async () => {
    const { service, progresses } = setup();
    const [reference] = await service.list('client-a');
    await service.review('client-a', 'manager-1', reference.id, 'APPROVED');
    expect((await service.list('client-b'))[0]).toMatchObject({ status: 'PENDING' });
    await expect(service.review('client-b', 'manager-b', reference.id, 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
    progresses[0].values.RIDER_REFERENCES[0] = { ...contact, mobile: '9876543213' };
    expect((await service.list('client-a'))[0]).toMatchObject({ status: 'PENDING' });
    await expect(service.review('client-a', 'manager-1', reference.id, 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
    progresses[0].values.RIDER_REFERENCES = [];
    expect(await service.list('client-a')).toEqual([]);
  });

  it.each([undefined, '', '  \n  ', 'x'.repeat(1001)])('requires a valid rejection reason', async (reason) => {
    const { service, prisma } = setup();
    await expect(service.review('client-a', 'manager-1', 'reference', 'REJECTED', reason)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only accepts one review and returns a conflict for concurrent/duplicate decisions', async () => {
    const { service, prisma } = setup();
    const [reference] = await service.list('client-a');
    await service.review('client-a', 'manager-1', reference.id, 'APPROVED');
    await expect(service.review('client-a', 'manager-2', reference.id, 'REJECTED', 'Not known')).rejects.toBeInstanceOf(ConflictException);
    prisma.riderReferenceReview.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Concurrent', { code: 'P2034', clientVersion: '6' }));
    await expect(service.review('client-a', 'manager-2', reference.id, 'APPROVED')).rejects.toBeInstanceOf(ConflictException);
  });

  it('supports status/search/owner filters and missing riders', async () => {
    const { service, prisma } = setup();
    expect(await service.list('client-a', { search: 'sister', status: 'PENDING', userId: 'user-1' })).toHaveLength(1);
    expect(prisma.riderOnboardingProgress.findMany.mock.calls[0][0].where.userId).toBe('user-1');
    expect(await service.list('client-a', { status: 'APPROVED' })).toEqual([]);
    await expect(service.forRider('client-a', 'other-rider')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses configured fields and keeps source identities across completion', async () => {
    const { service, configuration, progresses, riders } = setup();
    configuration.getEffectiveConfiguration.mockResolvedValue({ onboarding: { steps: [{ fields: [
      { featureCode: 'CAPTURE_REFERENCE', fieldCode: 'CONTACTS', storageKey: 'metadata.contacts', fieldType: 'REFERENCE' },
    ] }] } } as never);
    progresses[0].values = { CONTACTS: [contact] };
    const [before] = await service.list('client-a');
    riders.push({ id: 'rider-1', userId: 'user-1', name: 'Aman', mobile: '+919876543212', metadata: { contacts: [contact] }, createdAt: new Date() });
    progresses.length = 0;
    expect((await service.list('client-a'))[0].id).toBe(before.id);
  });
});
