import { describe, expect, it, vi } from 'vitest';
import { AllocationsController } from './allocations.controller.js';

describe('AllocationsController audit trail', () => {
  it('records the allocation actor and tenant after initiation', async () => {
    const allocations = {
      initiate: vi.fn().mockResolvedValue({
        id: 'allocation-1',
        status: 'INSPECTION_PENDING',
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new AllocationsController(
      allocations as never,
      {} as never,
      audit as never,
      { requireTenantId: vi.fn().mockReturnValue('tenant-a') } as never,
    );

    await expect(
      controller.initiate(
        { id: 'operator-1', tenantId: 'tenant-a', roles: [] },
        'fleet-1',
        'rider-1',
        'request-key',
      ),
    ).resolves.toEqual({
      data: { id: 'allocation-1', status: 'INSPECTION_PENDING' },
    });
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      action: 'ALLOCATION_INITIATED',
      entityType: 'ALLOCATION',
      entityId: 'allocation-1',
      newData: {
        fleetId: 'fleet-1',
        riderId: 'rider-1',
        status: 'INSPECTION_PENDING',
      },
    });
  });
});
