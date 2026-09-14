import { FleetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsController } from './fleets.controller.js';

describe('FleetsController audit trail', () => {
  it('records a fleet status transition for the client actor', async () => {
    const fleets = {
      changeStatus: vi.fn().mockResolvedValue({
        id: 'fleet-1',
        status: FleetStatus.MAINTENANCE,
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new FleetsController(
      fleets as never,
      {} as never,
      audit as never,
      { requireClientId: vi.fn().mockReturnValue('client-a') } as never,
    );

    await controller.status(
      { id: 'operator-1', clientId: 'client-a', roles: [] },
      'fleet-1',
      { status: FleetStatus.MAINTENANCE },
    );

    expect(audit.record).toHaveBeenCalledWith({
      clientId: 'client-a',
      actorId: 'operator-1',
      action: 'FLEET_STATUS_CHANGED',
      entityType: 'FLEET',
      entityId: 'fleet-1',
      newData: { status: FleetStatus.MAINTENANCE },
    });
  });
});
