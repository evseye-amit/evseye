import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminService } from '../../src/platform-admin/platform-admin.service.js';

describe('client feature revisions', () => {
  it('persists the edited draft snapshot instead of rebuilding package defaults', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'draft-2', version: 2, snapshot: [] });
    const service = new PlatformAdminService({
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
      clientFeatureRevision: { findFirst: vi.fn().mockResolvedValue({ version: 1, publishedAt: new Date(), snapshot: [] }), create },
    } as never, { record: vi.fn() } as never, {} as never, {} as never);
    (service as never as { requireClientSubscription: () => Promise<unknown> }).requireClientSubscription = vi.fn().mockResolvedValue({ id: 'sub-1' });
    (service as never as { clientEntitlements: () => Promise<unknown> }).clientEntitlements = vi.fn().mockResolvedValue({ packageFeatures: [{ featureId: 'keep' }, { featureId: 'disable' }] });

    await service.createClientFeatureDraft('client-1', 'actor-1', [
      { featureId: 'keep', enabled: true, source: 'PACKAGE' },
      { featureId: 'disable', enabled: false, source: 'CUSTOM' },
    ]);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ snapshot: [
      { featureId: 'keep', enabled: true, source: 'PACKAGE', configuration: null },
      { featureId: 'disable', enabled: false, source: 'CUSTOM', configuration: null },
    ] }) }));
  });

  it('rejects a draft that omits a package feature', async () => {
    const service = new PlatformAdminService({
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
      clientFeatureRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never, {} as never, {} as never, {} as never);
    (service as never as { requireClientSubscription: () => Promise<unknown> }).requireClientSubscription = vi.fn().mockResolvedValue({ id: 'sub-1' });
    (service as never as { clientEntitlements: () => Promise<unknown> }).clientEntitlements = vi.fn().mockResolvedValue({ packageFeatures: [{ featureId: 'required' }] });

    await expect(service.createClientFeatureDraft('client-1', 'actor-1', [])).rejects.toThrow('every package feature');
  });
});
