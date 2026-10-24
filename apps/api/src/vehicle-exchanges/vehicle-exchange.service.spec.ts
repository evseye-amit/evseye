import { describe, expect, it, vi } from 'vitest';
import { VehicleExchangeService } from './vehicle-exchange.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import type { RiderDepositService } from '../rider-deposits/deposit.service.js';
import type { AllocationsService } from '../allocations/allocations.service.js';

const clientId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const agreementId = '33333333-3333-4333-8333-333333333333';
const vehicleId = '44444444-4444-4444-8444-444444444444';
const replacementId = '55555555-5555-4555-8555-555555555555';
const exchangeId = '66666666-6666-4666-8666-666666666666';
const actorId = '77777777-7777-4777-8777-777777777777';
const hubId = '88888888-8888-4888-8888-888888888888';
const input = { agreementId, reasonCode: 'UPGRADE', plannedReturnDate: '2099-10-16', plannedHubId: hubId };

function fixture() {
  const agreement = {
    id: agreementId,
    clientId,
    riderId,
    vehicleId,
    currentVehicleId: vehicleId,
    currentCommercialVersionNumber: 1,
    status: 'ACTIVE',
  };
  const exchange = {
    id: exchangeId,
    clientId,
    riderId,
    oldVehicleId: vehicleId,
    replacementVehicleId: null,
    returnInspectionId: null,
    status: 'APPROVED',
    baseVersionNumber: 1,
    agreement,
    offers: [],
  };
  const tx = {
    rentalTerminationRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    vehicleExchangeRequest: {
      create: vi.fn().mockResolvedValue(exchange),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(exchange),
    },
    riderRentalAgreement: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    hub: { findMany: vi.fn().mockResolvedValue([{ id: hubId, name: 'Hub' }]) },
    riderRentalAgreement: { findFirst: vi.fn().mockResolvedValue(agreement) },
    commercialRestriction: { findFirst: vi.fn().mockResolvedValue(null) },
    clientExchangePolicy: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ exchangeAllowed: true, minimumDaysOnVehicle: 7 }),
    },
    allocation: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'allocation',
        allocatedAt: new Date(Date.now() - 8 * 86400000),
      }),
    },
    vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(exchange) },
    inspection: { findFirst: vi.fn().mockResolvedValue({ id: 'inspection' }) },
    $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)),
  };
  const service = new VehicleExchangeService(
    db as unknown as PrismaService,
    { calculate: vi.fn() } as unknown as CommercialOfferService,
    {} as RiderDepositService,
    {} as AllocationsService,
  );
  return { db, tx, service, agreement, exchange };
}

describe('vehicle exchange eligibility', () => {
  it('creates an audited request for an active allocation after the minimum term', async () => {
    const { service, tx } = fixture();
    await service.request(clientId, actorId, input, riderId);
    expect(tx.vehicleExchangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId,
        agreementId,
        riderId,
        oldVehicleId: vehicleId,
        baseVersionNumber: 1,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'VEHICLE_EXCHANGE_REQUESTED' }),
    });
  });
  it('rejects a rider scoped request for another rider agreement', async () => {
    const { service, db } = fixture();
    db.riderRentalAgreement.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.request(clientId, actorId, input, riderId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('requires old return assessment before replacement selection', async () => {
    const { service } = fixture();
    await expect(
      service.select(clientId, exchangeId, actorId, {
        vehicleId: replacementId,
        rentalPeriodType: 'WEEKLY',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('requires documented rider consent for operations assisted acceptance', async () => {
    const { service } = fixture();
    await expect(
      service.accept(
        clientId,
        exchangeId,
        actorId,
        { offerId: exchangeId, offerHash: 'a'.repeat(64), consent: true },
        undefined,
        true,
      ),
    ).rejects.toThrow();
  });
  it('releases the old commercial vehicle pointer only after completed return inspection', async () => {
    const { service, db, tx, exchange } = fixture();
    db.vehicleExchangeRequest.findFirst.mockResolvedValueOnce({
      ...exchange,
      status: 'RETURN_PENDING',
      oldAllocationId: 'allocation',
    });
    await service.confirmReturn(clientId, exchangeId, actorId);
    expect(tx.riderRentalAgreement.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        currentVehicleId: vehicleId,
        currentCommercialVersionNumber: 1,
      }),
      data: expect.objectContaining({ currentVehicleId: null }),
    });
  });
});

describe('collection exchange restriction', () => {
  it('blocks commercial exchange but allows a safety exchange', async () => {
    const { service, db } = fixture();
    db.commercialRestriction.findFirst.mockResolvedValue({ caseId: 'case-1' });
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toMatchObject({ status: 409 });
    await expect(service.request(clientId, actorId, { ...input, reasonCode: 'SAFETY_EXCHANGE' }, riderId)).resolves.toBeDefined();
    expect(db.commercialRestriction.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('exchange request errors', () => {
  it.each([null, { exchangeAllowed: false, minimumDaysOnVehicle: 0 }])('returns a useful disabled message for policy %j', async (policy) => {
    const { service, db, tx } = fixture();
    db.clientExchangePolicy.findUnique.mockResolvedValueOnce(policy as never);
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toMatchObject({ status: 409, response: { code: 'EXCHANGE_DISABLED', message: 'Vehicle exchanges are not enabled for this client. Please contact support.' } });
    expect(tx.vehicleExchangeRequest.create).not.toHaveBeenCalled();
  });
  it('keeps the active allocation requirement and provides an actionable message', async () => {
    const { service, db } = fixture();
    db.allocation.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toMatchObject({ status: 409, response: { code: 'ACTIVE_ALLOCATION_REQUIRED', message: expect.stringContaining('active scooter allocation') } });
  });
  it('keeps the minimum term restriction', async () => {
    const { service, db } = fixture();
    db.allocation.findFirst.mockResolvedValueOnce({ id: 'allocation', allocatedAt: new Date() });
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toMatchObject({ status: 409, response: { code: 'MINIMUM_DAYS_NOT_MET', message: expect.stringContaining('minimum required time') } });
  });
  it('keeps inactive agreements blocked', async () => {
    const { service, agreement } = fixture();
    agreement.status = 'ENDED';
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toMatchObject({ status: 409, response: { code: 'AGREEMENT_NOT_ACTIVE', message: expect.any(String) } });
  });
  it('returns useful validation errors without creating a request', async () => {
    const { service, tx } = fixture();
    await expect(service.request(clientId, actorId, { plannedHubId: 'invalid' }, riderId)).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_EXCHANGE_INPUT', message: expect.any(String) } });
    expect(tx.vehicleExchangeRequest.create).not.toHaveBeenCalled();
  });
  it('keeps the planned date mandatory and rejects unavailable hubs', async () => {
    const { service, db } = fixture();
    await expect(service.request(clientId, actorId, { agreementId }, riderId)).rejects.toThrow('Select a valid submission date.');
    db.hub.findMany.mockResolvedValueOnce([]);
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toThrow('No active submission hub is available.');
  });
  it('keeps a competing return request blocked', async () => {
    const { service, tx } = fixture();
    tx.rentalTerminationRequest.findFirst.mockResolvedValueOnce({ id: 'return' } as never);
    await expect(service.request(clientId, actorId, input, riderId)).rejects.toThrow('A vehicle return is already requested.');
    expect(tx.vehicleExchangeRequest.create).not.toHaveBeenCalled();
  });
  it('still requires the shared submission workflow', async () => {
    const { service, db, exchange } = fixture();
    db.vehicleExchangeRequest.findFirst.mockResolvedValueOnce({ ...exchange, status: 'APPROVED', oldAllocationId: 'allocation', submissionRequired: true } as never);
    await expect(service.startReturn(clientId, exchangeId, actorId)).rejects.toThrow('shared vehicle submission workflow');
  });
  it('rechecks assigned hubs inside the replacement reservation transaction', async () => {
    const f = fixture(); Object.assign(f.exchange, { returnInspectionId: 'inspection' });
    const fleet = { findFirst: vi.fn().mockResolvedValue(null) };
    Object.assign(f.tx, { $queryRaw: vi.fn().mockResolvedValue([]), fleet });
    vi.mocked(f.service['pricing'].calculate).mockResolvedValue({ rateCard: { versionId: 'version' } } as never);
    await expect(f.service.select(clientId, exchangeId, actorId, { vehicleId: replacementId, rentalPeriodType: 'WEEKLY' }, [hubId])).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REPLACEMENT_NOT_AVAILABLE' }) });
    expect(fleet.findFirst).toHaveBeenCalledWith({ where: { id: replacementId, clientId, status: 'AVAILABLE', deletedAt: null, currentHubId: { in: [hubId] } } });
  });

});
