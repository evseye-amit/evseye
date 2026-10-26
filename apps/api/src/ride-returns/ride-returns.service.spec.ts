import { createHash } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CreateRideReturnDto, UpdateReturnPenaltyPriceDto } from './dto/ride-return.dto.js';
import { RideReturnsService } from './ride-returns.service.js';
import { VehicleSubmissionService } from '../vehicle-submissions/submission.service.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

const D = (value: string) => new Prisma.Decimal(value);
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
    inspection: { findFirst: vi.fn() },
    returnPenaltyCase: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    returnPenaltyItem: { findMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    returnPenaltyPrice: { findMany: vi.fn() },
    photo: { findMany: vi.fn() },
    otpRequest: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    riderRentalAgreement: { findFirst: vi.fn() },
    rider: { findFirst: vi.fn() },
    allocation: { findFirst: vi.fn() },
    rentalTerminationRequest: { findFirst: vi.fn() },
    hub: { findFirst: vi.fn() },
    userHub: { findMany: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const billing = { issueChargeInTransaction: vi.fn() };
  const allocations = { initiateDeallocationInTransaction: vi.fn() };
  const service = new RideReturnsService(db as never, allocations as never, billing as never, {} as never);
  return { db, tx, allocations, billing, service };
}

const request = { id: 'return-1', clientId: 'client-a', riderId: 'rider-1', allocationId: 'allocation-1', actualTerminationDate: new Date('2026-10-13T08:00:00.000Z') };
const inspection = { id: 'inspection-1' };

function prepareReceive(context: ReturnType<typeof setup>, row: Record<string, unknown> = {
  id: 'return-1',
  clientId: 'client-a',
  agreementId: 'agreement-1',
  riderId: 'rider-1',
  allocationId: 'allocation-1',
  status: 'REQUESTED',
}) {
  const { db, tx, allocations } = context;
  db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
  tx.rentalTerminationRequest.findFirst.mockResolvedValue({
    ...row,
    agreement: { startDate: null, currentVehicleId: 'fleet-1', vehicleId: 'fleet-1' },
  });
  tx.allocation.findFirst.mockResolvedValue({ id: 'allocation-1', fleetId: 'fleet-1' });
  tx.allocation.findUniqueOrThrow.mockResolvedValue({ fleetId: 'fleet-1' });
  tx.rentalTerminationRequest.update.mockResolvedValue({ ...row, status: 'RETURNED' });
  tx.riderRentalAgreement.update.mockResolvedValue({});
  tx.riderRentalAgreementStatusHistory.create.mockResolvedValue({});
  tx.allocation.update.mockResolvedValue({});
  tx.fleet.update.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  allocations.initiateDeallocationInTransaction.mockResolvedValue({ inspectionId: 'inspection-1' });
}

describe('RideReturnsService penalty revisions', () => {
  it('re-reads active prices and freezes snapshots at submit time', async () => {
    const { db, tx, service } = setup();
    const price = { id: 'price-1', code: 'MIRROR', category: 'DAMAGE', description: 'Mirror', amount: D('125.50'), currency: 'INR', isActive: true };
    const penaltyCase = { id: 'case-1', clientId: 'client-a', riderId: 'rider-1', currentRevision: 1, status: 'DRAFT', currency: 'INR', totalAmount: D('0'), digest: null };
    const draft = { id: 'item-1', caseId: 'case-1', revision: 1, position: 0, priceListItemId: 'price-1', priceCode: null, category: null, description: null, amount: null, currency: null, details: 'deep scratch', evidencePhotoIds: ['photo-1'] };
    db.rentalTerminationRequest.findFirst.mockResolvedValue({ id: request.id, plannedHubId: null, receivedHubId: null });
    tx.rentalTerminationRequest.findFirst.mockResolvedValue(request);
    tx.inspection.findFirst.mockResolvedValue(inspection);
    tx.returnPenaltyCase.findUnique.mockResolvedValue(penaltyCase);
    tx.returnPenaltyItem.findMany
      .mockResolvedValueOnce([{ amount: null }])
      .mockResolvedValueOnce([draft]);
    tx.returnPenaltyPrice.findMany.mockResolvedValue([price]);
    tx.photo.findMany.mockResolvedValue([{ id: 'photo-1', photoType: 'DAMAGE' }]);
    tx.returnPenaltyCase.update.mockResolvedValue({ ...penaltyCase, status: 'RIDER_APPROVAL_PENDING', totalAmount: price.amount, digest: 'frozen-digest' });

    await service.submitPenalties('client-a', ops, request.id);

    expect(tx.returnPenaltyPrice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-a', isActive: true }) }));
    expect(tx.returnPenaltyItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' }, data: expect.objectContaining({ priceCode: 'MIRROR', amount: D('125.50'), currency: 'INR' }) }));
    expect(tx.returnPenaltyCase.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RIDER_APPROVAL_PENDING', totalAmount: D('125.50'), currency: 'INR' }) }));
  });

  it('closes an empty submitted list as POSTED without OTP or billing', async () => {
    const { db, tx, billing, service } = setup();
    const penaltyCase = { id: 'case-1', clientId: 'client-a', riderId: 'rider-1', currentRevision: 1, status: 'DRAFT', currency: 'INR', totalAmount: D('0'), digest: null };
    db.rentalTerminationRequest.findFirst.mockResolvedValue({ id: request.id, plannedHubId: null, receivedHubId: null });
    tx.rentalTerminationRequest.findFirst.mockResolvedValue(request);
    tx.inspection.findFirst.mockResolvedValue(inspection);
    tx.returnPenaltyCase.findUnique.mockResolvedValue(penaltyCase);
    tx.returnPenaltyItem.findMany.mockResolvedValue([]);
    tx.returnPenaltyCase.update.mockResolvedValue({ ...penaltyCase, status: 'POSTED', postedChargeId: null });

    const result = await service.submitPenalties('client-a', ops, request.id);

    expect(result).toMatchObject({ status: 'POSTED', postedChargeId: null });
    expect(tx.returnPenaltyPrice.findMany).not.toHaveBeenCalled();
    expect(billing.issueChargeInTransaction).not.toHaveBeenCalled();
  });

  it('posts only after the second approval inside the same transaction', async () => {
    const { db, tx, billing, service } = setup();
    const item = { id: 'item-1', caseId: 'case-1', revision: 1, position: 0, priceCode: 'MIRROR', category: 'DAMAGE', description: 'Mirror', amount: D('10.00'), currency: 'INR', details: 'deep scratch', evidencePhotoIds: ['photo-1'] };
    const digest = createHash('sha256').update(JSON.stringify({ caseId: 'case-1', revision: 1, items: [{ position: 0, priceCode: 'MIRROR', category: 'DAMAGE', description: 'Mirror', amount: '10.00', currency: 'INR', details: 'deep scratch', evidencePhotoIds: ['photo-1'] }], totalAmount: '10.00' })).digest('hex');
    const waiting = { id: 'case-1', clientId: 'client-a', riderId: 'rider-1', currentRevision: 1, status: 'MANAGER_APPROVAL_PENDING', currency: 'INR', totalAmount: D('10.00'), digest, riderApprovedRevision: 1, adminOverrideRevision: null, managerApprovedRevision: null, postedChargeId: null };
    const approved = { ...waiting, managerApprovedRevision: 1 };
    const posted = { ...approved, status: 'POSTED', postedChargeId: 'charge-1', postedRevision: 1 };
    db.rentalTerminationRequest.findFirst.mockResolvedValue({ id: request.id, plannedHubId: null, receivedHubId: null });
    tx.returnPenaltyCase.findFirst.mockResolvedValueOnce(waiting).mockResolvedValueOnce(approved);
    tx.returnPenaltyItem.findMany.mockResolvedValue([item]);
    tx.returnPenaltyCase.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    tx.returnPenaltyCase.findUniqueOrThrow.mockResolvedValue(posted);
    billing.issueChargeInTransaction.mockResolvedValue({ id: 'charge-1' });

    await expect(service.approvePenalties('client-a', ops, request.id)).resolves.toMatchObject({ status: 'POSTED', postedChargeId: 'charge-1' });

    expect(billing.issueChargeInTransaction).toHaveBeenCalledWith(expect.anything(), 'client-a', 'rider-1', 'ops-1', 'return-penalty:case-1:r1', expect.objectContaining({ referenceType: 'RETURN_PENALTY', referenceId: 'case-1', unitAmount: '10.00' }));
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
});

describe('RideReturnsService receipt timestamps', () => {
  it('uses one timestamp for an omitted first receipt even if the clock advances between reads', async () => {
    const context = setup();
    const first = '2026-10-13T08:00:00.000Z';
    prepareReceive(context);
    context.tx.rentalTerminationRequest.update.mockResolvedValue({
      id: 'return-1',
      status: 'RETURNED',
      receivedHubId: 'hub-1',
      actualTerminationDate: new Date(first),
    });

    const RealDate = Date;
    let nowRead = 0;
    vi.stubGlobal('Date', class extends RealDate {
      constructor(value?: string | number | Date) {
        if (value === undefined) {
          super(nowRead++ === 0 ? first : '2026-10-13T08:00:00.001Z');
        } else if (value instanceof RealDate) {
          super(value.getTime());
        } else {
          super(value);
        }
      }
    } as unknown as DateConstructor);

    try {
      await expect(
        context.service.receive('client-a', ops, 'return-1', { receivedHubId: 'hub-1' }),
      ).resolves.toMatchObject({ status: 'RETURNED' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('replays an omitted-time receipt at the same hub after the clock moves', async () => {
    vi.useFakeTimers();
    try {
      const context = setup();
      const first = new Date('2026-10-13T08:00:00.000Z');
      const returned = {
        id: 'return-1',
        status: 'RETURNED',
        receivedHubId: 'hub-1',
        actualTerminationDate: first,
      };
      prepareReceive(context);
      context.tx.rentalTerminationRequest.findFirst
        .mockResolvedValueOnce({
          id: 'return-1',
          clientId: 'client-a',
          agreementId: 'agreement-1',
          riderId: 'rider-1',
          allocationId: 'allocation-1',
          status: 'REQUESTED',
          agreement: { startDate: null, currentVehicleId: 'fleet-1', vehicleId: 'fleet-1' },
        })
        .mockResolvedValueOnce(returned);
      context.tx.rentalTerminationRequest.update.mockResolvedValue(returned);

      vi.setSystemTime(first);
      await expect(
        context.service.receive('client-a', ops, 'return-1', { receivedHubId: 'hub-1' }),
      ).resolves.toMatchObject({ status: 'RETURNED' });

      vi.setSystemTime(new Date('2026-10-13T09:00:00.000Z'));
      await expect(
        context.service.receive('client-a', ops, 'return-1', { receivedHubId: 'hub-1' }),
      ).resolves.toBe(returned);
      expect(context.tx.rentalTerminationRequest.update).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires an exact timestamp and hub for an explicit receipt replay', async () => {
    vi.useFakeTimers();
    try {
      const context = setup();
      const receivedAt = new Date('2026-10-13T08:00:00.000Z');
      const returned = {
        id: 'return-1',
        status: 'RETURNED',
        receivedHubId: 'hub-1',
        actualTerminationDate: receivedAt,
      };
      prepareReceive(context);
      context.tx.rentalTerminationRequest.findFirst
        .mockResolvedValueOnce({
          id: 'return-1',
          clientId: 'client-a',
          agreementId: 'agreement-1',
          riderId: 'rider-1',
          allocationId: 'allocation-1',
          status: 'REQUESTED',
          agreement: { startDate: null, currentVehicleId: 'fleet-1', vehicleId: 'fleet-1' },
        })
        .mockResolvedValue(returned);
      context.tx.rentalTerminationRequest.update.mockResolvedValue(returned);

      vi.setSystemTime(receivedAt);
      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-1',
          receivedAt: receivedAt.toISOString(),
        }),
      ).resolves.toMatchObject({ status: 'RETURNED' });
      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-1',
          receivedAt: receivedAt.toISOString(),
        }),
      ).resolves.toBe(returned);

      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-2',
          receivedAt: receivedAt.toISOString(),
        }),
      ).rejects.toThrow('RETURN_ALREADY_RECEIVED');

      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-1',
          receivedAt: '2026-10-13T07:59:00.000Z',
          backdateReason: 'corrected clock',
        }),
      ).rejects.toThrow('RETURN_ALREADY_RECEIVED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps future and unreasoned-backdate guards for explicit receipt times', async () => {
    vi.useFakeTimers();
    try {
      const context = setup();
      prepareReceive(context);
      const now = new Date('2026-10-13T08:00:00.000Z');
      vi.setSystemTime(now);
      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-1',
          receivedAt: '2026-10-13T08:00:00.001Z',
        }),
      ).rejects.toThrow('A return cannot be received in the future.');
      await expect(
        context.service.receive('client-a', ops, 'return-1', {
          receivedHubId: 'hub-1',
          receivedAt: '2026-10-13T07:59:59.999Z',
        }),
      ).rejects.toThrow('A reason is required for a backdated receipt.');
    } finally {
      vi.useRealTimers();
    }
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

  it('rejects empty and whitespace reasons from the legacy adapter', async () => {
    const context = setup();
    context.db.riderRentalAgreement.findFirst.mockResolvedValue({
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    context.db.allocation.findFirst.mockResolvedValue({ fleet: { currentHubId: 'hub-1' } });

    for (const [_label, reasonCode] of invalidReasons) {
      await expect(context.service.legacyRequest(
        'client-a',
        'agreement-1',
        'ops-1',
        'key-123456',
        { requestedTerminationDate: '2026-10-13T08:00:00.000Z', reasonCode } as never,
      )).rejects.toThrow('A return reason is required.');
    }
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

  it('rejects string isActive values while accepting booleans', async () => {
    const invalid = Object.assign(new UpdateReturnPenaltyPriceDto(), { isActive: 'false' });
    const valid = Object.assign(new UpdateReturnPenaltyPriceDto(), { isActive: false });
    expect((await validate(invalid)).some((error) => error.property === 'isActive')).toBe(true);
    expect(await validate(valid)).toHaveLength(0);
  });
});

describe('RideReturnsService legacy return adapter', () => {
  it('keeps the agreement-scoped legacy request bound to its path agreement', async () => {
    const context = setup();
    context.db.riderRentalAgreement.findFirst.mockResolvedValue({
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    context.db.allocation.findFirst.mockResolvedValue({ fleet: { currentHubId: 'hub-1' } });
    context.db.rider.findFirst.mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' });
    context.db.hub.findFirst.mockResolvedValue({ id: 'hub-1' });
    context.tx.riderRentalAgreement.findMany.mockResolvedValue([{
      id: 'agreement-1',
      riderId: 'rider-1',
      status: 'ACTIVE',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    }]);
    context.tx.allocation.findMany.mockResolvedValue([{ id: 'allocation-1', fleetId: 'fleet-1', rentalAgreementId: 'agreement-1', fleet: { currentHubId: 'hub-1' } }]);
    context.tx.rentalTerminationRequest.findUnique.mockResolvedValue(null);
    context.tx.rentalTerminationRequest.create.mockResolvedValue({
      id: 'return-1',
      agreementId: 'agreement-1',
      allocationId: 'allocation-1',
      riderId: 'rider-1',
      status: 'REQUESTED',
    });
    context.tx.auditLog.create.mockResolvedValue({});

    await expect(context.service.legacyRequest(
      'client-a',
      'agreement-1',
      'ops-1',
      'key-legacy-1',
      { requestedTerminationDate: '2026-10-13T08:00:00.000Z', reasonCode: 'VEHICLE_RETURN' },
    )).resolves.toMatchObject({ agreementId: 'agreement-1', allocationId: 'allocation-1' });
    expect(context.tx.rentalTerminationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agreementId: 'agreement-1' }),
    }));
  });

  it('replays a received request without requiring an active allocation', async () => {
    const { db, service } = setup();
    const returned = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-1',
      riderId: 'rider-1',
      allocationId: 'allocation-1',
      status: 'RETURNED',
      receivedHubId: 'hub-1',
      actualTerminationDate: new Date('2026-10-13T08:00:00.000Z'),
    };
    db.riderRentalAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    db.rentalTerminationRequest.findFirst.mockResolvedValue(returned);

    await expect(service.legacyReceive('client-a', 'agreement-1', 'ops-1')).resolves.toBe(returned);

    expect(db.rentalTerminationRequest.findFirst).toHaveBeenCalledWith({
      where: { agreementId: 'agreement-1', clientId: 'client-a' },
    });
    expect(db.allocation.findFirst).not.toHaveBeenCalled();
  });

  it('records a legacy request after a completed, inspected allocation', async () => {
    const { db, tx, service } = setup();
    const requested = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-1',
      riderId: 'rider-1',
      allocationId: null,
      status: 'REQUESTED',
    };
    const completedAt = new Date('2026-10-13T08:00:00.000Z');
    db.riderRentalAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    db.rentalTerminationRequest.findFirst.mockResolvedValue(requested);
    db.allocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      status: 'COMPLETED',
      deallocatedAt: completedAt,
      fleet: { currentHubId: null },
    });
    tx.riderRentalAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      riderId: 'rider-1',
      status: 'TERMINATION_PENDING',
      startDate: null,
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    tx.rentalTerminationRequest.findFirst.mockResolvedValue(requested);
    tx.allocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      deallocatedAt: completedAt,
      inspections: [{ id: 'inspection-1' }],
    });
    tx.rentalTerminationRequest.update.mockResolvedValue({
      ...requested,
      status: 'RETURNED',
      allocationId: 'allocation-1',
      actualTerminationDate: completedAt,
    });

    await expect(service.legacyReceive('client-a', 'agreement-1', 'ops-1')).resolves.toMatchObject({
      status: 'RETURNED',
      allocationId: 'allocation-1',
    });

    expect(tx.rentalTerminationRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-1' },
      data: expect.objectContaining({
        status: 'RETURNED',
        allocationId: 'allocation-1',
        actualTerminationDate: completedAt,
      }),
    }));
  });

  it('receives an existing request whose allocation is already deallocation-initiated', async () => {
    const { db, service } = setup();
    const requested = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-1',
      riderId: 'rider-1',
      allocationId: 'allocation-1',
      status: 'REQUESTED',
      receivedHubId: null,
      plannedHubId: 'hub-planned',
    };
    db.riderRentalAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    db.rentalTerminationRequest.findFirst.mockResolvedValue(requested);
    db.allocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      status: 'DEALLOCATION_INITIATED',
      fleet: { currentHubId: 'hub-received' },
    });
    const receive = vi.spyOn(service, 'receive').mockResolvedValue({ id: 'return-1' } as never);

    await service.legacyReceive('client-a', 'agreement-1', 'ops-1');

    expect(receive).toHaveBeenCalledWith(
      'client-a',
      { id: 'ops-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] },
      'return-1',
      { receivedHubId: 'hub-received' },
    );
  });

  it('receives an old request without allocationId when its allocation is initiated', async () => {
    const { db, tx, allocations, service } = setup();
    const requested = {
      id: 'return-1',
      clientId: 'client-a',
      agreementId: 'agreement-1',
      riderId: 'rider-1',
      allocationId: null,
      status: 'REQUESTED',
      receivedHubId: null,
      plannedHubId: null,
    };
    db.riderRentalAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      riderId: 'rider-1',
      currentVehicleId: 'fleet-1',
      vehicleId: 'fleet-1',
    });
    db.rentalTerminationRequest.findFirst.mockResolvedValue(requested);
    db.allocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      status: 'DEALLOCATION_INITIATED',
      fleet: { currentHubId: 'hub-received' },
    });
    db.hub.findFirst.mockResolvedValue({ id: 'hub-received' });
    tx.rentalTerminationRequest.findFirst.mockResolvedValue({
      ...requested,
      agreement: { startDate: null, currentVehicleId: 'fleet-1', vehicleId: 'fleet-1' },
    });
    tx.allocation.findFirst.mockResolvedValue({ id: 'allocation-1', fleetId: 'fleet-1' });
    tx.allocation.findUniqueOrThrow.mockResolvedValue({ fleetId: 'fleet-1' });
    tx.rentalTerminationRequest.update.mockResolvedValue({ ...requested, status: 'RETURNED' });
    allocations.initiateDeallocationInTransaction.mockResolvedValue({ inspectionId: 'inspection-1' });

    await expect(
      service.legacyReceive('client-a', 'agreement-1', 'ops-1'),
    ).resolves.toMatchObject({ status: 'RETURNED' });
    expect(allocations.initiateDeallocationInTransaction).toHaveBeenCalledWith(
      tx,
      'client-a',
      'allocation-1',
    );
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
