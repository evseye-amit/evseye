import { describe, expect, it, vi } from 'vitest';
import { WorkflowResolverService } from './workflow-resolver.service.js';

const feature = (code: string, category: string, configuration: Record<string, unknown> = {}) => ({
  featureId: code, featureRevisionId: `${code}-r1`, featureVersion: 1,
  displayOrder: 1, configuration: null,
  feature: { id: code, code, name: code, category, billingUnit: 'LIFE_TIME',
    isActive: true, configuration, step: { id: 'step-1', code: 'PRE_LOGIN_CONSENT',
      name: 'Terms', order: 1, parentCode: 'PRE_LOGIN' } },
});

describe('WorkflowResolverService', () => {
  it('reads pinned immutable Package content and a published client override', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'package-hash', snapshot: { id: 'pkg-1', code: 'BASIC', name: 'Basic',
            features: [feature('ACCEPT_APP_TERMS', 'PRE_LOGIN', {
              componentType: 'LEGAL_CONSENT', appCodes: ['RIDER', 'FLEET_MANAGER'] })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue({ id: 'client-r1',
        contentHash: 'client-hash', snapshot: { packageRevisionId: 'pkg-r1', overrides: [
          { featureId: 'ACCEPT_APP_TERMS', enabled: true,
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
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'PRE_LOGIN', 'FLEET_MANAGER');
    expect(result.components).toEqual([]);
  });

  it('keeps package-included language selection visible despite a stale client override', async () => {
    const prisma = {
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', packageId: 'pkg-1', packageRevisionId: 'pkg-r1',
        packageRevision: { id: 'pkg-r1', version: 1, publishedAt: new Date(),
          contentHash: 'package-hash', snapshot: { features: [feature('SELECT_APP_LANGUAGE', 'PRE_LOGIN', {
            componentType: 'LANGUAGE_SELECTOR', appCodes: ['RIDER', 'FLEET_MANAGER'] })] } },
      }) },
      clientWorkflowRevision: { findFirst: vi.fn().mockResolvedValue({ id: 'client-r1',
        contentHash: 'client-hash', snapshot: { overrides: [
          { featureId: 'SELECT_APP_LANGUAGE', enabled: false, configuration: { enabled: false } },
        ] } }) },
    };
    const result = await new WorkflowResolverService(prisma as never)
      .resolve('client-1', 'PRE_LOGIN', 'RIDER');
    expect(result.components.map((part) => part.featureCode)).toEqual(['SELECT_APP_LANGUAGE']);
  });
});
