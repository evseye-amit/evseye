import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RiderReferenceReviewService } from '../../src/riders/rider-reference-review.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Rider reference PostgreSQL integration', () => {
  let db: PrismaService;
  let service: RiderReferenceReviewService;
  let clientA: string; let clientB: string; let managerA: string; let managerB: string; let userA: string; let riderA: string;
  const references = [{ name: 'Nisha', mobile: '9876543210', relation: 'Sister' }, { name: 'Vikram', mobile: '9876543211', relation: 'Friend' }];
  beforeAll(async () => {
    db = new PrismaService({ datasources: { db: { url: databaseUrl! } } });
    clientA = (await db.client.create({ data: { name: 'Reference Test A', slug: `reference-a-${randomUUID()}` } })).id;
    clientB = (await db.client.create({ data: { name: 'Reference Test B', slug: `reference-b-${randomUUID()}` } })).id;
    managerA = (await db.user.create({ data: { clientId: clientA, name: 'Manager A', mobile: '+919876543201', role: 'FLEET_MANAGER' } })).id;
    managerB = (await db.user.create({ data: { clientId: clientB, name: 'Manager B', mobile: '+919876543202', role: 'FLEET_MANAGER' } })).id;
    userA = (await db.user.create({ data: { clientId: clientA, name: 'Pending Rider', mobile: '+919876543203', role: 'RIDER' } })).id;
    await db.riderOnboardingProgress.create({ data: { clientId: clientA, userId: userA, packageId: 'reference-fixture', values: { FULL_NAME: 'Aman', RIDER_REFERENCES: references } } });
    const configuration = { getEffectiveConfiguration: async () => ({ onboarding: { steps: [{ fields: [
      { fieldCode: 'FULL_NAME', storageKey: 'name' },
      { featureCode: 'CAPTURE_REFERENCE', fieldCode: 'RIDER_REFERENCES', storageKey: 'metadata.references', fieldType: 'REFERENCE' },
    ] }] } }) };
    service = new RiderReferenceReviewService(db, configuration as never);
  });
  afterAll(async () => {
    if (!db) return;
    await db.riderReferenceReview.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.riderOnboardingProgress.deleteMany({ where: { clientId: clientA } });
    await db.rider.deleteMany({ where: { clientId: clientA } });
    await db.user.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await db.$disconnect();
  });
  it('finds existing onboarding references without backfilling rows', async () => {
    expect(await service.list(clientA)).toHaveLength(2);
    expect((await service.list(clientA))[0]).toMatchObject({ riderName: 'Aman', status: 'PENDING' });
    expect(await db.riderReferenceReview.count({ where: { clientId: clientA } })).toBe(0);
    expect(await service.list(clientB)).toEqual([]);
  });
  it('allows one concurrent review and preserves the decision after onboarding completion', async () => {
    const [reference] = await service.list(clientA);
    const results = await Promise.allSettled([
      service.review(clientA, managerA, reference.id, 'APPROVED'),
      service.review(clientA, managerA, reference.id, 'REJECTED', 'Not confirmed'),
    ]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(await db.riderReferenceReview.count({ where: { id: reference.id } })).toBe(1);
    riderA = (await db.rider.create({ data: { clientId: clientA, userId: userA, name: 'Aman', mobile: '+919876543203', metadata: { references } } })).id;
    const completed = await service.forRider(clientA, riderA);
    expect(completed).toHaveLength(2);
    expect(completed[0].id).toBe(reference.id);
    expect(completed[0].status).not.toBe('PENDING');
    await expect(service.forRider(clientB, riderA)).rejects.toThrow('Rider not found');
    await expect(service.review(clientB, managerB, reference.id, 'APPROVED')).rejects.toThrow('Current rider reference not found');
  });
  it('enforces reason and reviewer tenant constraints in PostgreSQL', async () => {
    const base = { clientId: clientA, ownerKey: `user:${userA}`, ...references[0], status: 'REJECTED' as const, reviewedById: managerA };
    for (const reason of [null, '', '   '])
      await expect(db.riderReferenceReview.create({ data: { ...base, id: randomUUID(), rejectionReason: reason } })).rejects.toThrow();
    await expect(db.riderReferenceReview.create({ data: { ...base, id: randomUUID(), rejectionReason: 'Not known', reviewedById: managerB } })).rejects.toThrow();
  });
  it('shows changed references as pending and refuses stale review IDs', async () => {
    const before = await service.forRider(clientA, riderA);
    await db.rider.update({ where: { id: riderA }, data: { metadata: { references: [{ ...references[0], relation: 'Cousin' }] } } });
    expect(await service.forRider(clientA, riderA)).toEqual([expect.objectContaining({ relation: 'Cousin', status: 'PENDING' })]);
    await expect(service.review(clientA, managerA, before[0].id, 'APPROVED')).rejects.toThrow('Current rider reference not found');
  });
});
