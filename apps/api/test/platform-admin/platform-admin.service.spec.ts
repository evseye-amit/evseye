import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminService } from '../../src/platform-admin/platform-admin.service.js';

describe('PlatformAdminService client detail', () => {
  it('loads subscriptions through their package without the removed feature relation', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'client-1',
      branding: null,
      businessProfile: null,
      subscriptions: [],
    });
    const service = new PlatformAdminService(
      { client: { findUnique } } as never,
      {} as never,
      { createDownloadUrl: vi.fn() } as never,
      {} as never,
    );

    await service.clientDetail('client-1');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          subscriptions: {
            include: { package: true },
            orderBy: { createdAt: 'desc' },
          },
        }),
      }),
    );
  });
});

describe('PlatformAdminService client languages', () => {
  it('stores onboarding languages as an unpublished Feature override', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({});
    const prisma = {
      package: { findFirst: vi.fn().mockResolvedValue({ id: 'package-1', code: 'BASIC' }) },
      clientOperationsProfile: { findUnique: vi.fn().mockResolvedValue({ numberOfFleets: 2 }) },
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ requestedLocales: ['en', 'hi'] }) },
      packageRevision: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'package-r1', snapshot: {
        features: [{ featureId: 'language-feature', feature: { code: 'SELECT_APP_LANGUAGE' } }],
      } }) },
      clientWorkflowRevision: { create: createWorkflow },
    };
    const service = new PlatformAdminService(prisma as never,
      { record: vi.fn() } as never, {} as never, {} as never,
      { createSubscription: vi.fn().mockResolvedValue({ id: 'subscription-1', packageRevisionId: 'package-r1' }) } as never);
    (service as never as { requireEditableClient: unknown }).requireEditableClient = vi.fn().mockResolvedValue({ status: 'DRAFT' });
    service.clientDetail = vi.fn().mockResolvedValue({}) as never;
    await service.savePackageSelection('client-1', { packageId: 'package-1', billingCycle: 'MONTHLY',
      startDate: '2026-10-13', autoRenew: true } as never, 'admin-1');
    expect(createWorkflow).toHaveBeenCalledWith({ data: expect.objectContaining({
      subscriptionId: 'subscription-1',
      snapshot: expect.objectContaining({ overrides: [{ featureId: 'language-feature', enabled: true,
        configuration: { supportedLocales: ['en', 'hi'] } }] }),
    }) });
  });
});
