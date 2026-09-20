import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, UserRole } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { oemCatalog } from './catalog/oems.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { featureStepSpecs } from './catalog/feature-steps.mjs';
import { packageCatalog } from './catalog/packages.mjs';
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
    packageCatalog.map((pkg) =>
      prisma.package.upsert({
        where: { code: pkg.code },
        create: pkg,
        update: pkg,
      }),
    ),
  );

  const sms = await prisma.feature.findUniqueOrThrow({
    where: { code: 'SMS_LOGIN_OTP' },
  });
  const effectiveFrom = new Date('2026-01-01');
  await prisma.featurePricing.deleteMany({ where: { featureId: sms.id } });
  await prisma.featurePricing.create({ data: { featureId: sms.id, billingUnit: 'SMS', costPrice: 0.2, salePrice: 0.5, currency: 'INR', effectiveFrom, isActive: true } });
  const packages = await prisma.package.findMany({ where: { code: { in: ['BASIC', 'STANDARD', 'PREMIUM'] } } });
  const packageByCode = new Map(packages.map((pkg) => [pkg.code, pkg]));
  const tiers = { BASIC: [[1, 99, 249], [100, 249, 219], [500, null, 199]], STANDARD: [[1, 99, 299], [100, 249, 269], [500, null, 249]], PREMIUM: [[1, 99, 449], [100, 249, 429], [500, null, 399]] };
  for (const [code, rows] of Object.entries(tiers)) {
    const pkg = packageByCode.get(code);
    if (!pkg) continue;
    for (const [minVehicles, maxVehicles, pricePerVehicle] of rows) {
      await prisma.packageVehicleTierPricing.upsert({ where: { packageId_minVehicles_effectiveFrom: { packageId: pkg.id, minVehicles, effectiveFrom } }, create: { packageId: pkg.id, minVehicles, maxVehicles, pricePerVehicle, effectiveFrom, currency: 'INR', billingPeriod: 'MONTHLY', tierMode: 'VOLUME' }, update: { maxVehicles, pricePerVehicle, isActive: true } });
    }
  }
  const basic = packageByCode.get('BASIC');
  if (basic) await prisma.packageFeature.upsert({ where: { packageId_featureId: { packageId: basic.id, featureId: sms.id } }, create: { packageId: basic.id, featureId: sms.id, isIncluded: true, includedQuantity: 1200, resetPeriod: 'MONTHLY', isUnlimited: false }, update: { isIncluded: true, includedQuantity: 1200, resetPeriod: 'MONTHLY', isUnlimited: false } });
  const addOnSpecs = [['SMS_1000_60D', 'SMS 1000', 1000, 500, 60], ['SMS_2000_90D', 'SMS 2000', 2000, 900, 90], ['SMS_5000', 'SMS 5000', 5000, 2000, null]];
  const addOns = new Map();
  for (const [code, name, quantity, salePrice, validityDays] of addOnSpecs) {
    const addOn = await prisma.featureAddOn.upsert({ where: { code }, create: { code, name, featureId: sms.id, quantity, salePrice, currency: 'INR', validityDays, effectiveFrom }, update: { name, quantity, salePrice, validityDays, isActive: true } }); addOns.set(code, addOn);
  }
  if (basic) for (const code of ['SMS_1000_60D', 'SMS_2000_90D']) { const addOn = addOns.get(code); await prisma.packageFeatureAddOn.upsert({ where: { packageId_featureAddOnId: { packageId: basic.id, featureAddOnId: addOn.id } }, create: { packageId: basic.id, featureAddOnId: addOn.id, isAvailable: true }, update: { isAvailable: true } }); }
  const standard = packageByCode.get('STANDARD'); const sms5000 = addOns.get('SMS_5000');
  if (standard && sms5000) await prisma.packageFeatureAddOn.upsert({ where: { packageId_featureAddOnId: { packageId: standard.id, featureAddOnId: sms5000.id } }, create: { packageId: standard.id, featureAddOnId: sms5000.id, isAvailable: true }, update: { isAvailable: true } });

  console.info('Seeded platform master data and Super Admin account.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
