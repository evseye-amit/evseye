import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { PreLoginService } from './pre-login.service.js';

const part = (code: string, componentType: string, configuration: Record<string, unknown>, order: number) => ({
  featureId: code, featureCode: code, featureVersion: 1, componentType, order, configuration,
  step: { code: `PRE_LOGIN_${code}`, name: code, order, parentCode: 'PRE_LOGIN' },
});

function fixture(locales = ['en']) {
  const prisma = {
    client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1', name: 'Yogmaya', companyCode: 'yogmaya', slug: 'yogmaya' }) },
    appLegalDocument: { findMany: vi.fn().mockResolvedValue(locales.flatMap((locale) => [
      { id: `terms-${locale}`, kind: 'TERMS_AND_CONDITIONS', locale, version: '1' },
      { id: `privacy-${locale}`, kind: 'PRIVACY_POLICY', locale, version: '1' },
      { id: `consent-${locale}`, kind: 'PRIVACY_CONSENT', locale, version: '1' },
    ])) },
  };
  const workflow = { resolve: vi.fn().mockResolvedValue({ version: 'abc123', packageRevisionId: 'pkg-r1', packageVersion: 1,
    components: [
      part('ACCEPT_RIDER_PRIVACY_CONSENT', 'LEGAL_CONSENT', { kind: 'PRIVACY_CONSENT' }, 2),
      part('SHOW_APP_INTRO', 'INTRO_CAROUSEL', { version: '3', translations: { en: [{ key: 'one', title: 'Welcome', body: 'Body', highlights: [] }] } }, 3),
    ] }) };
  const branding = { context: vi.fn().mockResolvedValue({ branding: {} }) };
  return { prisma, workflow, service: new PreLoginService(prisma as never, branding as never, workflow as never) };
}

describe('PreLoginService', () => {
  it('uses the published package workflow and role-specific legal locales', async () => {
    const { service, workflow } = fixture();
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(workflow.resolve).toHaveBeenCalledWith('client-1', 'PRE_LOGIN', 'RIDER');
    expect(result.packageRevisionId).toBe('pkg-r1');
    expect(result.steps.map((step) => step.code)).toEqual([
<<<<<<< HEAD
      'PRE_LOGIN_SELECT_APP_LANGUAGE', 'PRE_LOGIN_ACCEPT_RIDER_PRIVACY_CONSENT',
      'PRE_LOGIN_SHOW_APP_INTRO',
    ]);
    expect(result.supportedLocales).toEqual(['en']);
    expect(result.languages).toEqual([{ code: 'en', name: 'English', nativeName: 'English' }]);
=======
      'PRE_LOGIN_ACCEPT_RIDER_PRIVACY_CONSENT',
      'PRE_LOGIN_ACCEPT_APP_TERMS', 'PRE_LOGIN_SHOW_APP_INTRO',
    ]);
    expect(result.supportedLocales).toEqual(['en']);
    expect(result.workflow.some((step) => step.code === 'CHANGE_LANGUAGE')).toBe(false);
>>>>>>> main
  });

  it('shows language selection only when the resolved package includes it', async () => {
    const { service, workflow } = fixture();
    const resolved = await workflow.resolve();
    workflow.resolve.mockResolvedValue({ ...resolved, components: [
      part('SELECT_APP_LANGUAGE', 'LANGUAGE_SELECTOR', { supportedLocales: ['en'] }, 1),
      ...resolved.components,
    ] });
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.steps.some((step) => step.components.some(
      (component) => component.featureCode === 'SELECT_APP_LANGUAGE'))).toBe(true);
    expect(result.workflow.some((step) => step.code === 'CHANGE_LANGUAGE')).toBe(true);
  });

  it('fails closed when no language has all required published legal documents', async () => {
    const { service, prisma } = fixture(['en', 'hi']);
    prisma.appLegalDocument.findMany.mockResolvedValue([
      { id: 'terms-en', kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: '1' },
      { id: 'privacy-en', kind: 'PRIVACY_POLICY', locale: 'en', version: '1' },
    ]);
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER))
      .rejects.toThrow('Published terms, privacy policy and rider consent');
  });

  it('offers a newly configured language only with its published legal documents', async () => {
    const { service } = fixture(['en', 'mr']);
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.supportedLocales).toEqual(['en', 'mr']);
    expect(result.languages[1]).toEqual({ code: 'mr', name: 'Marathi', nativeName: 'मराठी' });
    expect(result.workflow.find((step) => step.code === 'INTRO')).toMatchObject({ enabled: false });
  });

  it('rejects a locale outside the platform catalog', async () => {
    const { service } = fixture(['en', 'fr']);
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER))
      .rejects.toThrow('Supported languages are not configured');
  });

  it('does not offer a role without a published privacy policy', async () => {
    const { service, prisma } = fixture();
    prisma.appLegalDocument.findMany.mockResolvedValue([
      { id: 'terms-en', kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: '1' },
    ]);
    await expect(service.publicBootstrap('yogmaya', 'FLEET_MANAGER', UserRole.FLEET_MANAGER))
      .rejects.toThrow('Published terms, privacy policy and rider consent');
  });

  it('requires the published privacy consent for Rider in each language', async () => {
    const { service, prisma } = fixture();
    prisma.appLegalDocument.findMany.mockResolvedValue([
      { id: 'terms-en', kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: '1' },
      { id: 'privacy-en', kind: 'PRIVACY_POLICY', locale: 'en', version: '1' },
    ]);
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER))
      .rejects.toThrow('Published terms, privacy policy and rider consent');
  });

  it('keeps an existing published Rider workflow available until consent rollout', async () => {
    const { service, workflow, prisma } = fixture();
    const resolved = await workflow.resolve();
    workflow.resolve.mockResolvedValue({ ...resolved, components: resolved.components.filter(
      (component: { featureCode: string }) => component.featureCode !== 'ACCEPT_RIDER_PRIVACY_CONSENT') });
    prisma.appLegalDocument.findMany.mockResolvedValue([
      { id: 'terms-en', kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: '1' },
      { id: 'privacy-en', kind: 'PRIVACY_POLICY', locale: 'en', version: '1' },
    ]);
    const bootstrap = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(bootstrap.supportedLocales).toEqual(['en']);
    expect(bootstrap.steps.some((step) => step.components.some(
      (part) => part.featureCode === 'ACCEPT_RIDER_PRIVACY_CONSENT'))).toBe(false);
  });
});
