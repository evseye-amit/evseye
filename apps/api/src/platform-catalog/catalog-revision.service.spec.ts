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
  });
});

describe('reviewed additive Package upgrades', () => {
  const existingFeature = { featureId: 'sms', includedQuantity: '500', resetPeriod: 'MONTHLY', isUnlimited: false, rolloverAllowed: false };
  function fixture() {
    const current = { id: 'v1', version: 1, snapshot: { limits: { maxRiders: 100 }, features: [{ ...existingFeature }] } };
    const target = { id: 'v2', packageId: 'pkg', version: 2, publishedAt: new Date(), contentHash: 'target',
      snapshot: { limits: { maxRiders: 100 }, features: [{ ...existingFeature },
        { featureId: 'dob', feature: { code: 'CAPTURE_DATE_OF_BIRTH', name: 'Date of birth' }, includedQuantity: null }] } };
    const subscription = { id: 'sub', clientId: 'client', status: 'ACTIVE', packageId: 'pkg', packageRevisionId: 'v1',
      packageRevision: current, updatedAt: new Date(), setupFee: '100', recurringAmount: '500', currency: 'INR' };
    const workflow = { id: 'wf1', version: 3, contentHash: 'override', snapshot: { overrides: [
      { featureId: 'sms', enabled: true, configuration: { label: 'My setting' } }] } };
    const db = {
      clientSubscription: { findUnique: vi.fn().mockResolvedValue(subscription), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      packageRevision: { findUnique: vi.fn().mockResolvedValue(target) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(workflow), create: vi.fn() },
      featureCreditLot: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'lot' }) },
      featureUsageLedger: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    const prisma = { ...db, $transaction: vi.fn(async (fn: (tx: typeof db) => unknown) => fn(db)) };
    const service = new CatalogRevisionService(prisma as never);
    return { db, service, subscription, target, workflow };
  }
  it('previews additions without writing or changing pricing', async () => {
    const { service, db } = fixture();
    expect(await service.previewPackageUpgrade('sub', 'v2')).toMatchObject({
      addedFeatures: [{ code: 'CAPTURE_DATE_OF_BIRTH' }], preservedOverrides: 1, pricingUnchanged: true });
    expect(db.clientSubscription.updateMany).not.toHaveBeenCalled();
  });
  it('carries settings into a new published workflow and updates only the version pointer', async () => {
    const { service, db, workflow } = fixture();
    const preview = await service.previewPackageUpgrade('sub', 'v2');
    await service.upgradePackageRevision('sub', 'v2', { previewToken: preview.previewToken, reason: 'Enable DOB' }, 'admin');
    expect(db.clientSubscription.updateMany.mock.calls[0][0].data).toEqual({ packageRevisionId: 'v2' });
    expect(db.clientWorkflowRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 4,
      publishedAt: expect.any(Date), snapshot: { subscriptionId: 'sub', packageRevisionId: 'v2', overrides: workflow.snapshot.overrides } }) });
    expect(db.featureUsageLedger.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'admin', action: 'SUBSCRIPTION_PACKAGE_UPGRADED' }) });
  });
  it.each(['removed', 'allowance', 'limits', 'rollover'])('blocks destructive %s changes', async (change) => {
    const { service, target } = fixture();
    if (change === 'removed') target.snapshot.features = [];
    if (change === 'allowance') target.snapshot.features[0].includedQuantity = '100';
    if (change === 'limits') target.snapshot.limits.maxRiders = 20;
    if (change === 'rollover') (target.snapshot.features[0] as typeof existingFeature).rolloverAllowed = true;
    await expect(service.previewPackageUpgrade('sub', 'v2')).rejects.toThrow('preserve existing');
  });
  it.each(['draft', 'otherPackage', 'downgrade', 'inactive'])('rejects %s targets', async (change) => {
    const { service, target, subscription } = fixture();
    if (change === 'draft') target.publishedAt = null as never;
    if (change === 'otherPackage') target.packageId = 'other';
    if (change === 'downgrade') target.version = 1;
    if (change === 'inactive') subscription.status = 'CANCELLED';
    await expect(service.previewPackageUpgrade('sub', 'v2')).rejects.toThrow('newer published');
  });
  it.each(['workflow', 'subscription', 'target'])('rejects a stale preview after %s changes', async (change) => {
    const { service, db, workflow, subscription, target } = fixture();
    const preview = await service.previewPackageUpgrade('sub', 'v2');
    if (change === 'workflow') workflow.contentHash = 'new';
    if (change === 'subscription') subscription.updatedAt = new Date(0);
    if (change === 'target') target.contentHash = 'new';
    await expect(service.upgradePackageRevision('sub', 'v2', { previewToken: preview.previewToken, reason: 'test' }, 'admin')).rejects.toThrow('Review the upgrade again');
    expect(db.clientSubscription.updateMany).not.toHaveBeenCalled();
  });
  it('requires an audit reason', async () => {
    const { service } = fixture();
    await expect(service.upgradePackageRevision('sub', 'v2', { reason: ' ' }, 'admin')).rejects.toThrow('reason');
  });
  it('grants only new metered features and records the corresponding credit', async () => {
    const { service, target, db } = fixture();
    target.snapshot.features[1].includedQuantity = '500';
    const preview = await service.previewPackageUpgrade('sub', 'v2');
    await service.upgradePackageRevision('sub', 'v2', { previewToken: preview.previewToken, reason: 'test' }, 'admin');
    expect(db.featureCreditLot.create).toHaveBeenCalledTimes(1);
    expect(db.featureCreditLot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ featureId: 'dob',
      sourceKey: 'upgrade:sub:v2:dob' }) });
    expect(db.featureUsageLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      creditLotId: 'lot', transactionType: 'CREDIT', referenceType: 'PACKAGE_UPGRADE' }) });
  });
  it('does not replenish already granted allowances for added features', async () => {
    const { service, target, db } = fixture();
    target.snapshot.features[1].includedQuantity = '500';
    db.featureCreditLot.findFirst.mockResolvedValue({ id: 'old' } as never);
    const preview = await service.previewPackageUpgrade('sub', 'v2');
    await service.upgradePackageRevision('sub', 'v2', { previewToken: preview.previewToken, reason: 'test' }, 'admin');
    expect(db.featureCreditLot.create).not.toHaveBeenCalled();
  });
});
