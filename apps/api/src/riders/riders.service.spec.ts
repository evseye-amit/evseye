import { describe, expect, it, vi } from 'vitest';
import { RidersService } from './riders.service.js';

describe('RidersService client isolation', () => {
  it('looks up a rider with both its ID and the authenticated client ID', async () => {
    const prisma = {
      rider: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new RidersService(prisma as never);

    await expect(
      service.getById('client-a', 'rider-owned-by-client-b'),
    ).rejects.toThrow('Rider not found');
    expect(prisma.rider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rider-owned-by-client-b',
          clientId: 'client-a',
          deletedAt: null,
        },
      }),
    );
  });
});
