import { PhotoEntityType, PrismaClient, UserRole } from '@prisma/client';
import { oemCatalog } from './catalog/oems.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { packageCatalog } from './catalog/packages.mjs';
import { vehicleCategoryCatalog } from './catalog/vehicle-categories.mjs';
import { vehicleTypeCatalog } from './catalog/vehicle-types.mjs';
import { featurePricingCatalog } from './catalog/feature-pricing.mjs';

const prisma = new PrismaClient();

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
    oemCatalog.map((oem) =>
      prisma.oem.upsert({
        where: { code: oem.code },
        create: oem,
        update: oem,
      }),
    ),
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
    const { featureCode, sourceFeatureId, ...data } = pricing;
    const existing = await prisma.featurePricing.findFirst({
      where: {
        featureId: feature.id,
        pricingModel: data.pricingModel,
        billingUnit: data.billingUnit,
        effectiveFrom: data.effectiveFrom,
      },
    });
    if (existing) {
      await prisma.featurePricing.update({ where: { id: existing.id }, data });
    } else {
      await prisma.featurePricing.create({ data: { ...data, featureId: feature.id } });
    }
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

  const client = await prisma.client.upsert({
    where: { slug: 'demo' },
    update: { name: 'EVs Eye Demo', companyCode: 'demo', status: 'ACTIVE', isActive: true },
    create: { slug: 'demo', companyCode: 'demo', name: 'EVs Eye Demo', status: 'ACTIVE' },
  });

  await prisma.user.upsert({
    where: {
      clientId_mobile: { clientId: client.id, mobile: '+919000000000' },
    },
    update: {
      name: 'Demo Client Admin',
      role: UserRole.CLIENT_ADMIN,
      isActive: true,
    },
    create: {
      clientId: client.id,
      mobile: '+919000000000',
      name: 'Demo Client Admin',
      role: UserRole.CLIENT_ADMIN,
    },
  });

  const inspectionPhotoTypes = [
    'FRONT',
    'REAR',
    'LEFT',
    'RIGHT',
    'ODOMETER',
    'BATTERY',
    'CONTROLLER',
    'TYRES',
    'BRAKES',
    'LIGHTS',
    'CHARGER',
    'KEYS',
  ];
  const fleetPhotoTypes = ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD'];
  const batteryPhotoTypes = ['FRONT', 'REAR', 'LABEL', 'CONNECTOR'];
  const controllerPhotoTypes = ['FRONT', 'LABEL'];
  const requirements = [
    { entityType: PhotoEntityType.RIDER, photoType: 'PROFILE' },
    ...fleetPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.FLEET,
      photoType,
    })),
    ...batteryPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.BATTERY,
      photoType,
    })),
    ...controllerPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.CONTROLLER,
      photoType,
    })),
    ...inspectionPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.INSPECTION,
      photoType,
    })),
  ];

  await Promise.all(
    requirements.map(({ entityType, photoType }, sortOrder) =>
      prisma.photoRequirement.upsert({
        where: {
          clientId_entityType_photoType: {
            clientId: client.id,
            entityType,
            photoType,
          },
        },
        create: {
          clientId: client.id,
          entityType,
          photoType,
          isRequired: true,
          sortOrder,
        },
        update: {},
      }),
    ),
  );

  console.info(
    'Seeded platform super admin, client "demo", administrator, and photo requirements.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
