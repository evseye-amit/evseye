import { RiderStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RidersController } from './riders.controller.js';

describe('RidersController audit trail', () => {
  it('audits creation without recording rider profile data', async () => {
    const riders = {
      create: vi.fn().mockResolvedValue({
        id: 'rider-1',
        status: RiderStatus.ONBOARDING,
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new RidersController(
      riders as never,
      audit as never,
      { requireClientId: vi.fn().mockReturnValue('client-a') } as never,
      {} as never,
    );

    await controller.create(
      { id: 'operator-1', clientId: 'client-a', roles: [] },
      { values: { FULL_NAME: 'Rider Name', MOBILE_NUMBER: '+919000000001', ADDRESS: 'Private' } },
    );

    expect(audit.record).toHaveBeenCalledWith({
      clientId: 'client-a',
      actorId: 'operator-1',
      action: 'RIDER_CREATED',
      entityType: 'RIDER',
      entityId: 'rider-1',
      newData: { status: RiderStatus.ONBOARDING },
    });
  });
});
