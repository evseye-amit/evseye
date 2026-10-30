import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { PreLoginService } from '../../src/client-identity/pre-login.service.js';

const part = (code: string, type: string, configuration: Record<string, unknown>, order: number) => ({
  featureCode: code, featureVersion: 1, componentType: type, order, configuration,
  step: { code: `PRE_LOGIN_${code}`, name: code, order, parentCode: 'PRE_LOGIN' },
});
function fixture(locales = ['en']) {
  const prisma = { client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1', name: 'Yogmaya',
    companyCode: 'yogmaya', slug: 'yogmaya', requestedLocales: locales }) } };
  const workflow = { resolve: vi.fn().mockResolvedValue({ version: 'abc', packageRevisionId: 'pkg-r1',
    packageVersion: 1, components: [] }) };
  const branding = { context: vi.fn().mockResolvedValue({ branding: {} }) };
  const service = new PreLoginService(prisma as never, branding as never, workflow as never);
  return { service, prisma, workflow };
}
describe('PreLoginService conditional screens', () => {
  it('resolves a single-language client without optional screens or published legal documents', async () => {
    const { service } = fixture();
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.supportedLocales).toEqual(['en']);
    expect(result.steps).toEqual([]);
    expect(result.workflow.map(step => step.code)).toEqual(['SPLASH', 'CLIENT_RESOLVE', 'INTRO']);
    expect(result.workflow.find(step => step.code === 'INTRO')).toMatchObject({ enabled: false });
  });
  it('offers all configured languages without requiring a language Feature', async () => {
    const { service } = fixture(['en', 'mr']);
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.supportedLocales).toEqual(['en', 'mr']);
    expect(result.languages[1].nativeName).toBe('मराठी');
    expect(result.workflow.some(step => step.code === 'CHANGE_LANGUAGE')).toBe(true);
  });
  it('uses client language settings instead of stale package defaults', async () => {
    const { service, workflow } = fixture(['en', 'hi']);
    workflow.resolve.mockResolvedValue({ version: 'abc', components: [
      part('SELECT_APP_LANGUAGE', 'LANGUAGE_SELECTOR', { supportedLocales: ['en'] }, 1),
    ] });
    expect((await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER)).supportedLocales).toEqual(['en', 'hi']);
  });
  it('rejects unsupported configured languages', async () => {
    const { service } = fixture(['en', 'fr']);
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER)).rejects.toThrow('Supported languages');
  });
  it('includes versioned privacy consent when configured without adding a Terms screen', async () => {
    const { service, workflow } = fixture();
    workflow.resolve.mockResolvedValue({ version: 'abc', components: [
      part('ACCEPT_RIDER_PRIVACY_CONSENT', 'LEGAL_CONSENT', { kind: 'PRIVACY_CONSENT' }, 2),
    ] });
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.workflow.some(step => step.code === 'PRIVACY_CONSENT')).toBe(true);
    expect(result.workflow.some(step => step.code === 'CONSENT')).toBe(false);
  });
  it('keeps package intro enabled when one language still needs content', async () => {
    const { service, workflow } = fixture(['en', 'hi']);
    workflow.resolve.mockResolvedValue({ version: 'abc', components: [
      part('SHOW_APP_INTRO', 'INTRO_CAROUSEL', { translations: { en: [{ title: 'Welcome' }] } }, 3),
    ] });
    const result = await service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER);
    expect(result.workflow.find(step => step.code === 'INTRO')).toMatchObject({ enabled: true });
    expect(result.steps).toHaveLength(1);
  });
  it('rejects a different role or host client', async () => {
    const { service } = fixture();
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.FLEET_MANAGER)).rejects.toThrow('Application role');
    await expect(service.publicBootstrap('yogmaya', 'RIDER', UserRole.RIDER, 'other')).rejects.toThrow('Workspace unavailable');
  });
});
