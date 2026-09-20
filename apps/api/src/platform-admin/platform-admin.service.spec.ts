import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminService } from './platform-admin.service.js';

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
