import { FleetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AllocationsService } from './allocations.service.js';

describe('AllocationsService concurrency guard', () => {
  it('uses a conditional AVAILABLE fleet update to prevent double allocation', async () => {
    const tx = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      fleet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      allocation: { create: vi.fn() },
      inspection: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) };
    const service = new AllocationsService(prisma as never);

    await expect(service.initiate('tenant-a', 'fleet-busy', 'rider-1', 'operator-1')).rejects.toThrow(
      'Fleet is not available',
    );
    expect(tx.fleet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a', status: FleetStatus.AVAILABLE }),
        data: { status: FleetStatus.RESERVED },
      }),
    );
  });
});
