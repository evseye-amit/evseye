import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
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
      where: { clientId, status: 'ACTIVE', startDate: { lte: now },
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
    const clientOverrides = new Map(array(object(clientRevision?.snapshot).overrides)
      .map((value) => object(value)).filter((value) => typeof value.featureId === 'string')
      .map((value) => [value.featureId as string, value]));
    const components: ResolvedComponent[] = [];
    for (const raw of array(snapshot.features)) {
      const assignment = object(raw);
      const feature = object(assignment.feature);
      if (feature.category !== category || feature.isActive === false) continue;
      const clientOverride = feature.code === 'SELECT_APP_LANGUAGE' ? undefined :
        clientOverrides.get(String(assignment.featureId));
      if (clientOverride?.enabled === false) continue;
      const step = object(feature.step);
      if (typeof step.code !== 'string') continue;
      const base = object(feature.configuration);
      const override = { ...object(assignment.configuration), ...object(clientOverride?.configuration) };
      const configuration: Obj = { ...base, ...override,
        validation: { ...object(base.validation), ...object(override.validation) },
        translations: { ...object(base.translations), ...object(override.translations) } };
      const appCodes = configuration.appCodes ?? configuration.loginAppCodes;
      if (Array.isArray(appCodes) && !appCodes.includes(appCode)) continue;
      if (configuration.enabled === false) continue;
      components.push({
        featureId: String(assignment.featureId ?? feature.id),
        featureCode: String(feature.code),
        featureName: String(feature.name ?? feature.code),
        description: typeof feature.description === 'string' ? feature.description : null,
        translations: feature.translations ?? null,
        billingUnit: String(feature.billingUnit ?? 'LIFE_TIME'),
        featureVersion: Number(assignment.featureVersion ?? 1),
        componentType: String(configuration.componentType ?? configuration.fieldType ?? 'FIELD'),
        order: Number(assignment.displayOrder || feature.displayOrder || 0),
        configuration,
        step: { id: String(step.id ?? step.code), code: step.code,
          name: String(step.name ?? step.code),
          description: typeof step.description === 'string' ? step.description : null,
          translations: step.translations ?? null, order: Number(step.order ?? 0),
          parentId: typeof step.parentId === 'string' ? step.parentId : null,
          parentCode: typeof step.parentCode === 'string' ? step.parentCode : null },
      });
    }
    components.sort((a, b) => a.step.order - b.step.order || a.order - b.order);
    const version = createHash('sha256').update(JSON.stringify({ packageRevisionId: revision.id,
      packageHash: revision.contentHash, clientRevisionHash: clientRevision?.contentHash ?? null,
      category, appCode, components })).digest('hex').slice(0, 16);
    return { packageRevisionId: revision.id, packageVersion: revision.version,
      clientRevisionId: clientRevision?.id ?? null,
      package: { id: String(snapshot.id), code: String(snapshot.code), name: String(snapshot.name) },
      version, components };
  }
}
