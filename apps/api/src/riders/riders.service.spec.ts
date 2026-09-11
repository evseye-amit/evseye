import { describe, expect, it, vi } from 'vitest';
import { RidersService } from './riders.service.js';

describe('RidersService tenant isolation', () => {
  it('looks up a rider with both its ID and the authenticated tenant ID', async () => {
    const prisma = {
      rider: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new RidersService(prisma as never);

    await expect(service.getById('tenant-a', 'rider-owned-by-tenant-b')).rejects.toThrow(
      'Rider not found',
    );
    expect(prisma.rider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rider-owned-by-tenant-b', tenantId: 'tenant-a', deletedAt: null },
      }),
    );
  });
});
