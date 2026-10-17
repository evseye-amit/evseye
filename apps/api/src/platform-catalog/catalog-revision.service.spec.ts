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

  it('publishes a package without unconditional pre-login Features', async () => {
    const revision = { id: 'pkg-r1', packageId: 'pkg', version: 1, snapshot: { features: [] } };
    const prisma = { packageRevision: { findUnique: vi.fn().mockResolvedValue(revision),
      findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(revision) } };
    await expect(new CatalogRevisionService(prisma as never).publishPackage('pkg-r1')).resolves.toMatchObject({ id: 'pkg-r1' });
  });
  it('allows disabling an optional pre-login Feature in a client draft', async () => {
    const prisma = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({ packageRevisionId: 'pkg-r1',
        packageRevision: { publishedAt: new Date(), snapshot: { features: [
          { featureId: 'intro', feature: { code: 'SHOW_APP_INTRO' } } ] } } }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'draft' }) },
    };
    await expect(new CatalogRevisionService(prisma as never).draftClientWorkflow('sub', {
      overrides: [{ featureId: 'intro', enabled: false, configuration: {} }],
    })).resolves.toMatchObject({ id: 'draft' });
  });
  it('requires published privacy consent before publishing a workflow that enables it', async () => {
    const prisma = {
      clientWorkflowRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'r', subscriptionId: 'sub', version: 1,
        snapshot: { packageRevisionId: 'pkg-r1', overrides: [] } }), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      clientSubscription: { findUnique: vi.fn().mockResolvedValue({ clientId: 'client', packageRevisionId: 'pkg-r1' }) },
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ requestedLocales: ['en', 'hi'] }) },
      packageRevision: { findUnique: vi.fn().mockResolvedValue({ snapshot: { features: [
        { featureId: 'consent', feature: { code: 'ACCEPT_RIDER_PRIVACY_CONSENT', configuration: {
          appCodes: ['RIDER'], kind: 'PRIVACY_CONSENT' } } },
      ] } }) },
      appLegalDocument: { findMany: vi.fn().mockResolvedValue([{ kind: 'PRIVACY_CONSENT', locale: 'en' }]) },
    };
    await expect(new CatalogRevisionService(prisma as never).publishClientWorkflow('r')).rejects.toThrow('hi PRIVACY_CONSENT');
    expect(prisma.clientWorkflowRevision.update).not.toHaveBeenCalled();
  });
});
