import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, UserRole } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { oemCatalog } from './catalog/oems.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { featureAddOnCatalog } from './catalog/feature-addons.mjs';
import { featurePricingCatalog } from './catalog/feature-pricing.mjs';
import { packageFeatureAddOnCatalog } from './catalog/package-feature-addons.mjs';
import { packageFeatureCatalog } from './catalog/package-features.mjs';
import { featureStepSpecs } from './catalog/feature-steps.mjs';
import { packageCatalog } from './catalog/packages.mjs';
import { packageVehicleTierPricingCatalog } from './catalog/package-vehicle-tier-pricing.mjs';
import { vehicleCategoryCatalog } from './catalog/vehicle-categories.mjs';
import { vehicleTypeCatalog } from './catalog/vehicle-types.mjs';

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

  const featureSteps = new Map();
  for (const step of featureStepSpecs.filter((item) => !item.parentCode)) {
    const { parentCode: _parentCode, ...stepData } = step;
    const saved = await prisma.featureStep.upsert({
      where: { code: step.code },
      create: stepData,
      update: { displayName: step.displayName, description: step.description, displayOrder: step.displayOrder, isActive: true },
    });
    featureSteps.set(step.code, saved);
  }
  for (const step of featureStepSpecs.filter((item) => item.parentCode)) {
    const { parentCode, ...stepData } = step;
    const saved = await prisma.featureStep.upsert({
      where: { code: step.code },
      create: { ...stepData, parentId: featureSteps.get(parentCode).id },
      update: { displayName: step.displayName, parentId: featureSteps.get(parentCode).id, displayOrder: step.displayOrder, isActive: true },
    });
    featureSteps.set(step.code, saved);
  }
  await Promise.all(
    featureCatalog.map(({ featureStepCode, ...feature }) => {
      const featureStep = featureSteps.get(featureStepCode);
      if (!featureStep) {
        throw new Error(
          `Feature seed references missing Feature Step code: ${featureStepCode}`,
        );
      }
      return prisma.feature.upsert({
        where: { code: feature.code },
        create: { ...feature, featureStepId: featureStep.id },
        update: { ...feature, featureStepId: featureStep.id },
      });
    }),
  );

  await Promise.all(
    featurePricingCatalog.map(async ({ featureCode, effectiveFrom, ...pricing }) => {
      const feature = await prisma.feature.findUniqueOrThrow({
        where: { code: featureCode },
      });
      const effectiveDate = new Date(effectiveFrom);
      const existing = await prisma.featurePricing.findFirst({
        where: { featureId: feature.id, effectiveFrom: effectiveDate },
      });
      if (existing) {
        return prisma.featurePricing.update({
          where: { id: existing.id },
          data: pricing,
        });
      }
      return prisma.featurePricing.create({
        data: { ...pricing, featureId: feature.id, effectiveFrom: effectiveDate },
      });
    }),
  );

  await Promise.all(
    packageCatalog.map((pkg) =>
      prisma.package.upsert({
        where: { code: pkg.code },
        create: pkg,
        update: pkg,
      }),
    ),
  );

  const packages = await prisma.package.findMany({ where: { code: { in: packageCatalog.map((item) => item.code) } } });
  const packageByCode = new Map(packages.map((pkg) => [pkg.code, pkg]));

  for (const {
    packageCode,
    effectiveFrom,
    effectiveTo,
    ...tierData
  } of packageVehicleTierPricingCatalog) {
    const pkg = packageByCode.get(packageCode);
    if (!pkg) {
      throw new Error(
        `Package Vehicle Tier Pricing seed references a missing Package code: ${packageCode}`,
      );
    }

    const effectiveDate = new Date(effectiveFrom);
    await prisma.packageVehicleTierPricing.upsert({
      where: {
        packageId_minVehicles_effectiveFrom: {
          packageId: pkg.id,
          minVehicles: tierData.minVehicles,
          effectiveFrom: effectiveDate,
        },
      },
      create: {
        packageId: pkg.id,
        ...tierData,
        effectiveFrom: effectiveDate,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
      update: {
        ...tierData,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
    });
  }

  for (const { packageCode, featureCode, configuration, ...packageFeature } of packageFeatureCatalog) {
    const pkg = packageByCode.get(packageCode);
    const feature = await prisma.feature.findUniqueOrThrow({ where: { code: featureCode } });
    if (!pkg) throw new Error(`Package Feature seed references a missing Package code: ${packageCode}`);
    const data = { ...packageFeature, ...(configuration === null ? {} : { configuration }) };
    await prisma.packageFeature.upsert({
      where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } },
      create: { packageId: pkg.id, featureId: feature.id, ...data },
      update: data,
    });
  }
  for (const { featureCode, effectiveFrom: addOnEffectiveFrom, effectiveTo, ...addOnData } of featureAddOnCatalog) {
    const feature = await prisma.feature.findUniqueOrThrow({ where: { code: featureCode } });
    await prisma.featureAddOn.upsert({
      where: { code: addOnData.code },
      create: { ...addOnData, featureId: feature.id, effectiveFrom: new Date(addOnEffectiveFrom), effectiveTo: effectiveTo ? new Date(effectiveTo) : null },
      update: { ...addOnData, featureId: feature.id, effectiveFrom: new Date(addOnEffectiveFrom), effectiveTo: effectiveTo ? new Date(effectiveTo) : null },
    });
  }

  for (const { packageCode, featureAddOnCode, isAvailable } of packageFeatureAddOnCatalog) {
    const pkg = packageByCode.get(packageCode);
    const featureAddOn = await prisma.featureAddOn.findUnique({
      where: { code: featureAddOnCode },
    });
    if (!pkg || !featureAddOn) {
      throw new Error(
        `Package Add-On seed references a missing ${!pkg ? 'Package' : 'Feature Add-On'}: ${!pkg ? packageCode : featureAddOnCode}`,
      );
    }
    await prisma.packageFeatureAddOn.upsert({
      where: {
        packageId_featureAddOnId: {
          packageId: pkg.id,
          featureAddOnId: featureAddOn.id,
        },
      },
      create: { packageId: pkg.id, featureAddOnId: featureAddOn.id, isAvailable },
      update: { isAvailable },
    });
  }

  console.info('Seeded platform master data and Super Admin account.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
