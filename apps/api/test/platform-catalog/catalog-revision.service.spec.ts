import { describe, expect, it, vi } from 'vitest';
import { CatalogRevisionService } from '../../src/platform-catalog/catalog-revision.service.js';

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
