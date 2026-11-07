import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTestRiderFixtures,
  validateStagingDatabaseUrl,
} from '../../prisma/seed-yogmaya-test-riders.mjs';

describe('Yogmaya staging test rider seed', () => {
  it('builds ten fully onboarded synthetic rider fixtures from the active workflow', () => {
    const fixtures = buildTestRiderFixtures({
      clientId: 'client-yogmaya',
      packageId: 'package-basic',
      steps: [
        {
          stepId: 'profile',
          fields: [
            {
              fieldCode: 'MOBILE_NUMBER',
              storageKey: 'mobile',
              required: true,
              fieldType: 'MOBILE',
            },
            {
              fieldCode: 'FULL_NAME',
              storageKey: 'name',
              required: true,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'GENDER',
              storageKey: 'gender',
              required: true,
              fieldType: 'DROPDOWN',
            },
            {
              fieldCode: 'CURRENT_ADDRESS',
              storageKey: 'currentAddress',
              required: false,
              fieldType: 'TEXTAREA',
            },
            {
              fieldCode: 'SECURITY_DEPOSIT',
              storageKey: 'securityDeposit',
              required: true,
              editable: false,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'ONBOARDING_FEES',
              storageKey: 'onboardingFees',
              required: true,
              editable: false,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'RENTAL_PLAN',
              storageKey: 'rentalPlan',
              required: true,
              editable: false,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'BANK_ACCOUNT_NUMBER',
              storageKey: 'metadata.bankAccountNumber',
              required: true,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'REPEAT_BANK_ACCOUNT_NUMBER',
              storageKey: 'metadata.repeatBankAccountNumber',
              required: true,
              fieldType: 'TEXT',
            },
            {
              fieldCode: 'REFERENCES',
              storageKey: 'metadata.references',
              required: false,
              fieldType: 'LIST',
              minReferences: 1,
              maxReferences: 2,
            },
          ],
        },
      ],
      reviewerId: 'reviewer-1',
    });

    expect(fixtures).toHaveLength(10);
    expect(fixtures.map((fixture) => fixture.user.mobile)).toEqual([
      '+919700000001',
      '+919700000002',
      '+919700000003',
      '+919700000004',
      '+919700000005',
      '+919700000006',
      '+919700000007',
      '+919700000008',
      '+919700000009',
      '+919700000010',
    ]);
    expect(fixtures.every((fixture) => fixture.rider.status === 'ACTIVE')).toBe(
      true,
    );
    expect(
      fixtures.every((fixture) => fixture.rider.kycStatus === 'NOT_STARTED'),
    ).toBe(true);
    expect(
      fixtures.every(
        (fixture) => fixture.onboarding.completedAt instanceof Date,
      ),
    ).toBe(true);
    expect(
      fixtures.every((fixture) => fixture.references.status === 'APPROVED'),
    ).toBe(true);
    expect(
      fixtures.every((fixture) => fixture.rider.allocations === undefined),
    ).toBe(true);
  });

  it('rejects an unsupported required field instead of inventing a value', () => {
    expect(() =>
      buildTestRiderFixtures({
        clientId: 'client-yogmaya',
        packageId: 'package-basic',
        steps: [
          {
            stepId: 'profile',
            fields: [
              {
                fieldCode: 'UNKNOWN_REQUIRED',
                storageKey: 'unknown',
                required: true,
                fieldType: 'TEXT',
              },
            ],
          },
        ],
        reviewerId: 'reviewer-1',
      }),
    ).toThrow(/UNKNOWN_REQUIRED/);
  });
});

type FakeStore = {
  users: Map<string, Record<string, unknown>>;
  riders: Map<string, Record<string, unknown>>;
  allocations: Map<string, Record<string, unknown>>;
  progresses: Map<string, Record<string, unknown>>;
  reviews: Map<string, Record<string, unknown>>;
  calls: {
    userCreate: number;
    userUpdate: number;
    riderCreate: number;
    riderUpdate: number;
    transaction: number;
  };
};

function fakePrisma(existing?: {
  user: Record<string, unknown>;
  rider: Record<string, unknown>;
}) {
  const store: FakeStore = {
    users: new Map(),
    riders: new Map(),
    allocations: new Map(),
    progresses: new Map(),
    reviews: new Map(),
    calls: {
      userCreate: 0,
      userUpdate: 0,
      riderCreate: 0,
      riderUpdate: 0,
      transaction: 0,
    },
  };
  if (existing) {
    store.users.set(String(existing.user.mobile), existing.user);
    store.riders.set(String(existing.rider.mobile), existing.rider);
  }
  const features = [
    [
      'mobile',
      'CAPTURE_MOBILE_NUMBER',
      {
        fieldCode: 'MOBILE_NUMBER',
        storageKey: 'mobile',
        required: true,
        fieldType: 'MOBILE',
      },
    ],
    [
      'name',
      'CAPTURE_FULL_NAME',
      {
        fieldCode: 'FULL_NAME',
        storageKey: 'name',
        required: true,
        fieldType: 'TEXT',
      },
    ],
    [
      'gender',
      'CAPTURE_GENDER',
      {
        fieldCode: 'GENDER',
        storageKey: 'gender',
        required: true,
        fieldType: 'DROPDOWN',
      },
    ],
    ['bank', 'CAPTURE_BANK_ACCOUNT', { required: true }],
    [
      'repeat',
      'CAPTURE_REPEAT_BANK_ACCOUNT',
      {
        fieldCode: 'REPEAT_BANK_ACCOUNT_NUMBER',
        storageKey: 'metadata.repeatBankAccountNumber',
        required: true,
        fieldType: 'TEXT',
      },
    ],
    [
      'refs',
      'CAPTURE_REFERENCE',
      {
        fieldCode: 'REFERENCES',
        storageKey: 'metadata.references',
        fieldType: 'LIST',
        minReferences: 1,
        maxReferences: 2,
      },
    ],
    [
      'deposit',
      'SHOW_SECURITY_DEPOSIT',
      {
        fieldCode: 'SECURITY_DEPOSIT',
        storageKey: 'securityDeposit',
        required: true,
        editable: false,
        fieldType: 'TEXT',
      },
    ],
    [
      'fees',
      'SHOW_ON_BOARDING_FEES',
      {
        fieldCode: 'ONBOARDING_FEES',
        storageKey: 'onboardingFees',
        required: true,
        editable: false,
        fieldType: 'TEXT',
      },
    ],
    [
      'plan',
      'SHOW_PLAN_SELECTION',
      {
        fieldCode: 'RENTAL_PLAN',
        storageKey: 'rentalPlan',
        required: true,
        editable: false,
        fieldType: 'TEXT',
      },
    ],
  ].map(([id, code, configuration]) => ({
    featureId: id,
    feature: {
      id,
      code,
      category: 'RIDER_ONBOARDING',
      billingUnit: 'LIFE_TIME',
      isActive: true,
      configuration,
      step: { id: 'step-profile', code: 'PROFILE', order: 1 },
    },
  }));
  const snapshot = { id: 'package-basic', code: 'BASIC', features };
  const fake = {
    client: { findUnique: async () => ({ id: 'client-yogmaya' }) },
    user: {
      findFirst: async () => ({ id: 'reviewer-1' }),
      findUnique: async ({
        where,
      }: {
        where: { clientId_mobile: { mobile: string } };
      }) => store.users.get(where.clientId_mobile.mobile) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.calls.userCreate += 1;
        const row = { ...data, id: `user-${store.calls.userCreate}` };
        store.users.set(String(row.mobile), row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        store.calls.userUpdate += 1;
        const row = [...store.users.values()].find(
          (item) => item.id === where.id,
        );
        if (!row) throw new Error('missing user');
        Object.assign(row, data);
        return row;
      },
    },
    clientSubscription: {
      findFirst: async () => ({
        id: 'sub-1',
        packageId: 'package-basic',
        package: { code: 'BASIC' },
        packageRevision: {
          id: 'revision-1',
          snapshot,
          publishedAt: new Date(),
        },
      }),
    },
    clientWorkflowRevision: { findFirst: async () => null },
    packageRevision: { findFirst: async () => null },
    rider: {
      findUnique: async ({
        where,
      }: {
        where: {
          clientId_mobile?: { mobile: string };
          clientId_riderCode?: { riderCode: string };
        };
      }) => {
        if (where.clientId_riderCode) {
          return (
            [...store.riders.values()].find(
              (item) => item.riderCode === where.clientId_riderCode?.riderCode,
            ) ?? null
          );
        }
        return store.riders.get(where.clientId_mobile?.mobile ?? '') ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.calls.riderCreate += 1;
        const row = { ...data, id: `rider-${store.calls.riderCreate}` };
        store.riders.set(String(row.mobile), row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        store.calls.riderUpdate += 1;
        const row = [...store.riders.values()].find(
          (item) => item.id === where.id,
        );
        if (!row) throw new Error('missing rider');
        Object.assign(row, data);
        return row;
      },
    },
    riderOnboardingProgress: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const prior = store.progresses.get(where.userId);
        const row = prior ? Object.assign(prior, update) : { ...create };
        store.progresses.set(where.userId, row);
        return row;
      },
    },
    riderReferenceReview: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const prior = store.reviews.get(where.id);
        const row = prior ? Object.assign(prior, update) : { ...create };
        store.reviews.set(where.id, row);
        return row;
      },
    },
    allocation: {
      findFirst: async ({ where }: { where: { riderId: string } }) =>
        store.allocations.get(where.riderId) ?? null,
    },
    $transaction: async (callback: (tx: unknown) => unknown) => {
      store.calls.transaction += 1;
      return callback(fake);
    },
  };
  return { prisma: fake as never, store };
}

describe('Yogmaya staging test rider database seed', () => {
  it('is idempotent and does not create allocations', async () => {
    const { prisma, store } = fakePrisma();
    const { seedYogmayaTestRiders } =
      await import('../../prisma/seed-yogmaya-test-riders.mjs');
    const first = await seedYogmayaTestRiders(prisma);
    const firstRider = store.riders.get('+919700000001');
    if (!firstRider) throw new Error('missing first synthetic rider');
    firstRider.metadata = {
      ...(firstRider.metadata as Record<string, unknown>),
      rentalFixtureNote: 'preserve this used-rental metadata',
    };
    const second = await seedYogmayaTestRiders(prisma);

    expect(first).toHaveLength(10);
    expect(second).toEqual(first);
    expect(store.users).toHaveLength(10);
    expect(store.riders).toHaveLength(10);
    expect(store.progresses).toHaveLength(10);
    expect(store.reviews).toHaveLength(10);
    expect(store.calls.userCreate).toBe(10);
    expect(store.calls.riderCreate).toBe(10);
    expect(store.calls.userUpdate).toBe(0);
    expect(store.calls.riderUpdate).toBe(0);
    expect(store.calls.transaction).toBe(2);
    const preservedRider = store.riders.get('+919700000001');
    if (!preservedRider) throw new Error('missing preserved synthetic rider');
    const preservedMetadata = preservedRider.metadata;
    expect(
      preservedMetadata &&
        typeof preservedMetadata === 'object' &&
        !Array.isArray(preservedMetadata)
        ? (preservedMetadata as Record<string, unknown>).rentalFixtureNote
        : undefined,
    ).toBe('preserve this used-rental metadata');
  });

  it('refuses a mobile already owned by an unrelated rider', async () => {
    const user = {
      id: 'existing-user',
      clientId: 'client-yogmaya',
      mobile: '+919700000001',
      role: 'RIDER',
    };
    const rider = {
      id: 'existing-rider',
      clientId: 'client-yogmaya',
      userId: user.id,
      mobile: user.mobile,
      metadata: { testSeed: { key: 'OTHER_SEED', version: 1, index: 1 } },
    };
    const { prisma, store } = fakePrisma({ user, rider });
    const { seedYogmayaTestRiders } =
      await import('../../prisma/seed-yogmaya-test-riders.mjs');

    await expect(seedYogmayaTestRiders(prisma)).rejects.toThrow(
      /unrelated rider/,
    );
    expect(store.calls.userCreate).toBe(0);
    expect(store.calls.userUpdate).toBe(0);
    expect(store.calls.riderCreate).toBe(0);
    expect(store.calls.riderUpdate).toBe(0);
  });

  it('refuses a synthetic rider code already owned by an unrelated rider', async () => {
    const user = {
      id: 'existing-user',
      clientId: 'client-yogmaya',
      mobile: '+919711111111',
      role: 'RIDER',
    };
    const rider = {
      id: 'existing-rider',
      clientId: 'client-yogmaya',
      userId: user.id,
      mobile: user.mobile,
      riderCode: 'YOGMAYA-STAGING-TEST-01',
      metadata: { testSeed: { key: 'OTHER_SEED', version: 1, index: 1 } },
    };
    const { prisma, store } = fakePrisma({ user, rider });
    const { seedYogmayaTestRiders } =
      await import('../../prisma/seed-yogmaya-test-riders.mjs');

    await expect(seedYogmayaTestRiders(prisma)).rejects.toThrow(
      /rider code belongs to an unrelated rider/,
    );
    expect(store.calls.userCreate).toBe(0);
    expect(store.calls.userUpdate).toBe(0);
    expect(store.calls.riderCreate).toBe(0);
    expect(store.calls.riderUpdate).toBe(0);
  });

  it('refuses to rerun an owned rider with an unfinished allocation', async () => {
    const { prisma, store } = fakePrisma();
    const { seedYogmayaTestRiders } =
      await import('../../prisma/seed-yogmaya-test-riders.mjs');
    await seedYogmayaTestRiders(prisma);
    store.allocations.set('rider-1', {
      id: 'allocation-1',
      status: 'ACTIVE',
    });

    await expect(seedYogmayaTestRiders(prisma)).rejects.toThrow(
      /unfinished allocation allocation-1 \(ACTIVE\)/,
    );
    expect(store.calls.userCreate).toBe(10);
    expect(store.calls.riderCreate).toBe(10);
    expect(store.calls.userUpdate).toBe(0);
    expect(store.calls.riderUpdate).toBe(0);
  });
});

describe('Yogmaya staging test rider seed entry-point guard', () => {
  const stagingUrl =
    'postgresql://seed:secret@evseye-staging-postgres.abc123.ap-south-1.rds.amazonaws.com/evseye?schema=public&sslmode=require';

  it.each([
    ['missing environment identity', stagingUrl, undefined],
    ['missing database URL', undefined, 'development'],
    ['malformed database URL', 'not-a-url', 'development'],
    [
      'localhost tunnel URL',
      'postgresql://seed:secret@127.0.0.1:5432/evseye',
      'development',
    ],
    [
      'connection target override query',
      'postgresql://seed:secret@evseye-staging-postgres.test.ap-south-1.rds.amazonaws.com/evseye?host=127.0.0.1&port=1&dbname=production',
      'development',
    ],
    [
      'production RDS URL',
      'postgresql://seed:secret@evseye-production-postgres.abc123.ap-south-1.rds.amazonaws.com/evseye',
      'development',
    ],
    ['production identity', stagingUrl, 'production'],
    ['test identity', stagingUrl, 'test'],
  ])('%s is rejected without network access', (_, url, nodeEnv) => {
    expect(() => validateStagingDatabaseUrl(url, nodeEnv)).toThrow();
  });

  it('accepts only the direct staging RDS URL and does not connect', () => {
    expect(validateStagingDatabaseUrl(stagingUrl, 'development')).toBe(
      stagingUrl,
    );
  });

  it.each([
    ['missing database URL', undefined, 'development'],
    ['malformed database URL', 'not-a-url', 'development'],
    [
      'localhost tunnel URL',
      'postgresql://seed:secret@127.0.0.1:1/evseye',
      'development',
    ],
    ['missing environment identity', stagingUrl, undefined],
    ['test environment identity', stagingUrl, 'test'],
    ['production environment identity', stagingUrl, 'production'],
  ])('%s stops before importing Prisma', (_, url, nodeEnv) => {
    const env = { ...process.env, SEED_YOGMAYA_TEST_RIDERS: '1' };
    if (url === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = url;
    if (nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = nodeEnv;
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'prisma/seed-yogmaya-test-riders.mjs')],
      { env, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('P1001');
  });
});
