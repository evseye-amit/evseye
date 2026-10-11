import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = (value) => JSON.parse(JSON.stringify(value));

export async function seedInitialRevisions(prisma) {
  const features = await prisma.feature.findMany({ include: { featureStep: { include: { parent: true } } } });
  for (const feature of features) {
    const snapshot = plain({ id: feature.id, code: feature.code, name: feature.name,
      category: feature.category, featureType: feature.featureType, billingUnit: feature.billingUnit,
      description: feature.description, configuration: feature.configuration,
      displayOrder: feature.displayOrder, isActive: feature.isActive,
      step: feature.featureStep ? { code: feature.featureStep.code,
        id: feature.featureStep.id, parentId: feature.featureStep.parentId,
        name: feature.featureStep.displayName, description: feature.featureStep.description,
        translations: feature.featureStep.translations, order: feature.featureStep.displayOrder,
        parentCode: feature.featureStep.parent?.code ?? null } : null });
    await prisma.featureRevision.upsert({
      where: { featureId_version: { featureId: feature.id, version: 1 } },
      create: { featureId: feature.id, version: 1, snapshot, contentHash: hash(snapshot), publishedAt: new Date() },
      update: {},
    });
  }

  const packages = await prisma.package.findMany({ include: { features: { where: { isIncluded: true } } } });
  for (const pkg of packages) {
    const entries = [];
    for (const assignment of pkg.features) {
      const revision = await prisma.featureRevision.findFirst({
        where: { featureId: assignment.featureId, publishedAt: { not: null } }, orderBy: { version: 'desc' },
      });
      if (!revision) throw new Error(`Feature ${assignment.featureId} has no published revision`);
      entries.push({ featureId: assignment.featureId, featureRevisionId: revision.id,
        featureVersion: revision.version, feature: revision.snapshot,
        configuration: assignment.configuration, displayOrder: assignment.displayOrder,
        includedQuantity: assignment.includedQuantity?.toString() ?? null,
        resetPeriod: assignment.resetPeriod, isUnlimited: assignment.isUnlimited,
        rolloverAllowed: assignment.rolloverAllowed });
    }
    entries.sort((a, b) => a.displayOrder - b.displayOrder);
    const snapshot = plain({ id: pkg.id, code: pkg.code, name: pkg.name, description: pkg.description,
      limits: { maxFleets: pkg.maxFleets, maxRiders: pkg.maxRiders, maxAdmins: pkg.maxAdmins,
        maxFleetManagers: pkg.maxFleetManagers, maxHubs: pkg.maxHubs, maxTeamLeaders: pkg.maxTeamLeaders,
        maxClusterManagers: pkg.maxClusterManagers, maxUsers: pkg.maxUsers }, features: entries });
    const revision = await prisma.packageRevision.upsert({
      where: { packageId_version: { packageId: pkg.id, version: 1 } },
      create: { packageId: pkg.id, version: 1, snapshot, contentHash: hash(snapshot), publishedAt: new Date() },
      update: {},
    });
    await prisma.clientSubscription.updateMany({
      where: { packageId: pkg.id, packageRevisionId: null }, data: { packageRevisionId: revision.id },
    });
  }
}
