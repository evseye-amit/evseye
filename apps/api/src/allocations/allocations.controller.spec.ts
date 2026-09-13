import { describe, expect, it, vi } from 'vitest';
import { AllocationsController } from './allocations.controller.js';

describe('AllocationsController audit trail', () => {
  it('records the allocation actor and client after initiation', async () => {
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
      { requireClientId: vi.fn().mockReturnValue('client-a') } as never,
    );

    await expect(
      controller.initiate(
        { id: 'operator-1', clientId: 'client-a', roles: [] },
        { fleetId: 'fleet-1', riderId: 'rider-1' },
        'request-key',
      ),
    ).resolves.toEqual({
      data: { id: 'allocation-1', status: 'INSPECTION_PENDING' },
    });
    expect(audit.record).toHaveBeenCalledWith({
      clientId: 'client-a',
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
