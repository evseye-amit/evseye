import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CommercialLifecycleService } from './commercial-lifecycle.service.js';
import { pricingHash, sha256 } from './commercial-snapshot.js';

const D = Prisma.Decimal;
const clientId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';
const snapshot = {
  calculationId: 'calc',
  calculatedAt: '2026-10-15T00:00:00Z',
  currency: 'INR',
  effectiveDate: '2026-10-15',
  rateCard: {
    id: 'card',
    code: 'STANDARD',
    name: 'Standard',
    versionId: 'version',
    version: 2,
  },
  rider: { id: riderId },
  vehicle: {
    id: vehicleId,
    ageMonths: 14,
    commercialGrade: 'B',
    modelName: 'V2',
    variantName: null,
  },
  hub: null,
  rental: { finalAmount: '1400.00', period: 'WEEKLY' },
  totals: {
    recurringAmount: '1400.00',
    payableToday: '4400.00',
    refundableDepositAmount: '3000.00',
  },
  deposits: [],
  adjustments: [],
  recurringCharges: [],
  oneTimeCharges: [],
  usageCharges: [],
  includedServices: [],
};
const terms = 'Terms V3';
const termsHash = sha256(terms);
const offer = {
  id: offerId,
  clientId,
  offerNumber: 'EVO-2026-000001',
  riderId,
  vehicleId,
  hubId: null,
  rateCardId: 'card',
  rateCardVersionId: 'version',
  rentalPeriodType: 'WEEKLY',
  durationValue: null,
  durationUnit: null,
  batteryPlanId: null,
  currency: 'INR',
  status: 'PRESENTED',
  finalRecurringAmount: new D('1400.00'),
  upfrontAmount: new D('4400.00'),
  refundableAmount: new D('3000.00'),
  pricingSnapshot: snapshot,
  pricingSnapshotSchemaVersion: 1,
  calculationHash: pricingHash(clientId, snapshot, termsHash, 'RENTAL@3'),
  termsVersion: 'RENTAL@3',
  termsTitle: 'Rental Terms',
  termsSnapshot: terms,
  termsHash,
  expiresAt: new Date(Date.now() + 600000),
};
function setup() {
  const createdAgreement = {
    id: 'agreement',
    clientId,
    commercialOfferId: offerId,
    agreementNumber: 'EVRA-2026-000001',
    status: 'PENDING_ACTIVATION',
    riderId,
    vehicleId,
    pricingSnapshot: snapshot,
    pricingSnapshotSchemaVersion: 1,
    pricingHash: offer.calculationHash,
    finalRecurringAmount: offer.finalRecurringAmount,
    upfrontAmount: offer.upfrontAmount,
    refundableAmount: offer.refundableAmount,
    termsVersion: offer.termsVersion,
    termsTitle: offer.termsTitle,
    termsSnapshot: offer.termsSnapshot,
    acceptedAt: new Date(),
  };
  const tx = {
    $queryRaw: vi
      .fn()
      .mockImplementation((parts: TemplateStringsArray) =>
        String(parts[0]).includes('nextval')
          ? [{ value: 1n }]
          : [{ id: offerId }],
      ),
    riderCommercialOffer: {
      findFirst: vi.fn().mockResolvedValue({ ...offer }),
      update: vi.fn().mockResolvedValue({ ...offer, status: 'ACCEPTED' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    riderRentalAgreement: {
      findUnique: vi.fn().mockResolvedValue(createdAgreement),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAgreement),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(createdAgreement),
    },
    riderAgreementCommercialVersion: { create: vi.fn().mockResolvedValue({}) },
    riderRentalAgreementStatusHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    rider: {
      findFirst: vi.fn().mockResolvedValue({ id: riderId, status: 'ACTIVE' }),
    },
    fleet: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: vehicleId, status: 'AVAILABLE' }),
    },
    hub: { findFirst: vi.fn() },
    riderRateCardVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'version' }),
    },
    allocation: { findFirst: vi.fn().mockResolvedValue(null) },
    riderCommercialTerms: {
      aggregate: vi.fn().mockResolvedValue({ _max: { version: null } }),
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    riderCommercialOffer: { findFirst: vi.fn().mockResolvedValue(null) },
    commercialRestriction: { findFirst: vi.fn().mockResolvedValue(null) },
    riderRateCard: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'card', offerValidityMinutes: 60 }),
    },
    riderCommercialTerms: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            code: 'RENTAL',
            version: 3,
            title: 'Rental Terms',
            content: terms,
            contentHash: termsHash,
          },
        ]),
    },
  };
  const pricing = { calculate: vi.fn().mockResolvedValue(snapshot) };
  const deposits = { initializeInTransaction: vi.fn().mockResolvedValue([]), readiness: vi.fn().mockResolvedValue({ satisfied: true }) };
  return {
    service: new CommercialLifecycleService(prisma as never, pricing as never, deposits as never),
    prisma,
    tx,
    pricing,
    deposits,
    createdAgreement,
  };
}

describe('commercial lifecycle', () => {
  it('creates an offer from server pricing and immutable terms; rejects submitted prices', async () => {
    const { service, tx, pricing } = setup();
    await expect(
      service.createOffer(clientId, actorId, {
        riderId,
        vehicleId,
        rentalPeriodType: 'WEEKLY',
        weeklyRental: '1.00',
      }),
    ).rejects.toThrow();
    expect(pricing.calculate).not.toHaveBeenCalled();
    tx.riderCommercialOffer.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const result = await service.createOffer(clientId, actorId, {
      riderId,
      vehicleId,
      rentalPeriodType: 'WEEKLY',
    });
    expect(result.status).toBe('CALCULATED');
    expect(result.pricingSnapshot).toEqual(snapshot);
    expect(result.calculationHash).toBe(offer.calculationHash);
    expect(result.termsVersion).toBe('RENTAL@3');
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('accepts exactly the stored snapshot without repricing and starts pending activation', async () => {
    const { service, tx, pricing, deposits } = setup();
    const agreement = await service.acceptOffer(
      clientId,
      actorId,
      offerId,
      { consent: true, acceptedTermsVersion: 'RENTAL@3' },
      riderId,
    );
    expect(agreement.id).toBe('agreement');
    const data = tx.riderRentalAgreement.create.mock.calls[0][0].data;
    expect(data.pricingSnapshot).toEqual(snapshot);
    expect(data.pricingHash).toBe(offer.calculationHash);
    expect(data.status).toBe('PENDING_ACTIVATION');
    expect(data.finalRecurringAmount.toFixed(2)).toBe('1400.00');
    expect(tx.riderCommercialOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED' }),
      }),
    );
    expect(tx.riderRentalAgreementStatusHistory.create).toHaveBeenCalled();
    expect(deposits.initializeInTransaction).toHaveBeenCalledTimes(1);
    expect(pricing.calculate).not.toHaveBeenCalled();
  });
  it('returns the existing agreement on a retry', async () => {
    const { service, tx } = setup();
    tx.riderCommercialOffer.findFirst.mockResolvedValue({
      ...offer,
      status: 'ACCEPTED',
    });
    const result = await service.acceptOffer(
      clientId,
      actorId,
      offerId,
      { consent: true, acceptedTermsVersion: 'RENTAL@3' },
      riderId,
    );
    expect(result.id).toBe('agreement');
    expect(tx.riderRentalAgreement.create).not.toHaveBeenCalled();
  });
  it('rejects expired, tampered, and stale-terms offers without an agreement', async () => {
    for (const changed of [
      { expiresAt: new Date(Date.now() - 1) },
      {
        pricingSnapshot: {
          ...snapshot,
          rental: { ...snapshot.rental, finalAmount: '1.00' },
        },
      },
      { termsVersion: 'RENTAL@4' },
    ]) {
      const { service, tx } = setup();
      tx.riderCommercialOffer.findFirst.mockResolvedValue({
        ...offer,
        ...changed,
      });
      await expect(
        service.acceptOffer(
          clientId,
          actorId,
          offerId,
          { consent: true, acceptedTermsVersion: 'RENTAL@3' },
          riderId,
        ),
      ).rejects.toThrow();
      expect(tx.riderRentalAgreement.create).not.toHaveBeenCalled();
    }
  });
  it('does not reveal an offer from another client or rider', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.acceptOffer(
        clientId,
        actorId,
        offerId,
        { consent: true, acceptedTermsVersion: 'RENTAL@3' },
        riderId,
      ),
    ).rejects.toThrow();
    expect(tx.riderRentalAgreement.create).not.toHaveBeenCalled();
  });
  it('blocks a second live agreement for the same vehicle', async () => {
    const { service, tx } = setup();
    tx.riderRentalAgreement.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'other-agreement' });
    await expect(
      service.acceptOffer(
        clientId,
        actorId,
        offerId,
        { consent: true, acceptedTermsVersion: 'RENTAL@3' },
        riderId,
      ),
    ).rejects.toThrow();
    expect(tx.riderRentalAgreement.create).not.toHaveBeenCalled();
  });
  it('blocks a vehicle allocated to another rider', async () => {
    const { service, tx } = setup();
    tx.allocation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'other-allocation' });
    await expect(
      service.acceptOffer(
        clientId,
        actorId,
        offerId,
        { consent: true, acceptedTermsVersion: 'RENTAL@3' },
        riderId,
      ),
    ).rejects.toThrow();
    expect(tx.riderRentalAgreement.create).not.toHaveBeenCalled();
  });
});
