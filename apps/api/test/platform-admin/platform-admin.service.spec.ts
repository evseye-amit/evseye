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

describe('PlatformAdminService client entitlements', () => {
  it('uses one inclusive timestamp for active package and client feature windows', async () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const packageFindMany = vi.fn().mockResolvedValue([]);
      const clientFindMany = vi.fn().mockResolvedValue([]);
      const service = new PlatformAdminService({
        packageFeature: { findMany: packageFindMany },
        clientFeature: { findMany: clientFindMany },
      } as never, {} as never, {} as never, {} as never);
      service.clientDetail = vi.fn().mockResolvedValue({
        id: 'client-1',
        subscriptions: [{ id: 'subscription-1', status: 'ACTIVE', packageId: 'package-1' }],
      }) as never;

      await service.clientEntitlements('client-1');

      const packageQuery = packageFindMany.mock.calls[0]![0];
      expect(packageQuery.where).toEqual({
        packageId: 'package-1', isIncluded: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      });
      expect(packageQuery.include.feature.include.pricing.where).toEqual({
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      });
      expect(clientFindMany.mock.calls[0]![0].where).toEqual({
        clientId: 'client-1', subscriptionId: 'subscription-1', enabled: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
