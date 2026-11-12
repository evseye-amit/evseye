import { describe, expect, it, vi } from 'vitest';
import { RiderRateCardsService } from '../../src/rider-rate-cards/rider-rate-cards.service.js';

const clientId = '11111111-1111-4111-8111-111111111111';
const otherClientId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

function setup() {
  const prisma = {
    riderRateCard: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    riderRateCardVersion: { findFirst: vi.fn() },
    rateCardRentalRate: { create: vi.fn() },
    rateCardFee: { findFirst: vi.fn(), update: vi.fn() },
    rateCardDeposit: { findFirst: vi.fn(), update: vi.fn() },
    fleet: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const audit = { record: vi.fn() };
  return {
    service: new RiderRateCardsService(prisma as never, audit as never),
    prisma,
  };
}

describe('rider rate card client isolation', () => {
  it('includes version child pricing when listing cards for the workspace UI', async () => {
    const { service, prisma } = setup();
    await service.list(clientId);
    expect(prisma.riderRateCard.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId },
      include: expect.objectContaining({
        versions: expect.objectContaining({
          include: expect.objectContaining({ rentalRates: true, fees: true, deposits: true, adjustments: true }),
        }),
      }),
    }));
  });

  it('scopes card lookup to the authenticated client', async () => {
    const { service, prisma } = setup();
    await expect(service.get(clientId, otherClientId)).rejects.toThrow(
      'Rate card not found',
    );
    expect(prisma.riderRateCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId, id: otherClientId } }),
    );
  });
  it('rejects a child rule for a version outside the client', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue(null);
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1500',
      }),
    ).rejects.toThrow('Version not found');
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign fleet reference', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({
      status: 'DRAFT',
    });
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1500',
        fleetId: otherClientId,
      }),
    ).rejects.toThrow('Fleet does not belong to client');
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });
  it('rejects floating precision beyond currency scale', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({
      status: 'DRAFT',
    });
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1.001',
      }),
    ).rejects.toThrow();
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });

  it('returns selected preview rules with explanations', async () => {
    const { service, prisma } = setup();
    const amount = (value: string) => ({ toFixed: () => value });
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({
      id: versionId,
      fees: [{ id: 'fee', code: 'ONBOARDING_FEE', name: 'Onboarding fee', amount: amount('1939.00'), isActive: true, city: 'Hyderabad', hubId: null, oemId: null, clientWorkPartnerId: null, minVehicleAgeMonths: null, maxVehicleAgeMonths: null }],
      deposits: [{ id: 'deposit', code: 'VEHICLE-SECURITY', name: 'Vehicle security deposit', amount: amount('500.00'), isActive: true, city: null, hubId: null, oemId: null, clientWorkPartnerId: null, minVehicleAgeMonths: null, maxVehicleAgeMonths: null }],
    });
    const result = await service.previewRules(clientId, { versionId, city: 'Hyderabad' });
    expect(result).toMatchObject({ versionId, fees: [{ amount: '1939.00', reason: expect.stringContaining('city') }], deposits: [{ amount: '500.00' }] });
  });

  it('isolates preview requests by client', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue(null);
    await expect(service.previewRules(otherClientId, { versionId })).rejects.toThrow('Rate-card version not found');
    expect(prisma.riderRateCardVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: otherClientId, id: versionId } }));
  });

  it('deactivates an individual fee rule without deleting it', async () => {
    const { service, prisma } = setup();
    const old = { id: 'fee', clientId, rateCardVersionId: versionId, code: 'ONBOARDING_FEE', name: 'Onboarding fee', amount: '1939.00', chargeType: 'ONBOARDING_FEE', nature: 'ONE_TIME', eligibility: 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP', taxable: false, priceIncludesTax: false, isActive: true };
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({ status: 'DRAFT' });
    prisma.rateCardFee.findFirst.mockResolvedValue(old);
    prisma.rateCardFee.update.mockResolvedValue({ ...old, isActive: false });
    await service.updateChild(clientId, clientId, versionId, 'fees', 'fee', { code: old.code, name: old.name, amount: old.amount, chargeType: old.chargeType, nature: old.nature, eligibility: old.eligibility, taxable: old.taxable, priceIncludesTax: old.priceIncludesTax, isActive: false });
    expect(prisma.rateCardFee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fee' }, data: expect.objectContaining({ isActive: false }) }));
  });
});
