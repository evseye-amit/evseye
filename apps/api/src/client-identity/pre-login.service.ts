import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkflowResolverService } from '../workflow/workflow-resolver.service.js';
import { ClientBrandingService } from './client-branding.service.js';
import { isSupportedLanguage, languageDetails } from '../common/language-catalog.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};

@Injectable()
export class PreLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: ClientBrandingService,
    private readonly workflows: WorkflowResolverService,
  ) {}

  async clientForCode(companyCode: string, hostClientId?: string) {
    const client = await this.prisma.client.findFirst({
      where: { OR: [{ companyCode }, { slug: companyCode }], isActive: true,
        status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      select: { id: true, name: true, companyCode: true, slug: true },
    });
    if (!client || (hostClientId && hostClientId !== client.id))
      throw new NotFoundException('Workspace unavailable.');
    return client;
  }

  private async definition(clientId: string, appCode: string) {
    const resolved = await this.workflows.resolve(clientId, 'PRE_LOGIN', appCode);
    const language = resolved.components.find((part) => part.featureCode === 'SELECT_APP_LANGUAGE');
    const riderPrivacyConsent = resolved.components.find((part) => part.featureCode === 'ACCEPT_RIDER_PRIVACY_CONSENT');
    if (!language || language.componentType !== 'LANGUAGE_SELECTOR')
      throw new NotFoundException('Mandatory pre-login Features are unavailable.');
    if (riderPrivacyConsent && (riderPrivacyConsent.componentType !== 'LEGAL_CONSENT' ||
      riderPrivacyConsent.configuration.kind !== 'PRIVACY_CONSENT'))
      throw new NotFoundException('Mandatory rider privacy consent Feature is unavailable.');
    const configured = language.configuration.supportedLocales;
    if (!Array.isArray(configured) || configured.length === 0 ||
        !configured.every((value) => isSupportedLanguage(value)) ||
        new Set(configured).size !== configured.length)
      throw new NotFoundException('Supported languages are not configured.');
    return { resolved, configuredLocales: configured as string[], riderPrivacyConsent: !!riderPrivacyConsent,
      intro: resolved.components.find((part) => part.featureCode === 'SHOW_APP_INTRO') };
  }

  async publicBootstrap(companyCode: string, appCode: string, role: UserRole, hostClientId?: string) {
    if (!((appCode === 'RIDER' && role === 'RIDER') ||
      (appCode === 'FLEET_MANAGER' && role === 'FLEET_MANAGER')))
      throw new NotFoundException('Application role is unavailable.');
    const client = await this.clientForCode(companyCode, hostClientId);
    const { resolved, configuredLocales, intro, riderPrivacyConsent } = await this.definition(client.id, appCode);
    const now = new Date();
    const legalDocuments = await this.prisma.appLegalDocument.findMany({
      where: { appCode, role, kind: { in: appCode === 'RIDER'
        ? ['TERMS_AND_CONDITIONS', 'PRIVACY_POLICY', 'PRIVACY_CONSENT']
        : ['TERMS_AND_CONDITIONS', 'PRIVACY_POLICY'] },
        locale: { in: configuredLocales }, publishedAt: { not: null }, deletedAt: null,
        effectiveAt: { lte: now }, AND: [
          { OR: [{ clientId: client.id }, { clientId: null }] },
          { OR: [{ retiredAt: null }, { retiredAt: { gt: now } }] },
        ] },
      select: { kind: true, locale: true, id: true, version: true },
    });
    const available = new Set(legalDocuments.map(({ kind, locale }) => `${kind}:${locale}`));
    const supportedLocales = configuredLocales.filter((locale) =>
      available.has(`TERMS_AND_CONDITIONS:${locale}`) && available.has(`PRIVACY_POLICY:${locale}`) &&
      (!riderPrivacyConsent || available.has(`PRIVACY_CONSENT:${locale}`)));
    if (supportedLocales.length !== configuredLocales.length)
      throw new NotFoundException('Published terms, privacy policy and rider consent (where applicable) are required in every configured language.');
    const translations = object(intro?.configuration.translations);
    const introEnabled = !!intro && supportedLocales.every((locale) =>
      Array.isArray(translations[locale]) && (translations[locale] as unknown[]).length > 0);
    const introVersion = intro ? `${intro.featureVersion}:${createHash('sha256')
      .update(JSON.stringify(intro.configuration.translations ?? {})).digest('hex').slice(0, 12)}` : '0';
    const steps = [...new Map(resolved.components.map((part) => [part.step.code, part.step])).values()]
      .map((step) => ({ ...step, components: resolved.components.filter((part) => part.step.code === step.code)
        .map((part) => ({ featureCode: part.featureCode, featureVersion: part.featureVersion,
          componentType: part.componentType, order: part.order,
          contentVersion: part.featureCode === 'SHOW_APP_INTRO' ? introVersion : undefined,
          configuration: part.configuration })) }))
      .filter((step) => introEnabled || step.code !== 'PRE_LOGIN_INTRO')
      .sort((a, b) => a.order - b.order);
    return { client: { id: client.id, companyCode: client.companyCode ?? client.slug,
        displayName: client.name }, branding: (await this.branding.context(client.id)).branding,
      appCode, role, supportedLocales, languages: languageDetails(supportedLocales), workflowVersion: resolved.version,
      packageRevisionId: resolved.packageRevisionId, packageVersion: resolved.packageVersion,
      rendererSchemaVersion: 1, steps,
      // The old mobile release reads this projection while it upgrades to the component contract.
      workflow: [
        { code: 'SPLASH', required: true, order: 1 },
        { code: 'CLIENT_RESOLVE', required: true, order: 2 },
        { code: 'CHANGE_LANGUAGE', required: true, order: 3 },
        ...(riderPrivacyConsent ? [{ code: 'PRIVACY_CONSENT', required: true, order: 4, kind: 'PRIVACY_CONSENT' }] : []),
        { code: 'CONSENT', required: true, order: 5, kind: 'TERMS_AND_CONDITIONS' },
        { code: 'INTRO', required: false, enabled: introEnabled,
          version: introVersion, order: 6 },
      ],
    };
  }

}
