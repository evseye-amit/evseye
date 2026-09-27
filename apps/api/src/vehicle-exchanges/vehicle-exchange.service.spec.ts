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
const input = { agreementId, reasonCode: 'UPGRADE' };

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
    await expect(service.request(clientId, actorId, { agreementId, reasonCode: 'SAFETY_EXCHANGE' }, riderId)).resolves.toBeDefined();
    expect(db.commercialRestriction.findFirst).toHaveBeenCalledTimes(1);
  });
});
