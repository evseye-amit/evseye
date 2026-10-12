import { describe, expect, it, vi } from 'vitest';
import { CatalogRevisionService } from './catalog-revision.service.js';

describe('CatalogRevisionService', () => {
  it('rejects a direct Package version change when allowances differ', async () => {
    const current = { limits: { maxRiders: 100 }, features: [{ featureId: 'sms',
      includedQuantity: '500', resetPeriod: 'MONTHLY', isUnlimited: false }] };
    const next = { limits: { maxRiders: 100 }, features: [{ featureId: 'sms',
      includedQuantity: '1000', resetPeriod: 'MONTHLY', isUnlimited: false }] };
    const prisma = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({
        packageId: 'pkg', packageRevisionId: 'v1' }), update: vi.fn() },
      packageRevision: { findUnique: vi.fn()
        .mockResolvedValueOnce({ id: 'v2', packageId: 'pkg', publishedAt: new Date(), snapshot: next })
        .mockResolvedValueOnce({ id: 'v1', packageId: 'pkg', publishedAt: new Date(), snapshot: current }) },
    };
    await expect(new CatalogRevisionService(prisma as never)
      .assignPackageRevision('sub', 'v2')).rejects.toThrow('Create a new subscription');
    expect(prisma.clientSubscription.update).not.toHaveBeenCalled();
  });

  it('does not permit disabling mandatory consent in a client draft', async () => {
    const prisma = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({
        packageRevisionId: 'pkg-r1', packageRevision: { publishedAt: new Date(),
          snapshot: { features: [{ featureId: 'terms', feature: { code: 'ACCEPT_APP_TERMS' } }] } },
      }) },
    };
    await expect(new CatalogRevisionService(prisma as never).draftClientWorkflow('sub', {
      overrides: [{ featureId: 'terms', enabled: false, configuration: {} }],
    })).rejects.toThrow('cannot be disabled');
  });

  it('blocks publishing a client language before its legal documents are published', async () => {
    const prisma = {
      clientWorkflowRevision: {
        findUnique: vi.fn().mockResolvedValue({ id: 'workflow-r2', subscriptionId: 'sub', version: 2,
          snapshot: { packageRevisionId: 'pkg-r1', overrides: [{ featureId: 'language',
            configuration: { supportedLocales: ['en', 'mr'] } }] } }),
        findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(),
      },
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({
        clientId: 'client-1', packageRevisionId: 'pkg-r1',
      }) },
      packageRevision: { findUnique: vi.fn().mockResolvedValue({ snapshot: { features: [
        { featureId: 'language', feature: { code: 'SELECT_APP_LANGUAGE', configuration: {
          appCodes: ['RIDER', 'FLEET_MANAGER'], supportedLocales: ['en'],
        } } },
      ] } }) },
      appLegalDocument: { findMany: vi.fn().mockResolvedValue([
        { kind: 'TERMS_AND_CONDITIONS', locale: 'en' },
        { kind: 'PRIVACY_POLICY', locale: 'en' },
      ]) },
    };
    await expect(new CatalogRevisionService(prisma as never).publishClientWorkflow('workflow-r2'))
      .rejects.toThrow('mr TERMS_AND_CONDITIONS');
    expect(prisma.clientWorkflowRevision.update).not.toHaveBeenCalled();
  });
});
