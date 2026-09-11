import { RiderStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RidersController } from './riders.controller.js';

describe('RidersController audit trail', () => {
  it('audits creation without recording rider profile data', async () => {
    const riders = {
      create: vi.fn().mockResolvedValue({
        id: 'rider-1',
        status: RiderStatus.PENDING,
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new RidersController(
      riders as never,
      audit as never,
      { requireTenantId: vi.fn().mockReturnValue('tenant-a') } as never,
    );

    await controller.create(
      { id: 'operator-1', tenantId: 'tenant-a', roles: [] },
      { name: 'Rider Name', mobile: '+919000000001', address: 'Private' },
    );

    expect(audit.record).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      action: 'RIDER_CREATED',
      entityType: 'RIDER',
      entityId: 'rider-1',
      newData: { status: RiderStatus.PENDING },
    });
  });
});
