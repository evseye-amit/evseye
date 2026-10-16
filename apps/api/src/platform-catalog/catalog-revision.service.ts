import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const codes = new Set(features.map((item) => item.feature?.code));
<<<<<<< HEAD
    if (!codes.has('SELECT_APP_LANGUAGE'))
      throw new BadRequestException('A Package must include the language Feature.');
    const mandatory = features.filter((item) => item.feature?.code === 'SELECT_APP_LANGUAGE');
=======
    if (!codes.has('ACCEPT_APP_TERMS'))
      throw new BadRequestException('A Package must include the legal consent Feature.');
    const mandatory = features.filter((item) => item.feature?.code === 'ACCEPT_APP_TERMS');
>>>>>>> main
    for (const item of mandatory) {
      const configuration = { ...item.feature?.configuration, ...item.configuration };
      if (configuration.enabled === false || !['RIDER', 'FLEET_MANAGER'].every((app) =>
        Array.isArray(configuration.appCodes) && configuration.appCodes.includes(app)))
<<<<<<< HEAD
        throw new BadRequestException('Language selection must be available to both mobile apps.');
    }
    const language = features.find((item) => item.feature?.code === 'SELECT_APP_LANGUAGE');
    const languageConfiguration = { ...language?.feature?.configuration, ...language?.configuration };
    if (!Array.isArray(languageConfiguration.supportedLocales) ||
        languageConfiguration.supportedLocales.length === 0 ||
        !languageConfiguration.supportedLocales.every(isSupportedLanguage) ||
        new Set(languageConfiguration.supportedLocales).size !== languageConfiguration.supportedLocales.length)
      throw new BadRequestException('Select distinct languages from the platform language catalog.');
=======
        throw new BadRequestException('Legal consent must be available to both mobile apps.');
    }
    const language = features.find((item) => item.feature?.code === 'SELECT_APP_LANGUAGE');
    if (language && { ...language.feature?.configuration, ...language.configuration }.enabled === false)
      throw new BadRequestException('Included language selection cannot be disabled.');
>>>>>>> main
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
<<<<<<< HEAD
      const mandatory = included.get(featureId) === 'SELECT_APP_LANGUAGE';
      if (item.enabled === false && mandatory)
        throw new BadRequestException('Language selection cannot be disabled.');
=======
      const mandatory = included.get(featureId) === 'ACCEPT_APP_TERMS';
      const packageControlled = included.get(featureId) === 'SELECT_APP_LANGUAGE';
      if (item.enabled === false && mandatory)
        throw new BadRequestException('Legal consent cannot be disabled.');
      if (item.enabled === false && packageControlled)
        throw new BadRequestException('Language selection is controlled by the Package.');
>>>>>>> main
      const configuration = item.configuration ?? {};
      if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
        throw new BadRequestException('Feature override configuration must be an object.');
      if (JSON.stringify(configuration).length > 16000)
        throw new BadRequestException('Feature override configuration is too large.');
      if (Object.hasOwn(configuration, 'componentType'))
        throw new BadRequestException('Component type is set by the published Feature version.');
      if (mandatory && ((configuration as Record<string, unknown>).enabled === false ||
          Object.hasOwn(configuration, 'appCodes') || Object.hasOwn(configuration, 'loginAppCodes')))
        throw new BadRequestException('Mandatory pre-login Features cannot be hidden from an app.');
<<<<<<< HEAD
      const locales = (configuration as Record<string, unknown>).supportedLocales;
      if (locales !== undefined && (!Array.isArray(locales) || locales.length === 0 ||
          !locales.every(isSupportedLanguage) || new Set(locales).size !== locales.length))
        throw new BadRequestException('Select distinct languages from the platform language catalog.');
=======
      if (packageControlled && ((configuration as Record<string, unknown>).enabled === false ||
          Object.hasOwn(configuration, 'appCodes') || Object.hasOwn(configuration, 'loginAppCodes')))
        throw new BadRequestException('Language selection is controlled by the Package.');
>>>>>>> main
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
    for (const [appCode, role] of [['RIDER', 'RIDER'], ['FLEET_MANAGER', 'FLEET_MANAGER']] as const) {
      const language = featureConfig('SELECT_APP_LANGUAGE', appCode);
      if (!language) continue;
      const locales = language.supportedLocales;
      if (!Array.isArray(locales) || locales.length === 0 || !locales.every(isSupportedLanguage))
        throw new BadRequestException(`${appCode}: select languages from the platform catalog.`);
      const kinds = ['TERMS_AND_CONDITIONS', 'PRIVACY_POLICY'];
      if (appCode === 'RIDER' && featureConfig('ACCEPT_RIDER_PRIVACY_CONSENT', appCode))
        kinds.push('PRIVACY_CONSENT');
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
