import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CommercialOfferService } from './commercial-offer.service.js';

const D = Prisma.Decimal;
const clientId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const hubId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const input = {
  riderId,
  vehicleId,
  hubId,
  rentalPeriodType: 'WEEKLY',
  effectiveDate: '2026-10-15',
};
const adjustment = (
  code: string,
  adjustmentType: string,
  amount: string,
  extra: object = {},
) => ({
  id: code,
  code,
  adjustmentType,
  calculationType: 'FIXED_AMOUNT',
  target: 'RENTAL',
  targetDepositCode: null,
  amount: new D(amount),
  percentage: null,
  percentageBasis: 'BASE_AMOUNT',
  selection: 'EXCLUSIVE',
  priority: 0,
  isActive: true,
  vehicleCategoryId: null,
  vehicleTypeId: null,
  oemId: null,
  modelName: null,
  variantName: null,
  fleetId: null,
  state: null,
  city: null,
  zone: null,
  hubId: null,
  minVehicleAgeMonths: null,
  maxVehicleAgeMonths: null,
  vehicleCommercialGrade: null,
  rentalPeriodType: null,
  batteryPlanId: null,
  effectiveFrom: null,
  effectiveTo: null,
  description: code,
  ...extra,
});
function setup() {
  const prisma = {
    client: {
      findFirst: vi.fn().mockResolvedValue({ id: clientId, isActive: true }),
    },
    rider: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: riderId, clientId, status: 'ACTIVE' }),
    },
    fleet: {
      findFirst: vi.fn().mockResolvedValue({
        id: vehicleId,
        clientId,
        status: 'AVAILABLE',
        allocations: [],
        registration: { registrationDate: new Date('2025-08-15') },
        manufacturingYear: 2025,
        manufacturingMonth: 8,
        vehicleCategoryId: '2w',
        vehicleTypeId: 'scooter',
        oemId: 'vida',
        modelName: 'V2',
        variantName: 'Pro',
        currentHubId: hubId,
      }),
    },
    hub: {
      findFirst: vi.fn().mockResolvedValue({
        id: hubId,
        clientId,
        name: 'Sector 18',
        city: 'Gurugram',
        country: 'India',
        state: 'Haryana',
        metadata: null,
      }),
    },
    riderBatteryPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    vehicleCommercialGradeAssignment: {
      findMany: vi.fn().mockResolvedValue([{ grade: 'B' }]),
    },
    riderRateCard: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'card',
          code: 'GURUGRAM_2W_STANDARD',
          name: 'Standard',
          currency: 'INR',
          priority: 0,
          isDefault: true,
          collectFirstRentalUpfront: true,
          versions: [
            {
              id: versionId,
              version: 2,
              currency: 'INR',
              rentalRates: [
                {
                  id: 'base',
                  amount: new D('1600'),
                  currency: 'INR',
                  rentalPeriodType: 'WEEKLY',
                  isActive: true,
                  priority: 0,
                  taxable: false,
                  taxRate: null,
                  taxCode: null,
                  priceIncludesTax: false,
                  includedKm: null,
                  extraKmRate: null,
                },
              ],
              adjustments: [
                adjustment('AGE_13_24', 'VEHICLE_AGE', '-100', {
                  minVehicleAgeMonths: 13,
                  maxVehicleAgeMonths: 24,
                }),
                adjustment('GRADE_B', 'VEHICLE_GRADE', '-50', {
                  vehicleCommercialGrade: 'B',
                }),
                adjustment('GURUGRAM', 'LOCATION', '100', { city: 'Gurugram' }),
                adjustment('SUBSIDY', 'CLIENT_SUBSIDY', '150'),
              ],
              fees: [],
              deposits: [
                {
                  id: 'rider-deposit',
                  code: 'RIDER_SECURITY',
                  depositType: 'RIDER_SECURITY',
                  amount: new D('1500'),
                  waiverAmount: new D('0'),
                  currency: 'INR',
                  isActive: true,
                },
                {
                  id: 'vehicle-deposit',
                  code: 'VEHICLE_SECURITY',
                  depositType: 'VEHICLE_SECURITY',
                  amount: new D('1500'),
                  waiverAmount: new D('0'),
                  currency: 'INR',
                  isActive: true,
                },
              ],
            },
          ],
        },
      ]),
    },
    riderPromotion: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { prisma, service: new CommercialOfferService(prisma as never) };
}

describe('commercial offer preview', () => {
  it('reproduces the 1600 to 1400 acceptance example without writes', async () => {
    const { service, prisma } = setup();
    const result = await service.calculate(clientId, input);
    expect(result.rental.baseAmount).toBe('1600.00');
    expect(result.rental.grossAmount).toBe('1550.00');
    expect(result.rental.subsidyAmount).toBe('150.00');
    expect(result.rental.finalAmount).toBe('1400.00');
    expect(result.totals.refundableDepositAmount).toBe('3000.00');
    expect(result.totals.payableToday).toBe('4400.00');
    expect(result.adjustments.map((item) => item.ruleCode)).toEqual([
      'AGE_13_24',
      'GRADE_B',
      'GURUGRAM',
      'SUBSIDY',
    ]);
    expect(result.vehicle.ageMonths).toBe(14);
    expect(result.rateCard.versionId).toBe(versionId);
    expect(prisma.riderRateCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId, status: 'ACTIVE' } }),
    );
    expect(Object.keys(prisma)).not.toContain('riderLedgerEntry');
  });
  it('keeps battery subscription, taxable fee, and refundable deposits on separate lines', async () => {
    const { service, prisma } = setup();
    prisma.riderBatteryPlan.findFirst.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      clientId,
      code: 'UNLIMITED',
      name: 'Unlimited Swap',
      pricingType: 'FIXED_SUBSCRIPTION',
      rentalPeriodType: 'WEEKLY',
      amount: new D('350'),
      currency: 'INR',
      taxable: false,
      taxRate: null,
      priceIncludesTax: false,
    });
    const cards = await prisma.riderRateCard.findMany();
    cards[0].versions[0].fees.push({
      id: 'fee',
      code: 'ONBOARDING',
      name: 'Onboarding',
      chargeType: 'ONBOARDING_FEE',
      nature: 'ONE_TIME',
      eligibility: 'EVERY_NEW_AGREEMENT',
      amount: new D('100'),
      currency: 'INR',
      taxable: true,
      taxRate: new D('18'),
      priceIncludesTax: false,
      taxCode: 'TAX18',
      isActive: true,
    });
    const result = await service.calculate(clientId, {
      ...input,
      batteryPlanId: '66666666-6666-4666-8666-666666666666',
    });
    expect(result.totals.recurringAmount).toBe('1750.00');
    expect(result.totals.oneTimeNonRefundableAmount).toBe('118.00');
    expect(result.totals.refundableDepositAmount).toBe('3000.00');
    expect(result.totals.payableToday).toBe('4868.00');
    expect(result.oneTimeCharges[0].taxAmount).toBe('18.00');
  });
  it('respects collectFirstRentalUpfront=false', async () => {
    const { service, prisma } = setup();
    const cards = await prisma.riderRateCard.findMany();
    cards[0].collectFirstRentalUpfront = false;
    const result = await service.calculate(clientId, input);
    expect(result.totals.recurringAmount).toBe('1400.00');
    expect(result.totals.payableToday).toBe('3000.00');
  });
  it('does not let a rider preview an arbitrary available vehicle', async () => {
    const { service, prisma } = setup();
    await expect(service.calculate(clientId, input, true)).rejects.toThrow();
    expect(prisma.riderRateCard.findMany).not.toHaveBeenCalled();
  });
  it('rejects a foreign rider before rate card lookup', async () => {
    const { service, prisma } = setup();
    prisma.rider.findFirst.mockResolvedValue(null);
    await expect(service.calculate(clientId, input)).rejects.toThrow();
    expect(prisma.rider.findFirst).toHaveBeenCalledWith({
      where: { id: riderId, clientId, deletedAt: null },
    });
    expect(prisma.riderRateCard.findMany).not.toHaveBeenCalled();
  });
  it('rejects a foreign hub before rate card lookup', async () => {
    const { service, prisma } = setup();
    prisma.hub.findFirst.mockResolvedValue(null);
    await expect(service.calculate(clientId, input)).rejects.toThrow();
    expect(prisma.riderRateCard.findMany).not.toHaveBeenCalled();
  });
  it('rejects a missing active version or base rate', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCard.findMany.mockResolvedValue([
      { id: 'card', versions: [] },
    ]);
    await expect(service.calculate(clientId, input)).rejects.toThrow();
  });
  it('applies targeted deposit adjustments and a waiver without changing rental', async () => {
    const { service, prisma } = setup();
    const cards = await prisma.riderRateCard.findMany();
    const version = cards[0].versions[0];
    version.adjustments.push(
      adjustment('PREMIUM_DEPOSIT', 'VEHICLE', '500', {
        target: 'DEPOSIT',
        targetDepositCode: 'VEHICLE_SECURITY',
      }),
    );
    version.deposits[0].waiverAmount = new D('1000');
    const result = await service.calculate(clientId, input);
    expect(result.rental.finalAmount).toBe('1400.00');
    expect(result.totals.refundableDepositAmount).toBe('2500.00');
    expect(result.totals.payableToday).toBe('3900.00');
    expect(
      result.deposits.find((d) => d.code === 'VEHICLE_SECURITY')?.adjustments[0]
        .ruleCode,
    ).toBe('PREMIUM_DEPOSIT');
  });
  it('returns a separate rider-safe view without internal rules', async () => {
    const { service } = setup();
    const result = await service.calculate(clientId, input);
    const rider = service.riderView(result);
    expect(rider.payableToday).toBe('4400.00');
    expect(JSON.stringify(rider)).not.toContain('AGE_13_24');
    expect(JSON.stringify(rider)).not.toContain('rateCard');
  });
});
