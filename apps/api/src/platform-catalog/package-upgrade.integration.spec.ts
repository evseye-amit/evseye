import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CatalogRevisionService } from './catalog-revision.service.js';
import { RiderOnboardingConfigurationService } from '../riders/rider-onboarding-configuration.service.js';
import { WorkflowResolverService } from '../workflow/workflow-resolver.service.js';

const url = process.env.PACKAGE_UPGRADE_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' } } });
afterAll(() => db.$disconnect());
const service = new CatalogRevisionService(db as never);

describe.skipIf(!url)('Package upgrade database preservation', () => {
  async function fixture() {
    const key = randomUUID();
    const client = await db.client.create({ data: { name: 'Upgrade test', slug: key, status: 'ACTIVE' } });
    const admin = await db.user.create({ data: { name: 'Admin', mobile: key, role: 'SUPER_ADMIN' } });
    const pkg = await db.package.create({ data: { code: key, name: 'Basic' } });
    const feature = await db.feature.create({ data: { code: key, name: 'Name', featureType: 'CONFIGURATION', billingUnit: 'RIDER' } });
    const part = { featureId: feature.id, includedQuantity: '500', resetPeriod: 'MONTHLY', isUnlimited: false, rolloverAllowed: false,
      feature: { code: key, name: 'Name', category: 'RIDER_ONBOARDING', isActive: true,
        step: { id: 'personal', code: 'PERSONAL', name: 'Personal' }, configuration: { componentType: 'TEXT', fieldCode: 'FULL_NAME' } } };
    const snapshot = { id: pkg.id, code: key, name: 'Basic', limits: { maxRiders: 500 }, features: [part] };
    const before = await db.packageRevision.create({ data: { packageId: pkg.id, version: 1, snapshot, contentHash: 'a'.repeat(64), publishedAt: new Date() } });
    const extra = ['CAPTURE_DATE_OF_BIRTH', 'CAPTURE_CURRENT_FULL_ADDRESS'].map((code, index) => ({
      featureId: randomUUID(), includedQuantity: null, resetPeriod: 'NONE', isUnlimited: false,
      feature: { code, name: code, category: 'RIDER_ONBOARDING', isActive: true, step: part.feature.step,
        configuration: { storageKey: index ? 'currentAddress' : 'dateOfBirth', componentType: index ? 'TEXTAREA' : 'DATE', fieldCode: index ? 'CURRENT_ADDRESS' : 'DATE_OF_BIRTH', required: false } } }));
    const target = await db.packageRevision.create({ data: { packageId: pkg.id, version: 2,
      snapshot: { ...snapshot, features: [part, ...extra] }, contentHash: 'b'.repeat(64), publishedAt: new Date() } });
    const subscription = await db.clientSubscription.create({ data: { clientId: client.id, packageId: pkg.id,
      packageRevisionId: before.id, billingCycle: 'MONTHLY', startDate: new Date('2026-01-01'), setupFee: 123,
      pricePerVehicle: 99.5, recurringAmount: 995, vehicleCount: 10 } });
    const workflow = await db.clientWorkflowRevision.create({ data: { subscriptionId: subscription.id, version: 1,
      snapshot: { subscriptionId: subscription.id, packageRevisionId: before.id,
        overrides: [{ featureId: feature.id, enabled: true, configuration: { label: 'Saved label' } }] },
      contentHash: 'c'.repeat(64), publishedAt: new Date() } });
    const lot = await db.featureCreditLot.create({ data: { clientId: client.id, subscriptionId: subscription.id,
      featureId: feature.id, sourceType: 'PACKAGE_ALLOWANCE', sourceId: before.id, sourceKey: key,
      quantityOriginal: 500, quantityAvailable: 321 } });
    const ledger = await db.featureUsageLedger.create({ data: { clientId: client.id, subscriptionId: subscription.id,
      featureId: feature.id, creditLotId: lot.id, sourceType: 'PACKAGE_ALLOWANCE', transactionType: 'DEBIT', quantity: -179 } });
    return { client, admin, subscription, target, workflow, lot, ledger };
  }
  it('preserves subscription pricing, historical records and overrides while exposing DOB and address', async () => {
    const f = await fixture();
    const preview = await service.previewPackageUpgrade(f.subscription.id, f.target.id);
    await service.upgradePackageRevision(f.subscription.id, f.target.id, { previewToken: preview.previewToken, reason: 'Enable personal fields' }, f.admin.id);
    const updated = await db.clientSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
    const { packageRevisionId: _old, updatedAt: _oldTime, ...original } = f.subscription;
    const { packageRevisionId, updatedAt: _time, ...remaining } = updated;
    expect(remaining).toEqual(original);
    expect(packageRevisionId).toBe(f.target.id);
    expect(await db.featureCreditLot.findUnique({ where: { id: f.lot.id } })).toEqual(f.lot);
    expect(await db.featureUsageLedger.findUnique({ where: { id: f.ledger.id } })).toEqual(f.ledger);
    expect(await db.clientWorkflowRevision.findUnique({ where: { id: f.workflow.id } })).toEqual(f.workflow);
    const resolved = await new WorkflowResolverService(db as never).resolve(f.client.id, 'RIDER_ONBOARDING', 'RIDER');
    expect(resolved.components.map((item) => item.featureCode)).toEqual(expect.arrayContaining(['CAPTURE_DATE_OF_BIRTH', 'CAPTURE_CURRENT_FULL_ADDRESS']));
    expect(resolved.components[0].configuration.label).toBe('Saved label');
    const configuration = await new RiderOnboardingConfigurationService(db as never, new WorkflowResolverService(db as never)).getEffectiveConfiguration(f.client.id);
    const fields = configuration.onboarding.steps.flatMap((step) => step.fields);
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: 'DATE_OF_BIRTH', storageKey: 'dateOfBirth', required: false }),
      expect.objectContaining({ fieldCode: 'CURRENT_ADDRESS', storageKey: 'currentAddress', required: false }),
    ]));
    expect((await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).fleetOperatingMode).toBe('SIMPLE');
    await expect(service.upgradePackageRevision(f.subscription.id, f.target.id, { previewToken: preview.previewToken, reason: 'Retry' }, f.admin.id)).rejects.toThrow();
    expect(await db.auditLog.count({ where: { entityId: f.subscription.id, action: 'SUBSCRIPTION_PACKAGE_UPGRADED' } })).toBe(1);
  });
  it('rolls back the upgrade and copied workflow if audit insertion fails', async () => {
    const f = await fixture();
    const preview = await service.previewPackageUpgrade(f.subscription.id, f.target.id);
    await expect(service.upgradePackageRevision(f.subscription.id, f.target.id, { previewToken: preview.previewToken, reason: 'test' }, randomUUID())).rejects.toThrow();
    expect((await db.clientSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).packageRevisionId).toBe(f.subscription.packageRevisionId);
    expect(await db.clientWorkflowRevision.count({ where: { subscriptionId: f.subscription.id } })).toBe(1);
  });
  it('applies exactly one of two concurrent upgrades', async () => {
    const f = await fixture();
    const preview = await service.previewPackageUpgrade(f.subscription.id, f.target.id);
    const results = await Promise.allSettled([1, 2].map(() => service.upgradePackageRevision(f.subscription.id, f.target.id,
      { previewToken: preview.previewToken, reason: 'test' }, f.admin.id)));
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await db.clientWorkflowRevision.count({ where: { subscriptionId: f.subscription.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { entityId: f.subscription.id, action: 'SUBSCRIPTION_PACKAGE_UPGRADED' } })).toBe(1);
  });
});
