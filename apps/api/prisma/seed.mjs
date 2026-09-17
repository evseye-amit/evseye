import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, UserRole } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { oemCatalog } from './catalog/oems.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { packageCatalog } from './catalog/packages.mjs';
import { vehicleCategoryCatalog } from './catalog/vehicle-categories.mjs';
import { vehicleTypeCatalog } from './catalog/vehicle-types.mjs';
import {
  featurePricingCatalog,
  featurePricingTierCatalog,
} from './catalog/feature-pricing-tier.mjs';

const prisma = new PrismaClient();

const storage = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

async function seedOemLogo(id, code) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required to seed OEM logos.');
  let extension = 'png';
  let image;
  try {
    image = await readFile(
      new URL(`./catalog/assets/oem/${code}.png`, import.meta.url),
    );
  } catch {
    extension = 'svg';
    image = await readFile(
      new URL(`./catalog/assets/oem/${code}.svg`, import.meta.url),
    );
  }
  const objectKey = `platform/oems/${id}/logo/seed.${extension}`;
  await storage.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: image,
      ContentType: extension === 'svg' ? 'image/svg+xml' : 'image/png',
    }),
  );
  return objectKey;
}

async function main() {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { clientId: null, mobile: '+919100000000' },
  });
  if (existingSuperAdmin) {
    await prisma.user.update({
      where: { id: existingSuperAdmin.id },
      data: {
        name: 'EVs Eye Super Admin',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        mobile: '+919100000000',
        name: 'EVs Eye Super Admin',
        role: UserRole.SUPER_ADMIN,
      },
    });
  }

  await prisma.oem.upsert({
    where: { code: 'EVSEYE' },
    create: {
      code: 'EVSEYE',
      name: 'EVs Eye Mobility Systems',
      displayName: 'EVs Eye',
      status: 'ACTIVE',
      description: 'Platform sample OEM record.',
    },
    update: {
      name: 'EVs Eye Mobility Systems',
      displayName: 'EVs Eye',
      status: 'ACTIVE',
    },
  });

  await Promise.all(
    oemCatalog.map(async ({ logoSourceUrl: _logoSourceUrl, ...oem }) => {
      const existing = await prisma.oem.findUnique({
        where: { code: oem.code },
        select: { id: true, logoObjectKey: true },
      });
      const id = existing?.id ?? crypto.randomUUID();
      const logoObjectKey = await seedOemLogo(id, oem.code);
      return prisma.oem.upsert({
        where: { code: oem.code },
        create: { id, ...oem, logoObjectKey },
        update: { ...oem, logoObjectKey },
      });
    }),
  );

  const vehicleCategories = await Promise.all(
    vehicleCategoryCatalog.map((vehicleCategory) =>
      prisma.vehicleCategory.upsert({
        where: { code: vehicleCategory.code },
        create: vehicleCategory,
        update: vehicleCategory,
      }),
    ),
  );

  const vehicleCategoryIdsByCode = new Map(
    vehicleCategories.map(({ code, id }) => [code, id]),
  );
  await Promise.all(
    vehicleTypeCatalog.map(({ categoryCode, ...vehicleType }) => {
      const categoryId = vehicleCategoryIdsByCode.get(categoryCode);
      if (!categoryId) {
        throw new Error(
          `Vehicle type seed references missing category code: ${categoryCode}`,
        );
      }

      return prisma.vehicleType.upsert({
        where: { code: vehicleType.code },
        create: { ...vehicleType, categoryId },
        update: { ...vehicleType, categoryId },
      });
    }),
  );

  await Promise.all(
    featureCatalog.map((feature) =>
      prisma.feature.upsert({
        where: { code: feature.code },
        create: { ...feature, isActive: true },
        update: { ...feature, isActive: true },
      }),
    ),
  );
  for (const pricing of featurePricingCatalog) {
    const feature = await prisma.feature.findUnique({
      where: { code: pricing.featureCode },
      select: { id: true },
    });
    if (!feature) {
      throw new Error(`Feature pricing catalog references unknown feature code: ${pricing.featureCode}`);
    }
    const { featureCode, sourceFeatureId, id, ...data } = pricing;
    await prisma.featurePricing.upsert({
      where: { id: id ?? sourceFeatureId },
      create: { id: id ?? sourceFeatureId, ...data, featureId: feature.id },
      update: { ...data, featureId: feature.id },
    });
  }
  for (const tier of featurePricingTierCatalog) {
    await prisma.featurePricingTier.upsert({
      where: {
        featurePricingId_tierOrder: {
          featurePricingId: tier.featurePricingId,
          tierOrder: tier.tierOrder,
        },
      },
      create: tier,
      update: tier,
    });
  }
  await Promise.all(
    packageCatalog.map((pkg) =>
      prisma.package.upsert({
        where: { code: pkg.code },
        create: pkg,
        update: pkg,
      }),
    ),
  );

  console.info('Seeded platform master data and Super Admin account.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
