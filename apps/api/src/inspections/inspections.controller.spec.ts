import { describe, expect, it, vi } from 'vitest';
import { InspectionsController } from './inspections.controller.js';

describe('InspectionsController audit trail', () => {
  it('records inspection completion against the actor and client', async () => {
    const inspections = {
      complete: vi.fn().mockResolvedValue({
        id: 'inspection-1',
        allocationId: 'allocation-1',
        type: 'PRE_ALLOCATION',
        status: 'COMPLETED',
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new InspectionsController(
      inspections as never,
      audit as never,
      { requireClientId: vi.fn().mockReturnValue('client-a') } as never,
    );

    await expect(
      controller.complete(
        { id: 'operator-1', clientId: 'client-a', roles: [] },
        'inspection-1',
      ),
    ).resolves.toEqual({
      data: {
        id: 'inspection-1',
        allocationId: 'allocation-1',
        type: 'PRE_ALLOCATION',
        status: 'COMPLETED',
      },
    });
    expect(audit.record).toHaveBeenCalledWith({
      clientId: 'client-a',
      actorId: 'operator-1',
      action: 'INSPECTION_COMPLETED',
      entityType: 'INSPECTION',
      entityId: 'inspection-1',
      newData: {
        allocationId: 'allocation-1',
        type: 'PRE_ALLOCATION',
        status: 'COMPLETED',
      },
    });
  });
});
