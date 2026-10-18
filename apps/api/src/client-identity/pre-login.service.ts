import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkflowResolverService } from '../workflow/workflow-resolver.service.js';
import { ClientBrandingService } from './client-branding.service.js';
import { isSupportedLanguage, languageDetails } from '../common/language-catalog.js';

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
      select: { id: true, name: true, companyCode: true, slug: true, requestedLocales: true },
    });
    if (!client || (hostClientId && hostClientId !== client.id))
      throw new NotFoundException('Workspace unavailable.');
    return client;
  }

  async publicBootstrap(companyCode: string, appCode: string, role: UserRole, hostClientId?: string) {
    if (!((appCode === 'RIDER' && role === 'RIDER') ||
      (appCode === 'FLEET_MANAGER' && role === 'FLEET_MANAGER')))
      throw new NotFoundException('Application role is unavailable.');
    const client = await this.clientForCode(companyCode, hostClientId);
    const resolved = await this.workflows.resolve(client.id, 'PRE_LOGIN', appCode);
    const language = resolved.components.find((part) => part.featureCode === 'SELECT_APP_LANGUAGE');
    if (language && language.componentType !== 'LANGUAGE_SELECTOR')
      throw new NotFoundException('Language selection Feature is unavailable.');
    const configured = client.requestedLocales?.length ? client.requestedLocales :
      language?.configuration.supportedLocales ?? ['en'];
    if (!Array.isArray(configured) || configured.length === 0 ||
      !configured.every(isSupportedLanguage) || new Set(configured).size !== configured.length)
      throw new NotFoundException('Supported languages are not configured.');
    const supportedLocales = configured as string[];
    const privacyConsent = resolved.components.find((part) =>
      part.configuration.kind === 'PRIVACY_CONSENT');
    if (privacyConsent && privacyConsent.componentType !== 'LEGAL_CONSENT')
      throw new NotFoundException('Privacy consent Feature is unavailable.');
    const intro = resolved.components.find((part) => part.featureCode === 'SHOW_APP_INTRO');
    const introEnabled = !!intro;
    const introVersion = intro ? `${intro.featureVersion}:${createHash('sha256')
      .update(JSON.stringify(intro.configuration.translations ?? {})).digest('hex').slice(0, 12)}` : '0';
    const steps = [...new Map(resolved.components.map((part) => [part.step.code, part.step])).values()]
      .map((step) => ({ ...step, components: resolved.components.filter((part) => part.step.code === step.code)
        .map((part) => ({ featureCode: part.featureCode, featureVersion: part.featureVersion,
          translations: part.translations,
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
        ...(supportedLocales.length > 1 ? [{ code: 'CHANGE_LANGUAGE', required: false, order: 3 }] : []),
        ...(privacyConsent ? [{ code: 'PRIVACY_CONSENT', required: true, order: 4, kind: 'PRIVACY_CONSENT' }] : []),
        { code: 'INTRO', required: false, enabled: introEnabled,
          version: introVersion, order: 6 },
      ],
    };
  }

}
