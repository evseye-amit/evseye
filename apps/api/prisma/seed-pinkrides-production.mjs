import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { clientSeed } from './client/pinkrides/client.mjs';
import {
  controllers,
  fleets,
  fleetComponentMappings,
} from './client/pinkrides/fleets.mjs';
import { hubCatalog } from './client/pinkrides/hubs.mjs';
import { createPrismaClient } from './prisma-client.mjs';

async function seedPinkridesBranding(prisma, client, bucket) {
  if (client.branding?.logoObjectKey) return;

  const existingKey = client.businessProfile?.logoObjectKey;
  const logoObjectKey = existingKey ?? `clients/${client.id}/logo/seed.png`;
  if (!existingKey) {
    const endpoint = process.env.S3_ENDPOINT;
    const storage = new S3Client({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    try {
      await storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: logoObjectKey,
          Body: await readFile(
            new URL('./client/pinkrides/assets/logo.png', import.meta.url),
          ),
          ContentType: 'image/png',
          CacheControl: 'public, max-age=86400',
        }),
      );
    } finally {
      storage.destroy();
    }
  }

  await prisma.clientBranding.upsert({
    where: { clientId: client.id },
    create: { clientId: client.id, logoObjectKey },
    update: { logoObjectKey },
  });
}

async function seedPinkridesInventory(prisma, clientId) {
  // Resolve the platform catalog entries before creating any inventory.
  const [oem, category, vehicleType] = await Promise.all([
    prisma.oem.findUniqueOrThrow({ where: { code: 'ESPRINTO' } }),
    prisma.vehicleCategory.findUniqueOrThrow({ where: { code: '2W' } }),
    prisma.vehicleType.findUniqueOrThrow({
      where: { code: 'SCOOTER_ELECTRIC' },
    }),
  ]);

  await prisma.$transaction(async (tx) => {
    const hubs = new Map();
    for (const hub of hubCatalog) {
      const record = await tx.hub.upsert({
        where: { clientId_code: { clientId, code: hub.code } },
        create: { ...hub, clientId },
        update: {},
      });
      hubs.set(hub.code, record.id);
    }

    for (const seed of fleets) {
      const {
        oemCode,
        vehicleCategoryCode,
        vehicleTypeCode,
        homeHubCode,
        currentHubCode,
        ...fleet
      } = seed;
      const existing = await tx.fleet.findUnique({
        where: { clientId_fleetCode: { clientId, fleetCode: fleet.fleetCode } },
        select: { id: true },
      });
      // Existing vehicles may have moved or had their controllers replaced.
      if (existing) continue;

      const mapping = fleetComponentMappings.find(
        (entry) => entry.fleetCode === fleet.fleetCode,
      );
      const controllerSeed = controllers.find(
        (entry) => entry.controllerNumber === mapping?.controllerNumber,
      );
      if (!controllerSeed)
        throw new Error(`Missing controller mapping for ${fleet.fleetCode}.`);

      const controller = await tx.controller.create({
        data: { ...controllerSeed, clientId, status: 'INSTALLED' },
      });
      await tx.fleet.create({
        data: {
          ...fleet,
          clientId,
          oemId: oem.id,
          vehicleCategoryId: category.id,
          vehicleTypeId: vehicleType.id,
          homeHubId: hubs.get(homeHubCode),
          currentHubId: hubs.get(currentHubCode),
          controllerHistory: {
            create: {
              controllerId: controller.id,
              installedAt: new Date('2026-10-01T00:00:00.000Z'),
            },
          },
        },
      });
    }
  });
}

const bucket = process.env.S3_BUCKET;
if (!bucket)
  throw new Error('S3_BUCKET is required for the Pinkrides production seed.');

const prisma = createPrismaClient();
try {
  const client = await prisma.client.upsert({
    where: { slug: clientSeed.client.slug },
    create: clientSeed.client,
    update: {},
    include: {
      businessProfile: { select: { logoObjectKey: true } },
      branding: { select: { logoObjectKey: true } },
    },
  });
  await seedPinkridesInventory(prisma, client.id);
  await seedPinkridesBranding(prisma, client, bucket);
  console.info(
    'Pinkrides client, branding, and launch inventory are configured.',
  );
} finally {
  await prisma.$disconnect();
}
