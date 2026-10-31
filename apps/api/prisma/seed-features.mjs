import { createPrismaClient } from './prisma-client.mjs';
import { featureStepSpecs } from './catalog/feature-steps.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { featurePricingCatalog } from './catalog/feature-pricing.mjs';
import { packageFeatureCatalog } from './catalog/package-features.mjs';
import { seedInitialRevisions } from './catalog/seed-revisions.mjs';

export async function seedFeatures(prisma) {
  const steps = new Map();
  for (const step of [
    ...featureStepSpecs.filter((item) => !item.parentCode),
    ...featureStepSpecs.filter((item) => item.parentCode),
  ]) {
    const { code, parentCode, ...data } = step;
    const parentId = parentCode ? steps.get(parentCode)?.id : null;
    if (parentCode && !parentId) {
      throw new Error(`Missing parent Feature Step ${parentCode}`);
    }
    const saved = await prisma.featureStep.upsert({
      where: { code },
      create: { code, ...data, parentId },
      update: { ...data, parentId },
    });
    steps.set(code, saved);
  }

  for (const { featureStepCode, ...feature } of featureCatalog) {
    const featureStepId = featureStepCode ? steps.get(featureStepCode)?.id : null;
    if (featureStepCode && !featureStepId) {
      throw new Error(`Missing Feature Step ${featureStepCode} for ${feature.code}`);
    }
    const existing = await prisma.feature.findUnique({
      where: { code: feature.code },
      select: { translations: true },
    });
    await prisma.feature.upsert({
      where: { code: feature.code },
      create: { ...feature, featureStepId },
      update: {
        ...feature,
        ...(existing?.translations ? { translations: existing.translations } : {}),
        featureStepId,
      },
    });
  }

  for (const {
    featureCode,
    effectiveFrom,
    effectiveTo,
    billingUnit,
    currency,
    isActive,
    ...pricing
  } of featurePricingCatalog) {
    const feature = await prisma.feature.findUniqueOrThrow({
      where: { code: featureCode },
      select: { id: true },
    });
    const from = new Date(effectiveFrom);
    const to = effectiveTo ? new Date(effectiveTo) : null;
    const existing = await prisma.featurePricing.findFirst({
      where: {
        featureId: feature.id,
        effectiveFrom: from,
        effectiveTo: to,
        billingUnit,
        currency,
        isActive,
      },
      select: { id: true },
    });
    const data = { ...pricing, billingUnit, currency, isActive, effectiveTo: to };
    if (existing) {
      await prisma.featurePricing.update({ where: { id: existing.id }, data });
    } else {
      await prisma.featurePricing.create({
        data: { ...data, featureId: feature.id, effectiveFrom: from },
      });
    }
  }

  for (const { packageCode, featureCode, configuration, ...assignment } of packageFeatureCatalog) {
    const [pkg, feature] = await Promise.all([
      prisma.package.findUniqueOrThrow({
        where: { code: packageCode },
        select: { id: true },
      }),
      prisma.feature.findUniqueOrThrow({
        where: { code: featureCode },
        select: { id: true },
      }),
    ]);
    const data = {
      ...assignment,
      ...(configuration === null ? {} : { configuration }),
    };
    await prisma.packageFeature.upsert({
      where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } },
      create: { packageId: pkg.id, featureId: feature.id, ...data },
      update: data,
    });
  }

  await seedInitialRevisions(prisma);
  console.info(
    `Seeded ${featureStepSpecs.length} Feature Steps, ${featureCatalog.length} Features, ${featurePricingCatalog.length} prices, and ${packageFeatureCatalog.length} package assignments.`,
  );
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const prisma = createPrismaClient();
  seedFeatures(prisma)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
