import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Fleet = {
  fleetCode: string;
  status?: string;
  deletedAt?: Date;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};
type SeedResult = { created: number; preserved: number };
type SeedModule = {
  seedYogmayaTestFleet(prisma: unknown): Promise<SeedResult>;
};

const seedModule = (await import(
  new URL('../../prisma/seed-yogmaya-test-fleet.mjs', import.meta.url).href
)) as unknown as SeedModule;
const { seedYogmayaTestFleet } = seedModule;

const stagingHost =
  'evseye-staging-postgres.cdygcccg659a.ap-south-1.rds.amazonaws.com';
const stagingUrl =
  `postgresql://seed:secret@${stagingHost}/evseye?schema=public&sslmode=require`;

function fakePrisma(initial: Fleet[] = []) {
  const fleets = new Map(
    initial.map((fleet) => [fleet.fleetCode, { ...fleet }]),
  );
  const calls = { createMany: 0 };
  const fake = {
    client: { findFirst: async () => ({ id: 'client-yogmaya' }) },
    hub: { findFirst: async () => ({ id: 'hub-sector-15' }) },
    oem: { findFirst: async () => ({ id: 'oem-zelio' }) },
    vehicleCategory: { findFirst: async () => ({ id: 'category-2w' }) },
    vehicleType: {
      findFirst: async () => ({ id: 'type-scooter', categoryId: 'category-2w' }),
    },
    fleet: {
      findMany: async () => [...fleets.values()],
      createMany: async ({ data }: { data: Fleet[] }) => {
        calls.createMany += 1;
        for (const row of data) fleets.set(row.fleetCode, { ...row });
        return { count: data.length };
      },
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(fake),
  };
  return { prisma: fake, fleets, calls };
}

describe('Yogmaya staging test fleet seed', () => {
  it('seeds ten synthetic scooters and reruns without resetting runtime state', async () => {
    const { prisma, fleets, calls } = fakePrisma();
    const first = await seedYogmayaTestFleet(prisma);
    const firstFleet = fleets.get('YOGQA26110701');
    if (!firstFleet) throw new Error('missing fixture');
    firstFleet.status = 'ALLOCATED';
    fleets.delete('YOGQA26110702');

    const second = await seedYogmayaTestFleet(prisma);

    expect(first).toEqual({ created: 10, preserved: 0 });
    expect(second).toEqual({ created: 1, preserved: 9 });
    expect(calls.createMany).toBe(2);
    expect(fleets).toHaveLength(10);
    expect(fleets.get('YOGQA26110701')?.status).toBe('ALLOCATED');
    for (const fleet of fleets.values()) {
      if (fleet.fleetCode !== 'YOGQA26110701') {
        expect(fleet.status).toBe('AVAILABLE');
      }
      expect(fleet.onboardingStatus).toBe('ACTIVE');
      expect(fleet.allocationEnabled).toBe(true);
      expect(fleet.homeHubId).toBe('hub-sector-15');
      expect(fleet.currentHubId).toBe('hub-sector-15');
      expect(fleet.oemId).toBe('oem-zelio');
      expect(fleet.vehicleCategoryId).toBe('category-2w');
      expect(fleet.vehicleTypeId).toBe('type-scooter');
      expect(fleet.metadata).toEqual({
        testFixture: true,
        batch: 'yogmaya-fleet-20261107',
      });
    }
  });

  it('refuses non-fixture and deleted rows before creating anything', async () => {
    for (const existing of [
      { fleetCode: 'YOGQA26110701', metadata: { testFixture: false } },
      {
        fleetCode: 'YOGQA26110701',
        deletedAt: new Date(),
        metadata: { testFixture: true, batch: 'yogmaya-fleet-20261107' },
      },
    ]) {
      const { prisma, calls } = fakePrisma([existing]);
      await expect(seedYogmayaTestFleet(prisma)).rejects.toThrow(/conflict/i);
      expect(calls.createMany).toBe(0);
    }
  });
});

describe('Yogmaya staging test fleet CLI guard', () => {
  it('is opt-in and rejects non-staging targets before Prisma import', () => {
    const script = fileURLToPath(
      new URL('../../prisma/seed-yogmaya-test-fleet.mjs', import.meta.url),
    );
    const withoutOptIn = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: stagingUrl },
      encoding: 'utf8',
    });
    expect(withoutOptIn.status).toBe(1);
    expect(withoutOptIn.stderr).toMatch(/SEED_YOGMAYA_TEST_FLEET/);
    expect(withoutOptIn.stderr).not.toMatch(/P1001/);

    const wrongTarget = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        SEED_YOGMAYA_TEST_FLEET: '1',
        DATABASE_URL: 'postgresql://seed:secret@127.0.0.1:5432/evseye',
      },
      encoding: 'utf8',
    });
    expect(wrongTarget.status).toBe(1);
    expect(wrongTarget.stderr).toMatch(/DATABASE_URL/);
    expect(wrongTarget.stderr).not.toMatch(/P1001/);
  });
});
