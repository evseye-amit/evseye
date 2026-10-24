import { createHash } from 'node:crypto';
import { featureCatalog } from './features.mjs';
import { basicPackageFeatureCatalog } from './package-features.mjs';
import { featureStepSpecs } from './feature-steps.mjs';
import { featureRevisionSnapshot } from './seed-revisions.mjs';

// Targeted, repeatable repair. Does not republish packages or change subscription pins.
export async function repairBasicLegalConsent(prisma) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUniqueOrThrow({ where: { code: 'BASIC' }, select: { id: true } });
    let parentId = null;
    let step;
    for (const code of ['PRE_LOGIN', 'PRE_LOGIN_CONSENT']) {
      const { parentCode: _parentCode, ...definition } = featureStepSpecs.find((item) => item.code === code);
      step = await tx.featureStep.upsert({ where: { code }, create: { ...definition, parentId }, update: { isActive: true } });
      parentId = step.id;
    }
    const { featureStepCode: _stepCode, ...definition } = featureCatalog.find((item) => item.code === 'ACCEPT_APP_TERMS');
    const existing = await tx.feature.findUnique({ where: { code: definition.code } });
    const configuration = { ...(existing?.configuration ?? {}), ...definition.configuration };
    const feature = await tx.feature.upsert({ where: { code: definition.code },
      create: { ...definition, featureStepId: step.id },
      update: { configuration, isActive: true, category: definition.category, featureType: definition.featureType,
        billingUnit: definition.billingUnit, isAddOnEligible: false, featureStepId: step.id },
      include: { featureStep: { include: { parent: true } } } });
    const { packageCode: _packageCode, featureCode: _featureCode, ...assignment } = basicPackageFeatureCatalog.find((item) => item.featureCode === definition.code);
    const prior = await tx.packageFeature.findUnique({ where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } } });
    await tx.packageFeature.upsert({ where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } },
      create: { packageId: pkg.id, featureId: feature.id, ...assignment },
      update: { isIncluded: true, configuration: { ...(prior?.configuration ?? {}), ...assignment.configuration } } });
    const snapshot = featureRevisionSnapshot(feature);
    const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const latestPublished = await tx.featureRevision.findFirst({ where: { featureId: feature.id, publishedAt: { not: null } }, orderBy: { version: 'desc' } });
    let revision = latestPublished;
    if (latestPublished?.contentHash !== contentHash) {
      const latest = await tx.featureRevision.findFirst({ where: { featureId: feature.id }, orderBy: { version: 'desc' } });
      revision = await tx.featureRevision.create({ data: { featureId: feature.id, version: (latest?.version ?? 0) + 1,
        snapshot, contentHash, publishedAt: new Date() } });
    }
    return { packageId: pkg.id, featureId: feature.id, featureRevisionId: revision.id };
  }, { isolationLevel: 'Serializable' });
}
