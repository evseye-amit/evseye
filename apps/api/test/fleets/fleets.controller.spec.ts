import { FleetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsController } from '../../src/fleets/fleets.controller.js';

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

  it('passes the receipt reason through the client-scoped status route', async () => {
    const fleets = {
      changeStatus: vi.fn().mockResolvedValue({
        id: 'fleet-1',
        status: FleetStatus.PENDING_ACTIVATION,
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const clients = {
      requireClientId: vi.fn().mockReturnValue('client-a'),
    };
    const controller = new FleetsController(
      fleets as never,
      {} as never,
      audit as never,
      clients as never,
    );

    await controller.status(
      { id: 'operator-1', clientId: 'client-a', roles: [] },
      'fleet-1',
      { status: FleetStatus.PENDING_ACTIVATION, reason: 'Fleet received.' },
    );

    expect(fleets.changeStatus).toHaveBeenCalledWith(
      'client-a',
      'fleet-1',
      FleetStatus.PENDING_ACTIVATION,
      'operator-1',
      'Fleet received.',
    );
    expect(clients.requireClientId).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FLEET_STATUS_CHANGED',
        newData: { status: FleetStatus.PENDING_ACTIVATION },
      }),
    );
  });
});
