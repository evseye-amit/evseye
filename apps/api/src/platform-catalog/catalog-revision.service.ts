import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { isSupportedLanguage } from '../common/language-catalog.js';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class CatalogRevisionService {
  constructor(private readonly prisma: PrismaService) {}

  featureRevisions(featureId: string) {
    return this.prisma.featureRevision.findMany({ where: { featureId }, orderBy: { version: 'desc' } });
  }

  packageRevisions(packageId: string) {
    return this.prisma.packageRevision.findMany({ where: { packageId }, orderBy: { version: 'desc' } });
  }

  async draftFeature(featureId: string) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId }, include: { featureStep: { include: { parent: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found.');
    const snapshot = {
      id: feature.id, code: feature.code, name: feature.name, category: feature.category,
      featureType: feature.featureType, billingUnit: feature.billingUnit,
      description: feature.description, translations: feature.translations,
      configuration: feature.configuration,
      displayOrder: feature.displayOrder, isActive: feature.isActive,
      step: feature.featureStep ? {
        id: feature.featureStep.id, parentId: feature.featureStep.parentId,
        code: feature.featureStep.code, name: feature.featureStep.displayName,
        description: feature.featureStep.description,
        translations: feature.featureStep.translations,
        order: feature.featureStep.displayOrder,
        parentCode: feature.featureStep.parent?.code ?? null,
      } : null,
    };
    const latest = await this.prisma.featureRevision.findFirst({
      where: { featureId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    return this.prisma.featureRevision.create({
      data: { featureId, version: (latest?.version ?? 0) + 1, snapshot: json(snapshot), contentHash: hash(snapshot) },
    });
  }

  async publishFeature(revisionId: string) {
    const revision = await this.prisma.featureRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException('Feature revision not found.');
    if (revision.publishedAt) return revision;
    const newerPublished = await this.prisma.featureRevision.findFirst({
      where: { featureId: revision.featureId, version: { gt: revision.version }, publishedAt: { not: null } },
    });
    if (newerPublished) throw new BadRequestException('A newer Feature revision is already published.');
    return this.prisma.featureRevision.update({ where: { id: revisionId }, data: { publishedAt: new Date() } });
  }

  async draftPackage(packageId: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id: packageId }, include: { features: { where: { isIncluded: true }, include: { feature: true } } },
    });
    if (!pkg) throw new NotFoundException('Package not found.');
    const features = [];
    for (const assignment of pkg.features) {
      const revision = await this.prisma.featureRevision.findFirst({
        where: { featureId: assignment.featureId, publishedAt: { not: null } },
        orderBy: { version: 'desc' },
      });
      if (!revision) throw new BadRequestException(`Publish Feature ${assignment.feature.code} before drafting this Package.`);
      features.push({
        featureId: assignment.featureId, featureRevisionId: revision.id,
        featureVersion: revision.version, feature: revision.snapshot,
        configuration: assignment.configuration, displayOrder: assignment.displayOrder,
        includedQuantity: assignment.includedQuantity?.toString() ?? null,
        resetPeriod: assignment.resetPeriod, isUnlimited: assignment.isUnlimited,
        rolloverAllowed: assignment.rolloverAllowed,
      });
    }
    features.sort((a, b) => a.displayOrder - b.displayOrder || a.featureId.localeCompare(b.featureId));
    const snapshot = {
      id: pkg.id, code: pkg.code, name: pkg.name, description: pkg.description,
      limits: { maxFleets: pkg.maxFleets, maxRiders: pkg.maxRiders, maxAdmins: pkg.maxAdmins,
        maxFleetManagers: pkg.maxFleetManagers, maxHubs: pkg.maxHubs, maxTeamLeaders: pkg.maxTeamLeaders,
        maxClusterManagers: pkg.maxClusterManagers, maxUsers: pkg.maxUsers },
      features,
    };
    const latest = await this.prisma.packageRevision.findFirst({
      where: { packageId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    return this.prisma.packageRevision.create({
      data: { packageId, version: (latest?.version ?? 0) + 1, snapshot: json(snapshot), contentHash: hash(snapshot) },
    });
  }

  async publishPackage(revisionId: string) {
    const revision = await this.prisma.packageRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException('Package revision not found.');
    if (revision.publishedAt) return revision;
    const snapshot = revision.snapshot as { features?: Array<{ feature?: { code?: string; configuration?: Record<string, unknown> }; configuration?: Record<string, unknown> }> };
    const features = snapshot.features ?? [];
    const language = features.find((item) => item.feature?.code === 'SELECT_APP_LANGUAGE');
    const locales = { ...language?.feature?.configuration, ...language?.configuration }.supportedLocales;
    if (locales !== undefined && (!Array.isArray(locales) || locales.length === 0 ||
        !locales.every(isSupportedLanguage) || new Set(locales).size !== locales.length))
      throw new BadRequestException('Select distinct languages from the platform language catalog.');
    const newerPublished = await this.prisma.packageRevision.findFirst({
      where: { packageId: revision.packageId, version: { gt: revision.version }, publishedAt: { not: null } },
    });
    if (newerPublished) throw new BadRequestException('A newer Package revision is already published.');
    return this.prisma.packageRevision.update({ where: { id: revisionId }, data: { publishedAt: new Date() } });
  }

  async assignPackageRevision(subscriptionId: string, revisionId: string) {
    const [subscription, revision] = await Promise.all([
      this.prisma.clientSubscription.findUnique({ where: { id: subscriptionId } }),
      this.prisma.packageRevision.findUnique({ where: { id: revisionId } }),
    ]);
    if (!subscription || !revision || !revision.publishedAt || subscription.packageId !== revision.packageId)
      throw new BadRequestException('Published Package revision must belong to the subscription Package.');
    if (subscription.packageRevisionId) {
      const current = await this.prisma.packageRevision.findUnique({ where: { id: subscription.packageRevisionId } });
      const allowanceSignature = (value: unknown) => {
        const snapshot = value as { limits?: unknown; features?: Array<{
          featureId: string; includedQuantity: string | null; resetPeriod: string; isUnlimited: boolean;
        }> };
        return JSON.stringify({ limits: snapshot.limits, features: (snapshot.features ?? []).map((item) => ({
          featureId: item.featureId, includedQuantity: item.includedQuantity,
          resetPeriod: item.resetPeriod, isUnlimited: item.isUnlimited,
        })).sort((a, b) => a.featureId.localeCompare(b.featureId)) });
      };
      if (current && allowanceSignature(current.snapshot) !== allowanceSignature(revision.snapshot))
        throw new BadRequestException('Commercial limits or allowances changed. Create a new subscription to upgrade this Package version.');
    }
    return this.prisma.clientSubscription.update({ where: { id: subscriptionId }, data: { packageRevisionId: revisionId } });
  }

  // Additive upgrades retain the subscription and its commercial/usage identities.
  private async packageUpgradePlan(db: Prisma.TransactionClient, subscriptionId: string, revisionId: string) {
    const subscription = await db.clientSubscription.findUnique({ where: { id: subscriptionId }, include: { packageRevision: true } });
    const target = await db.packageRevision.findUnique({ where: { id: revisionId } });
    const current = subscription?.packageRevision;
    if (!subscription || subscription.status !== 'ACTIVE' || !current || !target?.publishedAt ||
        target.packageId !== subscription.packageId || target.version <= current.version)
      throw new BadRequestException('Choose a newer published version of the active subscription’s Package.');
    type Part = { featureId: string; feature?: { code?: string; name?: string }; includedQuantity?: string | null;
      resetPeriod?: string; isUnlimited?: boolean; rolloverAllowed?: boolean };
    const before = current.snapshot as { limits?: unknown; features?: Part[] };
    const after = target.snapshot as { limits?: unknown; features?: Part[] };
    const next = new Map((after.features ?? []).map((item) => [item.featureId, item]));
    const allowance = (item: Part) => hash([item.includedQuantity ?? null, item.resetPeriod, item.isUnlimited, item.rolloverAllowed]);
    if (hash(before.limits ?? null) !== hash(after.limits ?? null) || (before.features ?? []).some((item) =>
      !next.has(item.featureId) || allowance(item) !== allowance(next.get(item.featureId)!)))
      throw new BadRequestException('This upgrade must preserve existing features, limits and allowances. Publish an additive Package version.');
    const workflow = await db.clientWorkflowRevision.findFirst({ where: { subscriptionId, publishedAt: { not: null },
      snapshot: { path: ['packageRevisionId'], equals: current.id } }, orderBy: { version: 'desc' } });
    const overrides = (workflow?.snapshot as { overrides?: Prisma.JsonValue[] } | undefined)?.overrides ?? [];
    const old = new Map((before.features ?? []).map((item) => [item.featureId, item]));
    const added = (after.features ?? []).filter((item) => !old.has(item.featureId));
    const changed = (after.features ?? []).filter((item) => old.has(item.featureId) && hash(old.get(item.featureId)) !== hash(item));
    const describe = (item: Part) => ({ featureId: item.featureId, code: item.feature?.code ?? item.featureId,
      name: item.feature?.name ?? item.feature?.code ?? item.featureId,
      includedQuantity: item.includedQuantity ?? null, isUnlimited: item.isUnlimited ?? false });
    const preview = { subscriptionId, fromRevisionId: current.id, toRevisionId: target.id,
      fromVersion: current.version, toVersion: target.version,
      addedFeatures: added.map(describe), changedFeatures: changed.map((item) => ({ ...describe(item),
        previous: old.get(item.featureId), next: item })),
      preservedOverrides: overrides.length, pricingUnchanged: true, usageHistoryPreserved: true };
    const previewToken = hash({ preview, subscriptionUpdatedAt: subscription.updatedAt, targetHash: target.contentHash,
      workflowId: workflow?.id, workflowHash: workflow?.contentHash });
    return { subscription, target, overrides, added, preview: { ...preview, previewToken } };
  }

  async previewPackageUpgrade(subscriptionId: string, revisionId: string) {
    return (await this.packageUpgradePlan(this.prisma, subscriptionId, revisionId)).preview;
  }

  async upgradePackageRevision(subscriptionId: string, revisionId: string, input: unknown, actorId: string) {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000)
      throw new BadRequestException('Provide an upgrade reason (maximum 1000 characters).');
    const reason = body.reason.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const plan = await this.packageUpgradePlan(tx, subscriptionId, revisionId);
        if (typeof body.previewToken !== 'string' || body.previewToken !== plan.preview.previewToken)
          throw new ConflictException('The Package or client settings changed. Review the upgrade again.');
        const latest = await tx.clientWorkflowRevision.findFirst({ where: { subscriptionId }, orderBy: { version: 'desc' } });
        const snapshot = { subscriptionId, packageRevisionId: revisionId, overrides: plan.overrides };
        await tx.clientWorkflowRevision.create({ data: { subscriptionId, version: (latest?.version ?? 0) + 1,
          snapshot: json(snapshot), contentHash: hash(snapshot), publishedAt: new Date() } });
        // Only the version pointer changes: pricing, add-ons, credits and usage remain intact.
        const updated = await tx.clientSubscription.updateMany({ where: { id: subscriptionId,
          packageRevisionId: plan.subscription.packageRevisionId, updatedAt: plan.subscription.updatedAt },
          data: { packageRevisionId: revisionId } });
        if (updated.count !== 1) throw new ConflictException('Subscription changed. Review the upgrade again.');
        const now = new Date();
        for (const item of plan.added) {
          const quantity = new Prisma.Decimal(item.includedQuantity ?? 0);
          if (item.isUnlimited || quantity.lte(0)) continue;
          // Never replenish a previously granted feature when upgrading.
          const existing = await tx.featureCreditLot.findFirst({ where: { subscriptionId, featureId: item.featureId,
            sourceType: 'PACKAGE_ALLOWANCE' } });
          if (existing) continue;
          const lot = await tx.featureCreditLot.create({ data: { clientId: plan.subscription.clientId, subscriptionId,
            featureId: item.featureId, sourceType: 'PACKAGE_ALLOWANCE', sourceId: revisionId,
            sourceKey: `upgrade:${subscriptionId}:${revisionId}:${item.featureId}`,
            quantityOriginal: quantity, quantityAvailable: quantity, periodStart: now } });
          await tx.featureUsageLedger.create({ data: { clientId: plan.subscription.clientId, subscriptionId,
            featureId: item.featureId, creditLotId: lot.id, sourceType: 'PACKAGE_ALLOWANCE', sourceId: revisionId,
            transactionType: 'CREDIT', quantity, referenceType: 'PACKAGE_UPGRADE', referenceId: subscriptionId, occurredAt: now } });
        }
        await tx.auditLog.create({ data: { clientId: plan.subscription.clientId, actorId,
          action: 'SUBSCRIPTION_PACKAGE_UPGRADED', entityType: 'ClientSubscription', entityId: subscriptionId,
          previousData: { packageRevisionId: plan.subscription.packageRevisionId }, newData: json({ ...plan.preview, reason }) } });
        return plan.preview;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code))
        throw new ConflictException('Subscription or workflow changed. Review the upgrade again.');
      throw error;
    }
  }

  clientWorkflowRevisions(subscriptionId: string) {
    return this.prisma.clientWorkflowRevision.findMany({
      where: { subscriptionId }, orderBy: { version: 'desc' },
    });
  }

  async draftClientWorkflow(subscriptionId: string, input: unknown) {
    const subscription = await this.prisma.clientSubscription.findUnique({
      where: { id: subscriptionId, }, include: { packageRevision: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (!subscription.packageRevision?.publishedAt)
      throw new BadRequestException('Assign a published Package revision first.');
    const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const raw = body.overrides;
    if (!Array.isArray(raw)) throw new BadRequestException('Provide a list of Feature overrides.');
    if (raw.length > 250) throw new BadRequestException('Too many Feature overrides.');
    const included = new Map(((subscription.packageRevision.snapshot as { features?: Array<{
      featureId: string; feature: { code: string } }> }).features ?? [])
      .map((part) => [part.featureId, part.feature.code]));
    const seen = new Set<string>();
    const overrides = raw.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('Invalid Feature override.');
      const item = value as Record<string, unknown>;
      const featureId = item.featureId;
      if (typeof featureId !== 'string' || !included.has(featureId) || seen.has(featureId))
        throw new BadRequestException('Override must reference one included Feature exactly once.');
      seen.add(featureId);
      const configuration = item.configuration ?? {};
      if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
        throw new BadRequestException('Feature override configuration must be an object.');
      if (JSON.stringify(configuration).length > 16000)
        throw new BadRequestException('Feature override configuration is too large.');
      if (Object.hasOwn(configuration, 'componentType'))
        throw new BadRequestException('Component type is set by the published Feature version.');
      const locales = (configuration as Record<string, unknown>).supportedLocales;
      if (locales !== undefined && (!Array.isArray(locales) || locales.length === 0 ||
          !locales.every(isSupportedLanguage) || new Set(locales).size !== locales.length))
        throw new BadRequestException('Select distinct languages from the platform language catalog.');
      return { featureId, enabled: item.enabled !== false, configuration };
    });
    const snapshot = { subscriptionId, packageRevisionId: subscription.packageRevisionId, overrides };
    const latest = await this.prisma.clientWorkflowRevision.findFirst({
      where: { subscriptionId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    return this.prisma.clientWorkflowRevision.create({
      data: { subscriptionId, version: (latest?.version ?? 0) + 1,
        snapshot: json(snapshot), contentHash: hash(snapshot) },
    });
  }

  async publishClientWorkflow(revisionId: string) {
    const revision = await this.prisma.clientWorkflowRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException('Client workflow revision not found.');
    if (revision.publishedAt) return revision;
    const subscription = await this.prisma.clientSubscription.findUnique({
      where: { id: revision.subscriptionId },
    });
    if (!subscription || (revision.snapshot as { packageRevisionId?: string }).packageRevisionId !== subscription.packageRevisionId)
      throw new BadRequestException('This draft targets a different Package version. Create a fresh client workflow draft.');
    const newerPublished = await this.prisma.clientWorkflowRevision.findFirst({
      where: { subscriptionId: revision.subscriptionId, version: { gt: revision.version }, publishedAt: { not: null } },
    });
    if (newerPublished) throw new BadRequestException('A newer client workflow revision is already published.');
    const packageRevision = await this.prisma.packageRevision.findUnique({ where: { id: subscription.packageRevisionId! } });
    const packageFeatures = ((packageRevision?.snapshot as { features?: Array<{
      featureId: string; feature: { code: string; configuration?: Record<string, unknown> };
      configuration?: Record<string, unknown>;
    }> })?.features ?? []);
    const overrides = new Map((((revision.snapshot as { overrides?: Array<{
      featureId: string; enabled?: boolean; configuration?: Record<string, unknown>;
    }> }).overrides) ?? []).map((item) => [item.featureId, item]));
    const featureConfig = (code: string, appCode: string) => {
      const item = packageFeatures.find((part) => part.feature.code === code);
      if (!item || overrides.get(item.featureId)?.enabled === false) return null;
      const configuration = { ...item.feature.configuration, ...item.configuration,
        ...overrides.get(item.featureId)?.configuration };
      const apps = configuration.appCodes;
      return configuration.enabled === false || (Array.isArray(apps) && !apps.includes(appCode))
        ? null : configuration;
    };
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: subscription.clientId },
      select: { requestedLocales: true } });
    for (const [appCode, role] of [['RIDER', 'RIDER'], ['FLEET_MANAGER', 'FLEET_MANAGER']] as const) {
      const language = featureConfig('SELECT_APP_LANGUAGE', appCode);
      const consent = packageFeatures.some((part) =>
        featureConfig(part.feature.code, appCode)?.kind === 'PRIVACY_CONSENT');
      if (!consent) continue;
      const locales = client.requestedLocales?.length ? client.requestedLocales : language?.supportedLocales ?? ['en'];
      if (!Array.isArray(locales) || locales.length === 0 || !locales.every(isSupportedLanguage))
        throw new BadRequestException(`${appCode}: select languages from the platform catalog.`);
      const kinds = ['PRIVACY_CONSENT'];
      const now = new Date();
      const documents = await this.prisma.appLegalDocument.findMany({ where: {
        appCode, role, kind: { in: kinds }, locale: { in: locales },
        publishedAt: { not: null }, deletedAt: null, effectiveAt: { lte: now },
        AND: [{ OR: [{ clientId: subscription.clientId }, { clientId: null }] },
          { OR: [{ retiredAt: null }, { retiredAt: { gt: now } }] }],
      }, select: { kind: true, locale: true } });
      const available = new Set(documents.map((document) => `${document.kind}:${document.locale}`));
      const missing = locales.flatMap((locale) => kinds.filter((kind) => !available.has(`${kind}:${locale}`))
        .map((kind) => `${locale} ${kind}`));
      if (missing.length)
        throw new BadRequestException(`${appCode}: publish legal documents before enabling these languages: ${missing.join(', ')}.`);
    }
    return this.prisma.clientWorkflowRevision.update({
      where: { id: revisionId }, data: { publishedAt: new Date() },
    });
  }
}
