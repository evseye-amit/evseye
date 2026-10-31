import { createPrismaClient } from './prisma-client.mjs';
import { oemCatalog } from './catalog/oems.mjs';
import { vehicleCategoryCatalog } from './catalog/vehicle-categories.mjs';
import { vehicleTypeCatalog } from './catalog/vehicle-types.mjs';
import { packageCatalog } from './catalog/packages.mjs';
import { packageVehicleTierPricingCatalog } from './catalog/package-vehicle-tier-pricing.mjs';
import { seedSpareMasters } from './catalog/spares.mjs';
import { seedWorkPartnerMasters } from './catalog/work-partners.mjs';
import { seedLegalTemplates } from './catalog/legal-templates.mjs';
import { seedFeatures } from './seed-features.mjs';

export async function seedMasterData(prisma) {
  for (const oem of oemCatalog) {
    await prisma.oem.upsert({ where: { code: oem.code }, create: oem, update: oem });
  }
  const categories = new Map();
  for (const category of vehicleCategoryCatalog) {
    const saved = await prisma.vehicleCategory.upsert({ where: { code: category.code }, create: category, update: category });
    categories.set(saved.code, saved.id);
  }
  for (const { categoryCode, ...type } of vehicleTypeCatalog) {
    const categoryId = categories.get(categoryCode);
    if (!categoryId) throw new Error(`Missing vehicle category ${categoryCode}.`);
    await prisma.vehicleType.upsert({ where: { code: type.code }, create: { ...type, categoryId }, update: { ...type, categoryId } });
  }
  for (const pkg of packageCatalog) {
    await prisma.package.upsert({ where: { code: pkg.code }, create: pkg, update: pkg });
  }
  for (const { packageCode, effectiveFrom, effectiveTo, ...tier } of packageVehicleTierPricingCatalog) {
    const pkg = await prisma.package.findUniqueOrThrow({
      where: { code: packageCode },
      select: { id: true },
    });
    const startsAt = new Date(`${effectiveFrom}T00:00:00.000Z`);
    await prisma.packageVehicleTierPricing.upsert({
      where: {
        packageId_minVehicles_effectiveFrom: {
          packageId: pkg.id,
          minVehicles: tier.minVehicles,
          effectiveFrom: startsAt,
        },
      },
      create: {
        ...tier,
        packageId: pkg.id,
        effectiveFrom: startsAt,
        effectiveTo: effectiveTo ? new Date(`${effectiveTo}T00:00:00.000Z`) : null,
      },
      update: {
        ...tier,
        effectiveTo: effectiveTo ? new Date(`${effectiveTo}T00:00:00.000Z`) : null,
      },
    });
  }

  // This script is intentionally ordered: Feature Steps, Features, Pricing,
  // and Package Features depend on the packages created above.
  await seedFeatures(prisma);
  await seedSpareMasters(prisma);
  await seedWorkPartnerMasters(prisma);
  await seedLegalTemplates(prisma);
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const prisma = createPrismaClient();
  seedMasterData(prisma)
    .then(() => console.info('Seeded master data: vehicle catalog, OEMs, spares, features, pricing, packages, work partners, and legal documents.'))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(async () => prisma.$disconnect());
}
