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

  it('does not permit disabling mandatory language selection in a client draft', async () => {
    const prisma = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({
        packageRevisionId: 'pkg-r1', packageRevision: { publishedAt: new Date(),
          snapshot: { features: [{ featureId: 'language', feature: { code: 'SELECT_APP_LANGUAGE' } }] } },
      }) },
    };
    await expect(new CatalogRevisionService(prisma as never).draftClientWorkflow('sub', {
      overrides: [{ featureId: 'language', enabled: false, configuration: {} }],
    })).rejects.toThrow('cannot be disabled');
  });

<<<<<<< HEAD
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
=======
  it('publishes a package with consent and no language feature', async () => {
    const revision = { id: 'pkg-r1', packageId: 'pkg', version: 1, publishedAt: null,
      snapshot: { features: [{ feature: { code: 'ACCEPT_APP_TERMS',
        configuration: { appCodes: ['RIDER', 'FLEET_MANAGER'] } } }] } };
    const prisma = { packageRevision: {
      findUnique: vi.fn().mockResolvedValue(revision),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ...revision, publishedAt: new Date() }),
    } };
    await expect(new CatalogRevisionService(prisma as never).publishPackage('pkg-r1'))
      .resolves.toMatchObject({ id: 'pkg-r1' });
  });

  it('keeps included language selection controlled by the package', async () => {
    const prisma = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({
        packageRevisionId: 'pkg-r1', packageRevision: { publishedAt: new Date(),
          snapshot: { features: [
            { featureId: 'terms', feature: { code: 'ACCEPT_APP_TERMS' } },
            { featureId: 'language', feature: { code: 'SELECT_APP_LANGUAGE' } },
          ] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'workflow-r1' }) },
    };
    await expect(new CatalogRevisionService(prisma as never).draftClientWorkflow('sub', {
      overrides: [{ featureId: 'language', enabled: false, configuration: {} }],
    })).rejects.toThrow('controlled by the Package');
>>>>>>> main
  });
});
