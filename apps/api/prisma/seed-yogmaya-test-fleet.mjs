import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const STAGING_RDS_HOST =
  'evseye-staging-postgres.cdygcccg659a.ap-south-1.rds.amazonaws.com';
const FLEET_CODES = Array.from(
  { length: 10 },
  (_, index) => `YOGQA261107${String(index + 1).padStart(2, '0')}`,
);
const METADATA_BATCH = 'yogmaya-fleet-20261107';

function validateStagingDatabaseUrl(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error('DATABASE_URL is required for the staging test-fleet seed.');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== STAGING_RDS_HOST ||
    url.pathname !== '/evseye' ||
    (url.port && url.port !== '5432')
  ) {
    throw new Error(
      `DATABASE_URL must target ${STAGING_RDS_HOST}/evseye on the default PostgreSQL port.`,
    );
  }

  const queryKeys = [...url.searchParams.keys()];
  if (
    queryKeys.some((key) => !['schema', 'sslmode'].includes(key)) ||
    new Set(queryKeys).size !== queryKeys.length
  ) {
    throw new Error(
      'DATABASE_URL may only use the schema and sslmode query keys.',
    );
  }
  return connectionString;
}

function isOwnedFixture(metadata) {
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      metadata.testFixture === true &&
      metadata.batch === METADATA_BATCH,
  );
}

export async function seedYogmayaTestFleet(prisma) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { slug: 'yogmaya', isActive: true },
      select: { id: true },
    });
    if (!client) throw new Error('Active Yogmaya client is required.');

    const [hub, oem, category, type] = await Promise.all([
      tx.hub.findFirst({
        where: {
          clientId: client.id,
          code: 'HUB-GGN-SEC-15',
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      }),
      tx.oem.findFirst({
        where: { code: 'ZELIO', status: 'ACTIVE' },
        select: { id: true },
      }),
      tx.vehicleCategory.findFirst({
        where: { code: '2W', status: 'ACTIVE' },
        select: { id: true },
      }),
      tx.vehicleType.findFirst({
        where: { code: 'SCOOTER_ELECTRIC', status: 'ACTIVE' },
        select: { id: true, categoryId: true },
      }),
    ]);
    if (!hub || !oem || !category || !type) {
      throw new Error(
        'Active HUB-GGN-SEC-15, ZELIO, 2W, and SCOOTER_ELECTRIC records are required.',
      );
    }
    if (type.categoryId !== category.id) {
      throw new Error('SCOOTER_ELECTRIC is not assigned to 2W.');
    }

    const now = new Date();
    const fixtures = FLEET_CODES.map((fleetCode) => ({
      clientId: client.id,
      fleetCode,
      vehicleNumber: fleetCode,
      chassisNumber: `CH${fleetCode}`,
      oemId: oem.id,
      vehicleCategoryId: category.id,
      vehicleTypeId: type.id,
      homeHubId: hub.id,
      currentHubId: hub.id,
      speedType: 'SLOW_SPEED',
      ownershipType: 'OEM_OWNED',
      modelName: 'QA Test Scooter',
      colour: 'White',
      status: 'AVAILABLE',
      onboardingStatus: 'ACTIVE',
      readinessWorkflow: 'SIMPLE',
      allocationEnabled: true,
      onboardedAt: now,
      activatedAt: now,
      metadata: { testFixture: true, batch: METADATA_BATCH },
    }));

    const existing = await tx.fleet.findMany({
      where: { clientId: client.id, fleetCode: { in: FLEET_CODES } },
      select: { fleetCode: true, metadata: true, deletedAt: true },
    });
    const existingByCode = new Map(
      existing.map((fleet) => [fleet.fleetCode, fleet]),
    );
    const missing = [];
    for (const fixture of fixtures) {
      const current = existingByCode.get(fixture.fleetCode);
      if (!current) {
        missing.push(fixture);
      } else if (current.deletedAt || !isOwnedFixture(current.metadata)) {
        throw new Error(
          `Fleet ${fixture.fleetCode} conflict: existing row is ${current.deletedAt ? 'deleted' : 'not this fixture'}.`,
        );
      }
    }

    if (missing.length) {
      const result = await tx.fleet.createMany({ data: missing });
      if (result.count !== missing.length) {
        throw new Error(
          `Expected ${missing.length} new QA fleets, created ${result.count}.`,
        );
      }
    }
    return { created: missing.length, preserved: existing.length };
  });
}

async function main() {
  if (process.env.SEED_YOGMAYA_TEST_FLEET !== '1') {
    throw new Error(
      'Refusing to run without SEED_YOGMAYA_TEST_FLEET=1.',
    );
  }
  const databaseUrl = validateStagingDatabaseUrl(process.env.DATABASE_URL);
  const { createPrismaClient } = await import('./prisma-client.mjs');
  const prisma = createPrismaClient(databaseUrl);
  try {
    const result = await seedYogmayaTestFleet(prisma);
    console.log(
      `Yogmaya QA fleet seed complete: ${result.created} created, ${result.preserved} preserved (${METADATA_BATCH}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
