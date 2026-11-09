import { describe, expect, it, vi } from 'vitest';
import { WorkflowResolverService } from '../../src/workflow/workflow-resolver.service.js';

const feature = (code: string, category: string, configuration: Record<string, unknown> = {}) => ({
  featureId: code, featureRevisionId: `${code}-r1`, featureVersion: 1,
  displayOrder: 1, configuration: null,
  feature: { id: code, code, name: code, category, billingUnit: 'LIFE_TIME',
    isActive: true, configuration, step: { id: 'step-1', code: 'PRE_LOGIN_LANGUAGE',
      name: 'Terms', order: 1, parentCode: 'PRE_LOGIN' } },
});

describe('WorkflowResolverService', () => {
  function resolverFixture(options: {
    packageConfiguration?: Record<string, unknown>;
    clientConfiguration?: Record<string, unknown> | null;
    workflowOverride?: Record<string, unknown>;
    secondFeature?: boolean;
  } = {}) {
    const first = feature('SHOW_AGREEMENT_E_SIGN', 'RIDER_ONBOARDING', options.packageConfiguration ?? {
      componentType: 'LEGAL_CONSENT', fieldCode: 'AGREEMENT_E_SIGN', storageKey: 'agreementEsign',
    });
    const second = feature('CAPTURE_DATE_OF_BIRTH', 'RIDER_ONBOARDING', { componentType: 'TEXT' });
    second.displayOrder = 2;
    const packageFeatures = options.secondFeature === false ? [first] : [first, second];
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({ id: 'sub-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(), snapshot: { features: packageFeatures } } }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(options.workflowOverride ? {
        snapshot: { packageRevisionId: 'pkg-r1', overrides: [options.workflowOverride] },
      } : null) },
      clientFeature: { findMany: vi.fn().mockResolvedValue(options.clientConfiguration === undefined ? [] : [{
        featureId: 'SHOW_AGREEMENT_E_SIGN', enabled: true, configuration: options.clientConfiguration,
      }]) },
      feature: { findMany: vi.fn().mockResolvedValue(packageFeatures.map((item) => ({ id: item.featureId,
        name: item.feature.code, configuration: item.feature.configuration, translations: {} }))) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new WorkflowResolverService(prisma as never) };
  }

  it('covers package, client, and workflow precedence including removed client fields', async () => {
    const packageOnly = resolverFixture({ clientConfiguration: undefined });
    const packageResult = await packageOnly.service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(packageResult.components[0].configuration).toHaveProperty('fieldCode');

    const clientOnly = resolverFixture({ clientConfiguration: { componentType: 'LEGAL_CONSENT', label: 'Client' } });
    const clientResult = await clientOnly.service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(clientResult.components[0].configuration).toEqual({ componentType: 'LEGAL_CONSENT', label: 'Client' });
    expect(clientResult.components[0].configuration).not.toHaveProperty('fieldCode');
    expect(clientResult.components[0].configuration).not.toHaveProperty('storageKey');

    const combined = resolverFixture({ clientConfiguration: { componentType: 'LEGAL_CONSENT', label: 'Yogmaya' },
      workflowOverride: { featureId: 'SHOW_AGREEMENT_E_SIGN', displayOrder: 9, enabled: true, configuration: {} } });
    const combinedResult = await combined.service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    const consent = combinedResult.components.find((item) => item.featureName === 'SHOW_AGREEMENT_E_SIGN');
    expect(consent?.order).toBe(9);
    expect(consent?.configuration).toEqual({ componentType: 'LEGAL_CONSENT', label: 'Yogmaya' });

    const disabled = resolverFixture({ clientConfiguration: { componentType: 'LEGAL_CONSENT' },
      workflowOverride: { featureId: 'SHOW_AGREEMENT_E_SIGN', enabled: false, configuration: {} } });
    await expect(disabled.service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER')).resolves.toMatchObject({ components: [expect.objectContaining({ featureName: 'CAPTURE_DATE_OF_BIRTH' })] });
  });

  it('supports empty workflow configuration and falls back to package configuration', async () => {
    const fixtureWithEmpty = resolverFixture({ workflowOverride: { featureId: 'SHOW_AGREEMENT_E_SIGN', enabled: true, configuration: {} } });
    const result = await fixtureWithEmpty.service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(result.components[0].configuration).toHaveProperty('fieldCode');
  });

  it('sorts by workflow display order before feature order', async () => {
    const { service } = resolverFixture({ secondFeature: true,
      workflowOverride: { featureId: 'SHOW_AGREEMENT_E_SIGN', enabled: true, displayOrder: 0, configuration: {} } });
    const result = await service.resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(result.components.map((item) => item.featureName)).toEqual(['SHOW_AGREEMENT_E_SIGN', 'CAPTURE_DATE_OF_BIRTH']);
  });

  it('uses a pending subscription for LOGIN only, never for other workflow categories', async () => {
    const subscription = {
      id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
      startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: null,
      packageRevision: {
        id: 'pkg-r1', version: 1, publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        contentHash: 'hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic', features: [] },
      },
    };
    const findFirst = vi.fn().mockImplementation(({ where }: { where: { status: unknown } }) =>
      where.status === 'ACTIVE' ? null : subscription);
    const prisma = {
      clientSubscription: { findFirst },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new WorkflowResolverService(prisma as never);

    await expect(service.resolve('client-1', 'LOGIN', 'CLIENT_PANEL')).resolves.toMatchObject({ packageVersion: 1 });
    expect(findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['ACTIVE', 'PENDING'] } }),
    }));

    await expect(service.resolve('client-1', 'PRE_LOGIN', 'RIDER')).rejects.toThrow('Published workflow is unavailable');
    expect(findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: 'ACTIVE' }),
    }));
  });

  it('reads pinned immutable Package content and a published client override', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'package-hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('ACCEPT_RIDER_PRIVACY_CONSENT', 'PRE_LOGIN', {
              componentType: 'LEGAL_CONSENT', appCodes: ['RIDER', 'FLEET_MANAGER'] })] } },
      }) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
      feature: { findMany: vi.fn().mockResolvedValue([]) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue({ id: 'client-r1',
        contentHash: 'client-hash', snapshot: { packageRevisionId: 'pkg-r1', overrides: [
          { featureId: 'ACCEPT_RIDER_PRIVACY_CONSENT', enabled: true,
            configuration: { componentType: 'LEGAL_CONSENT', appCodes: ['RIDER', 'FLEET_MANAGER'], displayTitle: 'Review terms' } },
        ] } }) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'PRE_LOGIN', 'RIDER');
    expect(result.packageVersion).toBe(1);
    expect(result.clientRevisionId).toBe('client-r1');
    expect(result.components[0].configuration.displayTitle).toBe('Review terms');
    expect(result.components[0].componentType).toBe('LEGAL_CONSENT');
    expect(result.version).toMatch(/^[a-f0-9]{16}$/);
    expect(prisma.clientSubscription.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each([
    { scenario: 'published client revision', source: 'revision', config: { editable: false, required: false, importable: true } },
    { scenario: 'effective client feature', source: 'row', config: { validation: { length: 6 }, translations: { hi: { label: 'Client' } } } },
    { scenario: 'empty client configuration', source: 'row', config: {} },
    { scenario: 'null client configuration', source: 'row', config: null },
  ])('resolves $scenario with the correct configuration', async ({ source, config }) => {
    const code = 'SHOW_AGREEMENT_E_SIGN';
    const base = {
      fieldCode: 'AGREEMENT_E_SIGN',
      storageKey: 'agreementEsign',
      placeholder: 'Pinned placeholder',
      validation: { pattern: 'base' },
      translations: { en: { label: 'Base', translationStatus: 'ACTIVE' } },
    };
    const override = { featureId: code, enabled: true, configuration: config };
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          snapshot: { id: 'pkg-1', features: [feature(code, 'RIDER_ONBOARDING', base)] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(source === 'revision'
        ? { snapshot: { packageRevisionId: 'pkg-r1', overrides: [override] } }
        : null) },
      clientFeature: { findMany: vi.fn().mockResolvedValue(source === 'row' ? [override] : []) },
      feature: { findMany: vi.fn().mockResolvedValue([{
        id: code, name: 'E-Sign the agreement', configuration: { placeholder: 'Current placeholder' },
        translations: { en: { label: 'Catalog' } },
      }]) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new WorkflowResolverService(prisma as never)
      .resolve('yogmaya', 'RIDER_ONBOARDING', 'RIDER');

    expect(result.components[0].featureName).toBe('E-Sign the agreement');
    expect(result.components[0].configuration).toMatchObject(source === 'revision' ? base : (config ?? {
      ...base, placeholder: 'Current placeholder',
    }));
  });

  it('keeps client feature configuration when workflow only changes display order', async () => {
    const code = 'SHOW_AGREEMENT_E_SIGN';
    const clientConfiguration = { componentType: 'LEGAL_CONSENT', label: 'Yogmaya consent' };
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          snapshot: { id: 'pkg-1', features: [feature(code, 'RIDER_ONBOARDING', {
            componentType: 'LEGAL_CONSENT', fieldCode: 'AGREEMENT_E_SIGN', storageKey: 'agreementEsign',
          })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue({
        id: 'workflow-r1', contentHash: 'workflow-hash', snapshot: { packageRevisionId: 'pkg-r1', overrides: [
          { featureId: code, enabled: true, displayOrder: 42, configuration: {} },
        ] },
      }) },
      clientFeature: { findMany: vi.fn().mockResolvedValue([{
        featureId: code, enabled: true, configuration: clientConfiguration,
      }]) },
      feature: { findMany: vi.fn().mockResolvedValue([{
        id: code, name: 'E-Sign the agreement', description: null, configuration: {
          fieldCode: 'AGREEMENT_E_SIGN', storageKey: 'agreementEsign', placeholder: 'Catalog placeholder',
        }, translations: {},
      }]) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new WorkflowResolverService(prisma as never)
      .resolve('yogmaya', 'RIDER_ONBOARDING', 'RIDER');

    expect(result.components[0].order).toBe(42);
    expect(result.components[0].configuration).toEqual(clientConfiguration);
    expect(result.components[0].configuration).not.toHaveProperty('fieldCode');
    expect(result.components[0].configuration).not.toHaveProperty('storageKey');
  });

  it('does not include another app scoped Feature', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('SHOW_APP_INTRO', 'PRE_LOGIN', {
              componentType: 'INTRO_CAROUSEL', appCodes: ['RIDER'] })] } },
      }) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
      feature: { findMany: vi.fn().mockResolvedValue([]) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'PRE_LOGIN', 'FLEET_MANAGER');
    expect(result.components).toEqual([]);
  });

  it('uses current step translations without changing the pinned workflow structure', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('SELECT_APP_LANGUAGE', 'PRE_LOGIN')] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
      feature: { findMany: vi.fn().mockResolvedValue([]) },
      featureStep: { findMany: vi.fn().mockResolvedValue([{ code: 'PRE_LOGIN_LANGUAGE',
        displayName: 'Language', description: 'Choose a language.',
        translations: { as: { displayName: 'ভাষা', description: 'এটা ভাষা বাছনি কৰক।', translationStatus: 'ACTIVE' } },
      }]) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'PRE_LOGIN', 'RIDER');
    expect(result.components[0].step.translations).toMatchObject({
      as: { displayName: 'ভাষা', translationStatus: 'ACTIVE' },
    });
    expect(result.components[0].step.order).toBe(1);
    expect(prisma.featureStep.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['PRE_LOGIN_LANGUAGE'] } },
      select: { code: true, displayName: true, description: true, translations: true },
    });
  });

  it('uses current Feature copy and translations with the published workflow', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('CAPTURE_NAME', 'RIDER_ONBOARDING', {
              label: 'Name', placeholder: 'Pinned name placeholder',
            })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
      feature: { findMany: vi.fn().mockResolvedValue([{ id: 'CAPTURE_NAME', name: 'Capture name',
        description: 'Enter your name', configuration: { placeholder: 'Current name placeholder' },
        translations: { hi: { name: 'नाम', label: 'पूरा नाम',
          translationStatus: 'ACTIVE' } } }]) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(result.components[0].featureName).toBe('Capture name');
    expect(result.components[0].configuration.placeholder).toBe('Current name placeholder');
    expect(result.components[0].configuration.translations).toMatchObject({
      hi: { label: 'पूरा नाम', translationStatus: 'ACTIVE' },
    });
  });

  it('keeps a client placeholder override instead of the live Feature placeholder', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('CAPTURE_NAME', 'RIDER_ONBOARDING', {
              label: 'Name', placeholder: 'Pinned name placeholder',
            })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue({ id: 'client-r1',
        contentHash: 'client-hash', snapshot: { packageRevisionId: 'pkg-r1', overrides: [{
          featureId: 'CAPTURE_NAME', enabled: true,
          configuration: { placeholder: 'Client name placeholder' },
        }] } }) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
      feature: { findMany: vi.fn().mockResolvedValue([{ id: 'CAPTURE_NAME', name: 'Capture name',
        description: 'Enter your name', configuration: { placeholder: 'Current name placeholder' },
        translations: {} }]) },
    };

    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');

    expect(result.components[0].configuration.placeholder).toBe('Client name placeholder');
  });
});
