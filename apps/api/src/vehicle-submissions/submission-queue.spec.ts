import { describe, expect, it, vi } from 'vitest';
import { VehicleSubmissionService } from './submission.service.js';

const actor = { id: 'manager-1', clientId: 'client-1', roles: ['FLEET_MANAGER'] } as const;
const fleet = { id: 'fleet-old', fleetCode: 'SCOOTER-01', vehicleNumber: 'DL01AB1234', chassisNumber: 'CHASSIS-01', modelName: '450X', oem: { id: 'oem-1', name: 'Ather' } };
function setup(rows: unknown[]) {
  const db = {
    userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
    rentalTerminationRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn().mockResolvedValue(rows.length) },
    vehicleExchangeRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn().mockResolvedValue(rows.length) },
    rider: { findMany: vi.fn().mockResolvedValue([{ id: 'rider-1', name: 'Rider' }]) },
    fleet: { findMany: vi.fn().mockResolvedValue([fleet]) },
  };
  return { db, service: new VehicleSubmissionService(db as never, {} as never, {} as never, {} as never) };
}

describe('Submission queue fleet details', () => {
  it('returns the allocation scooter before intake and preserves pagination', async () => {
    const { db, service } = setup([{ id: 'return-1', riderId: 'rider-1', allocation: { fleetId: fleet.id }, vehicleSubmission: null }]);
    const result = await service.queue('client-1', { ...actor, roles: [...actor.roles] }, 'RETURN', 'SCHEDULED', 2, 10);
    expect(result).toMatchObject({ data: [{ fleet, rider: { name: 'Rider' } }], meta: { page: 2, limit: 10, total: 1 } });
    expect(result.data[0]).not.toHaveProperty('allocation');
    expect(db.fleet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-1', id: { in: [fleet.id] } } }));
    expect(db.rentalTerminationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, include: expect.objectContaining({ allocation: { select: { fleetId: true } } }) }));
  });
  it('keeps the submitted scooter for completed returns', async () => {
    const { service } = setup([{ id: 'return-1', riderId: 'rider-1', allocation: null, vehicleSubmission: { fleetId: fleet.id, status: 'CONFIRMED' } }]);
    const result = await service.queue('client-1', { ...actor, roles: [...actor.roles] }, 'RETURN', 'ALL', 1, 20);
    expect(result.data[0]).toMatchObject({ fleet, vehicleSubmission: { status: 'CONFIRMED' } });
  });
  it('returns the outgoing exchange scooter, not its replacement', async () => {
    const { db, service } = setup([{ id: 'exchange-1', riderId: 'rider-1', oldVehicleId: fleet.id, replacementVehicleId: 'fleet-new', vehicleSubmission: null }]);
    const result = await service.queue('client-1', { ...actor, roles: [...actor.roles] }, 'EXCHANGE', 'ALL', 1, 20);
    expect(result.data[0]).toMatchObject({ source: 'EXCHANGE', fleet });
    expect(db.fleet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-1', id: { in: [fleet.id] } } }));
  });
  it('returns null if a historical request has no linked vehicle', async () => {
    const { db, service } = setup([{ id: 'return-1', riderId: 'rider-1', allocation: null, vehicleSubmission: null }]);
    const result = await service.queue('client-1', { ...actor, roles: [...actor.roles] }, 'RETURN', 'ALL', 1, 20);
    expect(result.data[0]).toMatchObject({ fleet: null });
    expect(db.fleet.findMany).not.toHaveBeenCalled();
  });
});
