import { UserRole } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import { CreateRideReturnDto } from '../../src/ride-returns/dto/ride-return.dto.js';
import { RideReturnsService } from '../../src/ride-returns/ride-returns.service.js';
import { VehicleSubmissionService } from '../../src/vehicle-submissions/submission.service.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

const ops: AuthUser = { id: 'ops-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] };
const riderUser: AuthUser = { id: 'rider-user-1', clientId: 'client-a', roles: [UserRole.RIDER] };

function setup() {
  const tx = {
    vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    riderRentalAgreement: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    riderRentalAgreementStatusHistory: { create: vi.fn() },
    rentalTerminationRequest: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    allocation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    fleet: { update: vi.fn() },
    otpRequest: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    riderRentalAgreement: { findFirst: vi.fn() },
    rider: { findFirst: vi.fn() },
    allocation: { findFirst: vi.fn() },
    rentalTerminationRequest: { findFirst: vi.fn(), findMany: vi.fn() },
    hub: { findFirst: vi.fn() },
    userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const service = new RideReturnsService(db as never);
  return { db, tx, service };
}

describe('RideReturnsService rider response shape', () => {
  it('returns submission details without legacy direct-penalty relations', async () => {
    const context = setup();
    const row = { id: 'return-1' };
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.rentalTerminationRequest.findMany.mockResolvedValue([]);
    context.db.rentalTerminationRequest.findFirst.mockResolvedValue(row);

    await context.service.riderList('client-a', riderUser, {});
    await context.service.riderGet('client-a', riderUser, row.id);

    expect(context.db.rentalTerminationRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { vehicleSubmission: true } }),
    );
    expect(context.db.rentalTerminationRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id, clientId: 'client-a', riderId: 'rider-1' },
        include: { vehicleSubmission: true },
      }),
    );
  });
});

describe('RideReturnsService request reason boundary', () => {
  const input = (reasonCode: unknown) => ({
    riderId: 'rider-1',
    reasonCode,
    plannedHubId: 'hub-1',
    plannedReturnDate: '2026-10-13T08:00:00.000Z',
  }) as never;

  const invalidReasons: ReadonlyArray<[string, unknown]> = [
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['empty', ''],
    ['whitespace', '   '],
  ];

  it.each(invalidReasons)('rejects %s from the shared request boundary', async (_label, reasonCode) => {
    const { service } = setup();
    await expect(service.request('client-a', ops, input(reasonCode), 'key-123456', 'STAFF'))
      .rejects.toThrow('A return reason is required.');
  });

  it('trims a valid reason and returns the same row on an idempotent retry', async () => {
    const context = setup();
    const created = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-1',
      riderId: 'rider-1',
      status: 'REQUESTED',
      idempotencyKey: 'key-123456',
      requestedTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
      reasonCode: 'VEHICLE_RETURN',
      reasonText: null,
      plannedHubId: 'hub-1',
    };
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.allocation.findFirst.mockResolvedValue({ fleet: { currentHubId: 'hub-1' } });
    context.tx.riderRentalAgreement.findMany.mockResolvedValue([{
      id: 'agreement-1',
      riderId: 'rider-1',
      status: 'ACTIVE',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    }]);
    context.tx.allocation.findMany.mockResolvedValue([{ id: 'allocation-1', fleetId: 'fleet-1', rentalAgreementId: 'agreement-1', fleet: { currentHubId: 'hub-1' } }]);
    context.tx.rentalTerminationRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    context.tx.rentalTerminationRequest.create.mockResolvedValue(created);
    context.tx.auditLog.create.mockResolvedValue({});

    await expect(context.service.request('client-a', ops, input('  VEHICLE_RETURN  '), 'key-123456', 'STAFF'))
      .resolves.toBe(created);
    await expect(context.service.request('client-a', ops, input('VEHICLE_RETURN'), 'key-123456', 'STAFF'))
      .resolves.toBe(created);

    expect(context.tx.rentalTerminationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reasonCode: 'VEHICLE_RETURN' }),
    }));
    expect(context.tx.rentalTerminationRequest.create).toHaveBeenCalledOnce();
  });
});

describe('RideReturnsService request rental resolution', () => {
  const modernInput = (riderId?: string): CreateRideReturnDto => ({
    ...(riderId ? { riderId } : {}),
    reasonCode: 'VEHICLE_RETURN',
    plannedHubId: 'hub-1',
    plannedReturnDate: '2026-10-13T08:00:00.000Z',
  });

  const agreement = (id: string, status: string, fleetId: string) => ({
    id,
    clientId: 'client-a',
    riderId: 'rider-1',
    status,
    currentVehicleId: fleetId,
    vehicleId: fleetId,
  });

  const allocation = (id: string, fleetId: string) => ({
    id,
    rentalAgreementId: fleetId.replace('fleet-', 'agreement-'),
    clientId: 'client-a',
    riderId: 'rider-1',
    status: 'ACTIVE',
    fleetId,
    fleet: { currentHubId: 'hub-1' },
  });

  function prepare(
    context: ReturnType<typeof setup>,
    agreements: Record<string, unknown>[],
    allocations: Record<string, unknown>[],
  ) {
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.riderRentalAgreement.findMany.mockResolvedValue(agreements);
    context.tx.allocation.findMany.mockResolvedValue(allocations);
    context.tx.rentalTerminationRequest.findUnique.mockResolvedValue(null);
    context.tx.rentalTerminationRequest.create.mockResolvedValue({
      id: 'return-1',
      clientId: 'client-a',
      agreementId: agreements[0]?.id,
      riderId: 'rider-1',
      allocationId: allocations[0]?.id,
      status: 'REQUESTED',
      idempotencyKey: 'key-123456',
      requestedTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
      reasonCode: 'VEHICLE_RETURN',
      reasonText: null,
      plannedHubId: 'hub-1',
    });
    context.tx.auditLog.create.mockResolvedValue({});
  }

  it('allows staff and rider requests without an agreementId and resolves one eligible rental', async () => {
    const staff = setup();
    prepare(staff, [agreement('agreement-1', 'ACTIVE', 'fleet-1')], [allocation('allocation-1', 'fleet-1')]);
    await expect(staff.service.request('client-a', ops, modernInput('rider-1'), 'key-staff-1', 'STAFF'))
      .resolves.toMatchObject({ agreementId: 'agreement-1', allocationId: 'allocation-1' });

    const rider = setup();
    prepare(rider, [agreement('agreement-2', 'SUSPENDED', 'fleet-2')], [allocation('allocation-2', 'fleet-2')]);
    await expect(rider.service.request('client-a', riderUser, modernInput(), 'key-rider-1', 'RIDER'))
      .resolves.toMatchObject({ agreementId: 'agreement-2', allocationId: 'allocation-2' });
  });

  it.each(['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'])(
    'accepts an eligible %s rental status without a caller agreementId',
    async (status) => {
      const context = setup();
      prepare(context, [agreement('agreement-1', status, 'fleet-1')], [allocation('allocation-1', 'fleet-1')]);
      await expect(context.service.request('client-a', ops, modernInput('rider-1'), `key-${status}`, 'STAFF'))
        .resolves.toMatchObject({ agreementId: 'agreement-1' });
    },
  );

  it('rejects when the rider has no eligible rental with an active allocation', async () => {
    const context = setup();
    prepare(context, [], []);
    await expect(context.service.request('client-a', ops, modernInput('rider-1'), 'key-none-1', 'STAFF'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ACTIVE_ALLOCATION_REQUIRED', message: 'You do not have an active scooter allocation to return.' }) });
    expect(context.tx.rentalTerminationRequest.create).not.toHaveBeenCalled();
  });

  it('rejects ambiguous eligible rentals instead of choosing one', async () => {
    const context = setup();
    prepare(
      context,
      [agreement('agreement-1', 'ACTIVE', 'fleet-1'), agreement('agreement-2', 'TERMINATION_PENDING', 'fleet-2')],
      [allocation('allocation-1', 'fleet-1'), allocation('allocation-2', 'fleet-2')],
    );
    await expect(context.service.request('client-a', ops, modernInput('rider-1'), 'key-many-1', 'STAFF'))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MULTIPLE_ACTIVE_RENTALS',
          message: 'Multiple active rentals prevent automatic resolution.',
        }),
      });
    expect(context.tx.rentalTerminationRequest.create).not.toHaveBeenCalled();
  });

  it('replays the same key after receipt before resolving a current rental', async () => {
    const context = setup();
    const returned = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-old',
      riderId: 'rider-1',
      allocationId: 'allocation-old',
      status: 'RETURNED',
      idempotencyKey: 'key-receipt-1',
      requestedTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
      reasonCode: 'VEHICLE_RETURN',
      reasonText: null,
      plannedHubId: 'hub-1',
    };
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.rentalTerminationRequest.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(Object.hasOwn(where, 'clientId_idempotencyKey') ? returned : null));
    context.tx.allocation.findFirst.mockResolvedValue({ fleet: { currentHubId: 'hub-1' } });

    await expect(context.service.request('client-a', ops, modernInput('rider-1'), 'key-receipt-1', 'STAFF'))
      .resolves.toBe(returned);
    expect(context.tx.riderRentalAgreement.findMany).not.toHaveBeenCalled();
    expect(context.tx.allocation.findMany).not.toHaveBeenCalled();
    expect(context.tx.rentalTerminationRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a same-key retry when the request body does not match', async () => {
    const context = setup();
    const existing = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-old',
      riderId: 'rider-1',
      allocationId: 'allocation-old',
      status: 'REQUESTED',
      idempotencyKey: 'key-body-1',
      requestedTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
      reasonCode: 'VEHICLE_RETURN',
      reasonText: null,
      plannedHubId: 'hub-1',
    };
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.rentalTerminationRequest.findUnique.mockResolvedValue(existing);

    await expect(context.service.request(
      'client-a',
      ops,
      { ...modernInput('rider-1'), reasonCode: 'MOVING' },
      'key-body-1',
      'STAFF',
    )).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RETURN_ALREADY_REQUESTED' }) });
    expect(context.tx.riderRentalAgreement.findMany).not.toHaveBeenCalled();
    expect(context.tx.allocation.findMany).not.toHaveBeenCalled();
  });

  it('reopens a cancelled retry against its original agreement after the vehicle changes', async () => {
    const context = setup();
    const cancelled = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-old',
      riderId: 'rider-1',
      allocationId: 'allocation-old',
      status: 'CANCELLED',
      idempotencyKey: 'key-cancelled-1',
      requestedTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
      reasonCode: 'VEHICLE_RETURN',
      reasonText: null,
      plannedHubId: 'hub-1',
    };
    const oldAgreement = agreement('agreement-old', 'ACTIVE', 'fleet-old');
    const newAgreement = agreement('agreement-new', 'ACTIVE', 'fleet-new');
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.rentalTerminationRequest.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        Object.hasOwn(where, 'clientId_idempotencyKey') || Object.hasOwn(where, 'agreementId') ? cancelled : null,
      ));
    context.tx.riderRentalAgreement.findMany.mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id === 'agreement-old' ? [oldAgreement] : [newAgreement]));
    context.tx.allocation.findMany.mockImplementation(({ where }: { where: { fleetId?: string } }) =>
      Promise.resolve(where.fleetId === 'fleet-old' ? [allocation('allocation-old', 'fleet-old')] : [allocation('allocation-new', 'fleet-new')]));
    context.tx.rentalTerminationRequest.update.mockResolvedValue({ ...cancelled, status: 'REQUESTED' });
    context.tx.auditLog.create.mockResolvedValue({});

    await expect(context.service.request('client-a', ops, modernInput('rider-1'), 'key-cancelled-1', 'STAFF'))
      .resolves.toMatchObject({ agreementId: 'agreement-old', allocationId: 'allocation-old', status: 'REQUESTED' });
    expect(context.tx.rentalTerminationRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allocationId: 'allocation-old' }),
    }));
  });
});

describe('RideReturnsService DTO boundaries', () => {
  it('matches the production HTTP boundary for a removed agreementId field', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: CreateRideReturnDto, data: '' };
    const modern = {
      reasonCode: 'MOVING',
      plannedHubId: '00000000-0000-4000-8000-000000000001',
      plannedReturnDate: '2026-10-20T10:00:00.000Z',
    };
    await expect(pipe.transform(modern, metadata)).resolves.toBeInstanceOf(CreateRideReturnDto);

    const legacyField = {
      agreementId: '00000000-0000-4000-8000-000000000002',
      reasonCode: 'MOVING',
      plannedHubId: '00000000-0000-4000-8000-000000000001',
      plannedReturnDate: '2026-10-20T10:00:00.000Z',
    };
    await expect(pipe.transform(legacyField, metadata)).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 400,
        message: expect.arrayContaining(['property agreementId should not exist']),
      }),
    });
  });

});

describe('Staff-initiated return permissions', () => {
  const manager: AuthUser = { id: 'manager-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] };
  const input = { riderId: 'rider-1', reasonCode: 'RECALL', plannedHubId: 'hub-1', plannedReturnDate: '2026-10-13' };
  function prepare(hub = 'hub-1') {
    const c = setup();
    c.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    c.db.userHub.findMany.mockResolvedValue([{ hubId: 'hub-1' }]);
    c.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    c.tx.riderRentalAgreement.findMany.mockResolvedValue([{ id: 'agreement-1', status: 'ACTIVE', vehicleId: 'fleet-1' }]);
    c.tx.allocation.findMany.mockResolvedValue([{ id: 'allocation-1', fleetId: 'fleet-1', rentalAgreementId: 'agreement-1', fleet: { currentHubId: hub } }]);
    c.tx.rentalTerminationRequest.findUnique.mockResolvedValue(null);
    c.tx.rentalTerminationRequest.create.mockImplementation(async ({ data }) => ({ id: 'return-1', status: 'REQUESTED', submissionRequired: true, ...data }));
    return c;
  }
  it('initiates without rider approval and preserves the active rental', async () => {
    const { service, tx } = prepare();
    await expect(service.request('client-a', manager, input, 'staff-return-001', 'STAFF')).resolves.toMatchObject({ status: 'REQUESTED', submissionRequired: true, requestedById: manager.id, requestSource: 'STAFF', allocationId: 'allocation-1' });
    expect(tx.allocation.update).not.toHaveBeenCalled();
    expect(tx.riderRentalAgreement.update).not.toHaveBeenCalled();
    expect(tx.otpRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an unassigned scooter hub despite an assigned destination', async () => {
    const { service, tx } = prepare('hub-other');
    await expect(service.request('client-a', manager, input, 'staff-return-001', 'STAFF')).rejects.toThrow('Return is not in an assigned Hub.');
    expect(tx.rentalTerminationRequest.create).not.toHaveBeenCalled();
  });
  it('rejects an unassigned destination', async () => {
    const { service } = prepare();
    await expect(service.request('client-a', manager, { ...input, plannedHubId: 'hub-other' }, 'staff-return-001', 'STAFF')).rejects.toThrow('Return is not in an assigned Hub.');
  });
  it('rejects duplicate returns', async () => {
    const { service, tx } = prepare();
    tx.rentalTerminationRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'REQUESTED', idempotencyKey: 'different-key' });
    await expect(service.request('client-a', manager, input, 'staff-return-001', 'STAFF')).rejects.toThrow('RETURN_ALREADY_REQUESTED');
  });
  it('checks scooter hub on retries', async () => {
    const { service, tx } = prepare();
    tx.rentalTerminationRequest.findUnique.mockResolvedValue({ riderId: 'rider-1', allocationId: 'allocation-1', status: 'REQUESTED', requestedTerminationDate: new Date('2026-10-13'), reasonCode: 'RECALL', reasonText: null, plannedHubId: 'hub-1' });
    tx.allocation.findFirst.mockResolvedValue({ fleet: { currentHubId: 'hub-other' } });
    await expect(service.request('client-a', manager, input, 'staff-return-001', 'STAFF')).rejects.toThrow('Return is not in an assigned Hub.');
  });
  it('prevents rider cancellation of staff requests', async () => {
    const { service, tx } = prepare();
    tx.rentalTerminationRequest.findFirst.mockResolvedValue({ requestSource: 'STAFF' });
    await expect(service.cancel('client-a', riderUser, 'return-1')).rejects.toMatchObject({ response: { code: 'STAFF_RETURN_NOT_CANCELLABLE', message: expect.stringContaining('initiated by staff') } });
    expect(tx.rentalTerminationRequest.updateMany).not.toHaveBeenCalled();
  });
  it('preserves rider cancellation before submission', async () => {
    const { service, tx } = prepare();
    tx.rentalTerminationRequest.findFirst.mockResolvedValue({ requestSource: 'RIDER' });
    tx.rentalTerminationRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.rentalTerminationRequest.findUniqueOrThrow.mockResolvedValue({ status: 'CANCELLED' });
    await expect(service.cancel('client-a', riderUser, 'return-1')).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(tx.rentalTerminationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requestSource: 'RIDER', vehicleSubmission: { is: null } }) }));
  });
});


it('includes staff returns in the existing scheduled submission queue', async () => {
  const row = { id: 'return-1', riderId: 'rider-1', requestSource: 'STAFF', submissionRequired: true, status: 'REQUESTED', plannedHubId: 'hub-1' };
  const findMany = vi.fn().mockResolvedValue([row]);
  const db = {
    userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
    rentalTerminationRequest: { findMany, count: vi.fn().mockResolvedValue(1) },
    rider: { findMany: vi.fn().mockResolvedValue([{ id: 'rider-1', name: 'Rider' }]) },
  };
  const service = new VehicleSubmissionService(db as never, {} as never, {} as never, {} as never);
  const result = await service.queue('client-a', { id: 'manager-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] }, 'RETURN', 'SCHEDULED', 1, 20);
  expect(result.data).toEqual([expect.objectContaining({ id: row.id, requestSource: 'STAFF', source: 'RETURN' })]);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-a', submissionRequired: true, AND: expect.arrayContaining([{ vehicleSubmission: { is: null } }]) }) }));
});
