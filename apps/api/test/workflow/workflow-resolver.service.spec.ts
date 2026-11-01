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
            configuration: { displayTitle: 'Review terms' } },
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
            features: [feature('CAPTURE_NAME', 'RIDER_ONBOARDING', { label: 'Name' })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
      featureStep: { findMany: vi.fn().mockResolvedValue([]) },
      feature: { findMany: vi.fn().mockResolvedValue([{ id: 'CAPTURE_NAME', name: 'Capture name',
        description: 'Enter your name', translations: { hi: { name: 'नाम', label: 'पूरा नाम',
          translationStatus: 'ACTIVE' } } }]) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'RIDER_ONBOARDING', 'RIDER');
    expect(result.components[0].featureName).toBe('Capture name');
    expect(result.components[0].configuration.translations).toMatchObject({
      hi: { label: 'पूरा नाम', translationStatus: 'ACTIVE' },
    });
  });
});
