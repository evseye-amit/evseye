import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value: unknown): Obj => isObject(value) ? value : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export type ResolvedComponent = {
  featureId: string;
  featureCode: string;
  featureName: string;
  description: string | null;
  translations: unknown;
  billingUnit: string;
  featureVersion: number;
  componentType: string;
  order: number;
  configuration: Obj;
  step: { id: string; code: string; name: string; description: string | null;
    translations: unknown; order: number; parentId: string | null; parentCode: string | null };
};

@Injectable()
export class WorkflowResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(clientId: string, category: string, appCode: string) {
    const now = new Date();
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { clientId, status: category === 'LOGIN' ? { in: ['ACTIVE', 'PENDING'] } : 'ACTIVE', startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }] },
      orderBy: { startDate: 'desc' },
      include: { packageRevision: true },
    });
    if (!subscription)
      throw new NotFoundException('Published workflow is unavailable for this workspace.');
    let revision = subscription.packageRevision;
    if (!revision) {
      revision = await this.prisma.packageRevision.findFirst({
        where: { packageId: subscription.packageId, publishedAt: { not: null } },
        orderBy: { version: 'desc' },
      });
      if (revision) {
        await this.prisma.clientSubscription.updateMany({
          where: { id: subscription.id, packageRevisionId: null },
          data: { packageRevisionId: revision.id },
        });
      }
    }
    if (!revision?.publishedAt)
      throw new NotFoundException('Published workflow is unavailable for this workspace.');
    const snapshot = object(revision.snapshot);
    const clientRevision = await this.prisma.clientWorkflowRevision.findFirst({
      where: { subscriptionId: subscription.id, publishedAt: { not: null },
        snapshot: { path: ['packageRevisionId'], equals: revision.id } },
      orderBy: { version: 'desc' },
    });
    // Older lightweight resolver fixtures do not provide the revision delegate.
    // Treat that as “no pending revision” while production Prisma always has it.
    const pendingPackageRevision = this.prisma.packageRevision?.findFirst
      ? await this.prisma.packageRevision.findFirst({
          where: { packageId: subscription.packageId, publishedAt: { not: null }, version: { gt: revision.version } },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, contentHash: true, publishedAt: true },
        })
      : null;
    const clientOverrides = new Map(array(object(clientRevision?.snapshot).overrides)
      .map((value) => object(value)).filter((value) => typeof value.featureId === 'string')
      .map((value) => [value.featureId as string, value]));
    const clientFeatureRows = this.prisma.clientFeature?.findMany
      ? await this.prisma.clientFeature.findMany({
          where: {
            subscriptionId: subscription.id,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
          select: { featureId: true, enabled: true, configuration: true },
        })
      : [];
    const clientFeatureOverrides = new Map(clientFeatureRows.map((value) => [value.featureId, {
      featureId: value.featureId,
      enabled: value.enabled,
      configuration: value.configuration,
    }]));
    const components: ResolvedComponent[] = [];
    const clientConfiguredFeatures = new Set<string>();
    for (const raw of array(snapshot.features)) {
      const assignment = object(raw);
      const feature = object(assignment.feature);
      if (feature.category !== category || feature.isActive === false) continue;
      const featureId = String(assignment.featureId ?? feature.id);
      const workflowOverride = clientOverrides.get(featureId);
      const clientFeatureOverride = clientFeatureOverrides.get(featureId);
      const clientOverride = workflowOverride ?? clientFeatureOverride;
      if (workflowOverride?.enabled === false || (workflowOverride === undefined && clientFeatureOverride?.enabled === false)) continue;
      const step = object(feature.step);
      if (typeof step.code !== 'string') continue;
      const base = object(feature.configuration);
      // ClientFeature configuration is the authoritative client payload. A workflow
      // revision may still supply workflow-only controls (enabled/order), but it must
      // not replace or repopulate fields deliberately removed by the client.
      const clientConfiguration = clientFeatureOverride?.configuration;
      const workflowConfiguration = workflowOverride?.configuration;
      const hasClientConfiguration = isObject(clientConfiguration);
      const hasWorkflowConfiguration = isObject(workflowConfiguration);
      const configuration: Obj = hasClientConfiguration
        ? { ...clientConfiguration }
        : hasWorkflowConfiguration
          ? { ...base, ...workflowConfiguration, validation: object(workflowConfiguration.validation ?? base.validation), translations: object(workflowConfiguration.translations ?? base.translations) }
          : { ...base, validation: object(base.validation), translations: object(base.translations) };
      if (hasClientConfiguration || hasWorkflowConfiguration) clientConfiguredFeatures.add(featureId);
      const appCodes = configuration.appCodes ?? configuration.loginAppCodes;
      if (Array.isArray(appCodes) && !appCodes.includes(appCode)) continue;
      if (configuration.enabled === false) continue;
      components.push({
        featureId,
        featureCode: String(feature.code),
        featureName: String(feature.name ?? feature.code),
        description: typeof feature.description === 'string' ? feature.description : null,
        translations: feature.translations ?? null,
        billingUnit: String(feature.billingUnit ?? 'LIFE_TIME'),
        featureVersion: Number(assignment.featureVersion ?? 1),
        componentType: String(configuration.componentType ?? configuration.fieldType ?? 'FIELD'),
        order: Number(workflowOverride?.displayOrder ?? assignment.displayOrder ?? feature.displayOrder ?? 0),
        configuration,
        step: { id: String(step.id ?? step.code), code: step.code,
          name: String(step.name ?? step.code),
          description: typeof step.description === 'string' ? step.description : null,
          translations: step.translations ?? null, order: Number(step.order ?? 0),
          parentId: typeof step.parentId === 'string' ? step.parentId : null,
          parentCode: typeof step.parentCode === 'string' ? step.parentCode : null },
      });
    }
    // Workflow structure stays pinned; catalog copy can be reviewed and activated independently.
    const featureIds = [...new Set(components.map((component) => component.featureId))];
    if (featureIds.length) {
      const localizedFeatures = await this.prisma.feature.findMany({
        where: { id: { in: featureIds } },
        select: { id: true, name: true, description: true, translations: true, configuration: true },
      });
      const currentCopy = new Map(localizedFeatures.map((feature) => [feature.id, feature]));
      for (const component of components) {
        const current = currentCopy.get(component.featureId);
        if (!current) continue;
        component.featureName = current.name;
        component.description = current.description;
        if (clientConfiguredFeatures.has(component.featureId)) continue;
        const catalogConfiguration = object(current.configuration);
        if (Object.prototype.hasOwnProperty.call(catalogConfiguration, 'placeholder')) {
          component.configuration.placeholder = catalogConfiguration.placeholder;
        } else {
          delete component.configuration.placeholder;
        }
        if (component.componentType === 'INTRO_CAROUSEL') continue;
        const catalogTranslations = object(current.translations);
        const configuredTranslations = object(component.configuration.translations);
        component.configuration.translations = Object.fromEntries(
          [...new Set([...Object.keys(catalogTranslations), ...Object.keys(configuredTranslations)])]
            .map((locale) => {
              const configured = object(configuredTranslations[locale]);
              return [locale, {
                ...object(catalogTranslations[locale]), ...configured,
                ...(Object.keys(configured).length && !('translationStatus' in configured)
                  ? { translationStatus: 'ACTIVE' } : {}),
              }];
            }),
        );
      }
    }
    // Platform step copy follows the current catalog as well.
    const stepCodes = [...new Set(components.map((component) => component.step.code))];
    if (stepCodes.length) {
      const localizedSteps = await this.prisma.featureStep.findMany({
        where: { code: { in: stepCodes } },
        select: { code: true, displayName: true, description: true, translations: true },
      });
      const currentCopy = new Map(localizedSteps.map((step) => [step.code, step]));
      for (const component of components) {
        const current = currentCopy.get(component.step.code);
        if (!current) continue;
        component.step.name = current.displayName;
        component.step.description = current.description;
        component.step.translations = current.translations;
      }
    }
    components.sort((a, b) => a.step.order - b.step.order || a.order - b.order);
    const version = createHash('sha256').update(JSON.stringify({ packageRevisionId: revision.id,
      packageHash: revision.contentHash, clientRevisionHash: clientRevision?.contentHash ?? null,
      category, appCode, components })).digest('hex').slice(0, 16);
    return { packageRevisionId: revision.id, packageVersion: revision.version,
      effectivePackageRevision: { id: revision.id, version: revision.version, contentHash: revision.contentHash, effectiveAt: revision.publishedAt },
      pendingPackageRevision: pendingPackageRevision ? { id: pendingPackageRevision.id, version: pendingPackageRevision.version, contentHash: pendingPackageRevision.contentHash, publishedAt: pendingPackageRevision.publishedAt } : null,
      clientRevisionId: clientRevision?.id ?? null,
      package: { id: String(snapshot.id), code: String(snapshot.code), name: String(snapshot.name) },
      version, components };
  }
}
