import { describe, expect, it } from 'vitest';
// @ts-expect-error Seed modules are JavaScript entry points without declarations.
import { featureCatalog } from '../../prisma/catalog/features.mjs';
// @ts-expect-error Seed modules are JavaScript entry points without declarations.
import { packageFeatureCatalog } from '../../prisma/catalog/package-features.mjs';
import { CatalogRevisionService } from './catalog-revision.service.js';

describe('required legal consent seed contract', () => {
  it('defines App Terms separately from rider privacy consent', () => {
    expect(featureCatalog.filter((item: { code: string }) => item.code === 'ACCEPT_APP_TERMS')).toHaveLength(1);
    expect(featureCatalog.find((item: { code: string }) => item.code === 'ACCEPT_APP_TERMS')).toMatchObject({
      category: 'PRE_LOGIN', isActive: true, featureStepCode: 'PRE_LOGIN_CONSENT',
      configuration: { componentType: 'LEGAL_CONSENT', kind: 'TERMS_AND_CONDITIONS', required: true,
        appCodes: ['RIDER', 'FLEET_MANAGER'] },
    });
    expect(featureCatalog.some((item: { code: string }) => item.code === 'ACCEPT_RIDER_PRIVACY_CONSENT')).toBe(true);
  });
  it.each(['BASIC', 'STANDARD', 'PREMIUM', 'CUSTOM'])('allows publishing %s with the seeded consent configuration', async (packageCode) => {
    const assignments = packageFeatureCatalog.filter((item: { packageCode: string; featureCode: string }) =>
      item.packageCode === packageCode && item.featureCode === 'ACCEPT_APP_TERMS');
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ isIncluded: true, includedQuantity: null, resetPeriod: 'NONE' });
    const revision = { id: 'r1', packageId: 'pkg', version: 1, publishedAt: null,
      snapshot: { features: assignments.map((item: { configuration: unknown }) => ({ ...item,
        feature: featureCatalog.find((feature: { code: string }) => feature.code === 'ACCEPT_APP_TERMS') })) } };
    const service = new CatalogRevisionService({ packageRevision: {
      findUnique: async () => revision, findFirst: async () => null, update: async () => ({ ...revision, publishedAt: new Date() }),
    } } as never);
    await expect(service.publishPackage('r1')).resolves.toMatchObject({ id: 'r1' });
  });
});
