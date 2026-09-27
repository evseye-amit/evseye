import { describe, expect, it } from 'vitest';
import {
  Prisma,
  type RateCardAdjustment,
  type RateCardDeposit,
  type RateCardRentalRate,
  type RiderBatteryPlan,
  type RiderPromotion,
} from '@prisma/client';
import {
  applicableRules,
  applyAdjustment,
  batteryLine,
  chooseBaseRate,
  chooseDeposits,
  money,
  promotionChange,
  taxLine,
  wholeMonths,
  type VehicleFacts,
} from './pricing-engine.js';

const D = Prisma.Decimal;
const at = new Date('2026-10-15T00:00:00.000Z');
const facts: VehicleFacts = {
  id: 'vehicle',
  vehicleCategoryId: '2w',
  vehicleTypeId: 'scooter',
  oemId: 'vida',
  modelName: 'V2',
  variantName: 'Pro',
  ageMonths: 14,
  ageSourceField: 'registrationDate',
  ageSourceDate: '2025-08-15',
  grade: 'B',
  country: 'India',
  state: 'Haryana',
  city: 'Gurugram',
  zone: 'Cyber City',
  hubId: 'sector18',
  batteryPlanId: null,
  rentalPeriodType: 'WEEKLY',
  durationValue: null,
  durationUnit: null,
  effectiveDate: at,
};
const rate = (id: string, details: object = {}) =>
  ({
    id,
    amount: new D('1500'),
    rentalPeriodType: 'WEEKLY',
    priority: 0,
    isActive: true,
    vehicleCategoryId: null,
    vehicleTypeId: null,
    oemId: null,
    modelName: null,
    variantName: null,
    fleetId: null,
    ...details,
  }) as RateCardRentalRate;
const rule = (id: string, type: string, details: object = {}) =>
  ({
    id,
    code: id,
    adjustmentType: type,
    calculationType: 'FIXED_AMOUNT',
    target: 'RENTAL',
    targetDepositCode: null,
    amount: new D('0'),
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
    ...details,
  }) as RateCardAdjustment;

describe('base rental and pricing rule resolution', () => {
  it('chooses vehicle over variant, model, type, category and default', () => {
    const rates = [
      rate('default'),
      rate('category', { vehicleCategoryId: '2w' }),
      rate('type', { vehicleTypeId: 'scooter' }),
      rate('model', { modelName: 'V2' }),
      rate('variant', { variantName: 'Pro' }),
      rate('vehicle', { fleetId: 'vehicle' }),
    ];
    expect(chooseBaseRate(rates, facts).rate.id).toBe('vehicle');
    expect(chooseBaseRate(rates.slice(0, -1), facts).rate.id).toBe('variant');
    expect(chooseBaseRate(rates.slice(0, -2), facts).rate.id).toBe('model');
    expect(chooseBaseRate(rates.slice(0, -3), facts).rate.id).toBe('type');
  });
  it('separates daily, weekly and monthly rates and rejects missing rates', () => {
    const rates = [
      rate('daily', { rentalPeriodType: 'DAILY' }),
      rate('monthly', { rentalPeriodType: 'MONTHLY' }),
    ];
    expect(() => chooseBaseRate(rates, facts)).toThrow(
      'BASE_RENTAL_NOT_CONFIGURED',
    );
    expect(
      chooseBaseRate(rates, { ...facts, rentalPeriodType: 'DAILY' }).rate.id,
    ).toBe('daily');
    expect(
      chooseBaseRate(rates, { ...facts, rentalPeriodType: 'MONTHLY' }).rate.id,
    ).toBe('monthly');
  });
  it('matches custom duration value and unit exactly', () => {
    const customFacts = {
      ...facts,
      rentalPeriodType: 'CUSTOM',
      durationValue: 10,
      durationUnit: 'DAY',
    };
    const rates = [
      rate('seven-day', {
        rentalPeriodType: 'CUSTOM',
        durationValue: 7,
        durationUnit: 'DAY',
      }),
      rate('ten-day', {
        rentalPeriodType: 'CUSTOM',
        durationValue: 10,
        durationUnit: 'DAY',
      }),
    ];
    expect(chooseBaseRate(rates, customFacts).rate.id).toBe('ten-day');
  });
  it('fails on equally specific competing rates', () => {
    expect(() => chooseBaseRate([rate('one'), rate('two')], facts)).toThrow(
      'Ambiguous base rental',
    );
  });
  it('chooses the most specific location rule and detects overlapping age brackets', () => {
    const selected = applicableRules(
      [
        rule('state', 'LOCATION', { state: 'Haryana' }),
        rule('city', 'LOCATION', { city: 'Gurugram' }),
        rule('zone', 'LOCATION', { zone: 'Cyber City' }),
      ],
      facts,
    );
    expect(selected.map((item) => item.code)).toEqual(['zone']);
    expect(() =>
      applicableRules(
        [
          rule('age1', 'VEHICLE_AGE', {
            minVehicleAgeMonths: 13,
            maxVehicleAgeMonths: 24,
          }),
          rule('age2', 'VEHICLE_AGE', {
            minVehicleAgeMonths: 12,
            maxVehicleAgeMonths: 20,
          }),
        ],
        facts,
      ),
    ).toThrow('Ambiguous');
  });
  it('supports explicit stacking and effective-date exclusion', () => {
    const selected = applicableRules(
      [
        rule('base', 'OTHER', { amount: new D('10') }),
        rule('stack', 'OTHER', { amount: new D('5'), selection: 'STACKABLE' }),
        rule('expired', 'OTHER', { effectiveTo: at }),
      ],
      facts,
    );
    expect(selected.map((item) => item.code)).toEqual(['base', 'stack']);
  });
});

describe('money, age, battery and deposits', () => {
  it('uses full calendar months at boundaries', () => {
    expect(wholeMonths(new Date('2026-04-15'), at)).toBe(6);
    expect(wholeMonths(new Date('2026-04-16'), at)).toBe(5);
    expect(wholeMonths(new Date('2025-08-15'), at)).toBe(14);
    expect(() => wholeMonths(new Date('2026-11-01'), at)).toThrow();
  });
  it('uses exact decimal amounts and configured percentage basis', () => {
    const percentage = rule('grade', 'VEHICLE_GRADE', {
      calculationType: 'PERCENTAGE',
      percentage: new D('-7.5'),
      amount: null,
      percentageBasis: 'BASE_AMOUNT',
    });
    const applied = applyAdjustment(
      percentage,
      new D('1499.99'),
      new D('1599.94'),
    );
    expect(money(applied.change)).toBe('-112.50');
    expect(money(applied.result)).toBe('1487.44');
    const currentBasis = applyAdjustment(
      { ...percentage, percentageBasis: 'CURRENT_AMOUNT' },
      new D('1499.99'),
      new D('1599.94'),
    );
    expect(money(currentBasis.change)).toBe('-120.00');
  });
  it('floors subsidies and promotion discounts at zero', () => {
    const subsidy = applyAdjustment(
      rule('subsidy', 'CLIENT_SUBSIDY', { amount: new D('2000') }),
      new D('1500'),
      new D('1500'),
    );
    expect(money(subsidy.result)).toBe('0.00');
    const capped = applyAdjustment(
      rule('discount', 'DISCOUNT', {
        amount: new D('500'),
        maximumDiscount: new D('100'),
      }),
      new D('1500'),
      new D('1500'),
    );
    expect(money(capped.change)).toBe('-100.00');
    const promo = {
      calculationType: 'PERCENTAGE',
      percentage: new D('50'),
      maximumDiscount: new D('100'),
      amount: null,
    } as RiderPromotion;
    expect(money(promotionChange(promo, new D('300')))).toBe('100.00');
  });
  it('calculates inclusive and exclusive tax without floating point', () => {
    expect(money(taxLine(new D('118'), true, new D('18'), true).tax)).toBe(
      '18.00',
    );
    expect(money(taxLine(new D('100'), true, new D('18'), false).gross)).toBe(
      '118.00',
    );
  });
  it('separates battery subscriptions from usage rates', () => {
    const included = batteryLine(
      {
        pricingType: 'INCLUDED',
        name: 'Included',
        amount: new D('0'),
        rentalPeriodType: null,
      } as RiderBatteryPlan,
      'WEEKLY',
    );
    expect(included.included).toEqual(['Included']);
    const subscription = batteryLine(
      {
        pricingType: 'FIXED_SUBSCRIPTION',
        name: 'Unlimited',
        amount: new D('350'),
        rentalPeriodType: 'WEEKLY',
        includedSwaps: null,
      } as RiderBatteryPlan,
      'WEEKLY',
    );
    expect(money(subscription.recurring)).toBe('350.00');
    const usage = batteryLine(
      {
        pricingType: 'PER_KM',
        name: 'Energy',
        amount: new D('1.50'),
        rentalPeriodType: null,
      } as RiderBatteryPlan,
      'WEEKLY',
    );
    expect(usage.usage).toEqual([{ type: 'Energy', unit: 'KM', rate: '1.50' }]);
    expect(money(usage.recurring)).toBe('0.00');
  });
  it('selects the vehicle-specific deposit and rejects duplicate same-scope deposits', () => {
    const base = {
      id: 'base',
      code: 'base',
      depositType: 'VEHICLE_SECURITY',
      amount: new D('1500'),
      isActive: true,
      vehicleCategoryId: null,
      vehicleTypeId: null,
      fleetId: null,
    } as RateCardDeposit;
    const special = {
      ...base,
      id: 'special',
      code: 'special',
      amount: new D('2000'),
      fleetId: 'vehicle',
    };
    expect(chooseDeposits([base, special], facts).map((d) => d.id)).toEqual([
      'special',
    ]);
    expect(() =>
      chooseDeposits(
        [base, { ...base, id: 'duplicate', code: 'duplicate' }],
        facts,
      ),
    ).toThrow('Ambiguous');
  });
});
