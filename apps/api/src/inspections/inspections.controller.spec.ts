import { describe, expect, it, vi } from 'vitest';
import { InspectionsController } from './inspections.controller.js';

describe('InspectionsController audit trail', () => {
  it('records inspection completion against the actor and tenant', async () => {
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
      { requireTenantId: vi.fn().mockReturnValue('tenant-a') } as never,
    );

    await expect(
      controller.complete(
        { id: 'operator-1', tenantId: 'tenant-a', roles: [] },
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
      tenantId: 'tenant-a',
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
