import { PrismaClient } from '@prisma/client';
import { featureStepSpecs } from './catalog/feature-steps.mjs';
import { featureStepTranslations } from './catalog/feature-step-translations.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { featurePricingCatalog } from './catalog/feature-pricing.mjs';
import { packageFeatureCatalog } from './catalog/package-features.mjs';

const prisma = new PrismaClient();

try {
  const steps = new Map();
  for (const step of [...featureStepSpecs.filter((item) => !item.parentCode), ...featureStepSpecs.filter((item) => item.parentCode)]) {
    const { parentCode, ...data } = step;
    const parentId = parentCode ? steps.get(parentCode)?.id : null;
    if (parentCode && !parentId) throw new Error(`Missing parent Feature Step ${parentCode}`);
    const translations = featureStepTranslations[step.code];
    const saved = await prisma.featureStep.upsert({
      where: { code: step.code },
      create: { ...data, parentId, ...(translations ? { translations } : {}) },
      update: { displayName: data.displayName, description: data.description, displayOrder: data.displayOrder, parentId, isActive: true, ...(translations ? { translations } : {}) },
    });
    steps.set(step.code, saved);
  }

  for (const { featureStepCode, ...feature } of featureCatalog) {
    const featureStepId = featureStepCode ? steps.get(featureStepCode)?.id : null;
    if (featureStepCode && !featureStepId) throw new Error(`Missing Feature Step ${featureStepCode} for ${feature.code}`);
    await prisma.feature.upsert({
      where: { code: feature.code },
      create: { ...feature, featureStepId },
      update: { ...feature, featureStepId },
    });
  }

  for (const { featureCode, effectiveFrom, effectiveTo, billingUnit, currency, isActive, ...pricing } of featurePricingCatalog) {
    const feature = await prisma.feature.findUniqueOrThrow({ where: { code: featureCode }, select: { id: true } });
    const from = new Date(effectiveFrom);
    const to = effectiveTo ? new Date(effectiveTo) : null;
    const existing = await prisma.featurePricing.findFirst({
      where: { featureId: feature.id, effectiveFrom: from, effectiveTo: to, billingUnit, currency, isActive },
      select: { id: true },
    });
    const data = { ...pricing, billingUnit, currency, isActive, effectiveTo: to };
    if (existing) await prisma.featurePricing.update({ where: { id: existing.id }, data });
    else await prisma.featurePricing.create({ data: { ...data, featureId: feature.id, effectiveFrom: from } });
  }

  for (const { packageCode, featureCode, configuration, ...assignment } of packageFeatureCatalog) {
    const [pkg, feature] = await Promise.all([
      prisma.package.findUniqueOrThrow({ where: { code: packageCode }, select: { id: true } }),
      prisma.feature.findUniqueOrThrow({ where: { code: featureCode }, select: { id: true } }),
    ]);
    const data = { ...assignment, ...(configuration === null ? {} : { configuration }) };
    await prisma.packageFeature.upsert({
      where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } },
      create: { packageId: pkg.id, featureId: feature.id, ...data },
      update: data,
    });
  }
  console.info(`Seeded ${featureStepSpecs.length} Feature Steps, ${featureCatalog.length} Features, ${featurePricingCatalog.length} prices, and ${packageFeatureCatalog.length} package assignments.`);
} finally {
  await prisma.$disconnect();
}
