import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  type RateCardAdjustment,
  type RateCardDeposit,
  type RateCardFee,
  type RateCardRentalRate,
  type RiderBatteryPlan,
  type RiderPromotion,
} from '@prisma/client';

const D = Prisma.Decimal;
export const zero = () => new D(0);
export const decimal = (value: Prisma.Decimal | string) => new D(value);
export const rounded = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, D.ROUND_HALF_UP);
export const money = (value: Prisma.Decimal) => rounded(value).toFixed(2);
const error = (code: string): never => {
  throw new UnprocessableEntityException({ code, message: code });
};

export interface VehicleFacts {
  id: string;
  vehicleCategoryId: string;
  vehicleTypeId: string;
  oemId: string;
  modelName: string | null;
  variantName: string | null;
  ageMonths: number | null;
  ageSourceField: string | null;
  ageSourceDate: string | null;
  grade: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  zone: string | null;
  hubId: string | null;
  batteryPlanId: string | null;
  rentalPeriodType: string;
  durationValue: number | null;
  durationUnit: string | null;
  effectiveDate: Date;
}

export function wholeMonths(source: Date, effective: Date): number {
  const months =
    (effective.getUTCFullYear() - source.getUTCFullYear()) * 12 +
    effective.getUTCMonth() -
    source.getUTCMonth() -
    (effective.getUTCDate() < source.getUTCDate() ? 1 : 0);
  if (months < 0) error('COMMERCIAL_CONFIGURATION_INVALID');
  return months;
}

export function dimensionSpecificity(
  rule: {
    vehicleCategoryId?: string | null;
    vehicleTypeId?: string | null;
    oemId?: string | null;
    modelName?: string | null;
    variantName?: string | null;
    fleetId?: string | null;
  },
  facts: VehicleFacts,
): number | null {
  if (
    rule.vehicleCategoryId &&
    rule.vehicleCategoryId !== facts.vehicleCategoryId
  )
    return null;
  if (rule.vehicleTypeId && rule.vehicleTypeId !== facts.vehicleTypeId)
    return null;
  if (rule.oemId && rule.oemId !== facts.oemId) return null;
  if (
    rule.modelName &&
    rule.modelName.toLowerCase() !== facts.modelName?.toLowerCase()
  )
    return null;
  if (
    rule.variantName &&
    rule.variantName.toLowerCase() !== facts.variantName?.toLowerCase()
  )
    return null;
  if (rule.fleetId && rule.fleetId !== facts.id) return null;
  return (
    (rule.fleetId ? 64 : 0) +
    (rule.variantName ? 32 : 0) +
    (rule.modelName ? 16 : 0) +
    (rule.oemId ? 8 : 0) +
    (rule.vehicleTypeId ? 4 : 0) +
    (rule.vehicleCategoryId ? 2 : 0)
  );
}

export function chooseBaseRate(
  rates: RateCardRentalRate[],
  facts: VehicleFacts,
): { rate: RateCardRentalRate; specificity: number } {
  const matches = rates
    .filter(
      (rate) =>
        rate.isActive &&
        rate.rentalPeriodType === facts.rentalPeriodType &&
        (facts.rentalPeriodType !== 'CUSTOM' ||
          (rate.durationValue === facts.durationValue &&
            rate.durationUnit === facts.durationUnit)),
    )
    .map((rate) => ({ rate, specificity: dimensionSpecificity(rate, facts) }))
    .filter(
      (item): item is { rate: RateCardRentalRate; specificity: number } =>
        item.specificity !== null,
    )
    .sort(
      (a, b) =>
        b.specificity - a.specificity ||
        b.rate.priority - a.rate.priority ||
        a.rate.id.localeCompare(b.rate.id),
    );
  if (!matches.length) error('BASE_RENTAL_NOT_CONFIGURED');
  if (
    matches[1] &&
    matches[0].specificity === matches[1].specificity &&
    matches[0].rate.priority === matches[1].rate.priority
  )
    throw new ConflictException({
      code: 'PRICING_RULE_CONFLICT',
      message: 'Ambiguous base rental',
    });
  return matches[0];
}

function locationSpecificity(
  rule: RateCardAdjustment,
  facts: VehicleFacts,
): number | null {
  if (rule.hubId && rule.hubId !== facts.hubId) return null;
  if (rule.zone && rule.zone.toLowerCase() !== facts.zone?.toLowerCase())
    return null;
  if (rule.city && rule.city.toLowerCase() !== facts.city?.toLowerCase())
    return null;
  if (
    rule.country &&
    rule.country.toLowerCase() !== facts.country?.toLowerCase()
  )
    return null;
  if (rule.state && rule.state.toLowerCase() !== facts.state?.toLowerCase())
    return null;
  return (
    (rule.hubId ? 16 : 0) +
    (rule.zone ? 8 : 0) +
    (rule.city ? 4 : 0) +
    (rule.state ? 2 : 0) +
    (rule.country ? 1 : 0)
  );
}

export function applicableRules(
  rules: RateCardAdjustment[],
  facts: VehicleFacts,
  target: 'RENTAL' | 'DEPOSIT' = 'RENTAL',
  depositCode?: string,
): RateCardAdjustment[] {
  const matches = rules.filter((rule) => {
    if (
      rule.target !== target ||
      (target === 'DEPOSIT' && rule.targetDepositCode !== depositCode)
    )
      return false;
    if (
      !rule.isActive ||
      dimensionSpecificity(rule, facts) === null ||
      locationSpecificity(rule, facts) === null
    )
      return false;
    if (
      rule.rentalPeriodType &&
      rule.rentalPeriodType !== facts.rentalPeriodType
    )
      return false;
    if (rule.batteryPlanId && rule.batteryPlanId !== facts.batteryPlanId)
      return false;
    if (
      rule.minVehicleAgeMonths !== null &&
      (facts.ageMonths === null || facts.ageMonths < rule.minVehicleAgeMonths)
    )
      return false;
    if (
      rule.maxVehicleAgeMonths !== null &&
      (facts.ageMonths === null || facts.ageMonths > rule.maxVehicleAgeMonths)
    )
      return false;
    if (
      rule.vehicleCommercialGrade &&
      rule.vehicleCommercialGrade !== facts.grade
    )
      return false;
    if (rule.effectiveFrom && rule.effectiveFrom > facts.effectiveDate)
      return false;
    if (rule.effectiveTo && rule.effectiveTo <= facts.effectiveDate)
      return false;
    if (rule.adjustmentType === 'VEHICLE_AGE' && facts.ageMonths === null)
      return false;
    if (rule.adjustmentType === 'VEHICLE_GRADE' && facts.grade === null)
      return false;
    if (
      rule.adjustmentType === 'MANUAL' ||
      rule.adjustmentType === 'PROMOTION' ||
      rule.adjustmentType === 'RIDER_TIER'
    )
      return false;
    return true;
  });
  const groups = new Map<string, RateCardAdjustment[]>();
  for (const rule of matches)
    groups.set(rule.adjustmentType, [
      ...(groups.get(rule.adjustmentType) ?? []),
      rule,
    ]);
  const chosen: RateCardAdjustment[] = [];
  for (const [type, group] of groups) {
    const ranked = group.sort(
      (a, b) =>
        dimensionSpecificity(b, facts)! +
          locationSpecificity(b, facts)! -
          (dimensionSpecificity(a, facts)! + locationSpecificity(a, facts)!) ||
        b.priority - a.priority ||
        a.code.localeCompare(b.code),
    );
    const exclusive = ranked.filter((rule) => rule.selection === 'EXCLUSIVE');
    if (exclusive.length) {
      const first = exclusive[0];
      const second = exclusive[1];
      if (
        second &&
        dimensionSpecificity(first, facts)! +
          locationSpecificity(first, facts)! ===
          dimensionSpecificity(second, facts)! +
            locationSpecificity(second, facts)! &&
        first.priority === second.priority
      )
        throw new ConflictException({
          code: 'PRICING_RULE_CONFLICT',
          message: `Ambiguous ${type} rule`,
        });
      chosen.push(first);
    }
    chosen.push(
      ...ranked
        .filter((rule) => rule.selection === 'STACKABLE')
        .sort(
          (a, b) => b.priority - a.priority || a.code.localeCompare(b.code),
        ),
    );
  }
  const order = [
    'VEHICLE',
    'VEHICLE_AGE',
    'VEHICLE_GRADE',
    'LOCATION',
    'HUB',
    'BATTERY_PLAN',
    'OTHER',
    'CLIENT_SUBSIDY',
    'DISCOUNT',
  ];
  return chosen.sort(
    (a, b) =>
      order.indexOf(a.adjustmentType) - order.indexOf(b.adjustmentType) ||
      b.priority - a.priority ||
      a.code.localeCompare(b.code),
  );
}

export function applyAdjustment(
  rule: RateCardAdjustment,
  base: Prisma.Decimal,
  current: Prisma.Decimal,
) {
  const configured =
    rule.calculationType === 'FIXED_AMOUNT' ? rule.amount : rule.percentage;
  if (configured === null)
    throw new UnprocessableEntityException({
      code: 'COMMERCIAL_CONFIGURATION_INVALID',
    });
  const basis = rule.percentageBasis === 'CURRENT_AMOUNT' ? current : base;
  let change =
    rule.calculationType === 'FIXED_AMOUNT'
      ? decimal(configured)
      : rounded(basis.mul(decimal(configured)).div('100'));
  if (
    rule.adjustmentType === 'CLIENT_SUBSIDY' ||
    rule.adjustmentType === 'DISCOUNT'
  ) {
    if (rule.maximumDiscount && change.abs().gt(rule.maximumDiscount))
      change = decimal(rule.maximumDiscount);
    change = change.abs().neg();
  }
  if (current.add(change).lt(0)) change = current.neg();
  return {
    change: rounded(change),
    result: rounded(current.add(change)),
    basis: money(basis),
    configuredValue: configured.toString(),
  };
}

export function taxLine(
  amount: Prisma.Decimal,
  taxable: boolean,
  rate: Prisma.Decimal | null,
  included: boolean,
) {
  if (!taxable)
    return { base: rounded(amount), tax: zero(), gross: rounded(amount) };
  if (rate === null)
    throw new UnprocessableEntityException({
      code: 'COMMERCIAL_CONFIGURATION_INVALID',
    });
  const percentage = decimal(rate);
  if (percentage.lt(0) || percentage.gt(100))
    error('COMMERCIAL_CONFIGURATION_INVALID');
  const base = included
    ? rounded(amount.div(decimal('1').add(percentage.div('100'))))
    : rounded(amount);
  const tax = included
    ? rounded(amount.sub(base))
    : rounded(base.mul(percentage).div('100'));
  return { base, tax, gross: rounded(base.add(tax)) };
}

export function batteryLine(plan: RiderBatteryPlan | null, period: string) {
  if (!plan)
    return {
      recurring: zero(),
      usage: [] as { type: string; unit: string; rate: string }[],
      included: [] as string[],
    };
  if (plan.rentalPeriodType && plan.rentalPeriodType !== period)
    error('BATTERY_PLAN_NOT_AVAILABLE');
  const type = plan.pricingType;
  if (type === 'INCLUDED') {
    if (!plan.amount.eq(0)) error('COMMERCIAL_CONFIGURATION_INVALID');
    return { recurring: zero(), usage: [], included: [plan.name] };
  }
  if (type === 'PER_SWAP' || type === 'PER_KM' || type === 'PER_KWH')
    return {
      recurring: zero(),
      usage: [
        {
          type: plan.name,
          unit: type === 'PER_SWAP' ? 'SWAP' : type === 'PER_KM' ? 'KM' : 'KWH',
          rate: money(plan.amount),
        },
      ],
      included: [],
    };
  return {
    recurring: rounded(plan.amount),
    usage: [],
    included: plan.includedSwaps
      ? [`${plan.includedSwaps} swaps included`]
      : plan.amount.eq(0)
        ? [plan.name]
        : [],
  };
}

export function eligibleDeposit(deposit: RateCardDeposit, facts: VehicleFacts) {
  return deposit.isActive && dimensionSpecificity(deposit, facts) !== null;
}

export function feeLine(fee: RateCardFee) {
  return taxLine(fee.amount, fee.taxable, fee.taxRate, fee.priceIncludesTax);
}

export function promotionChange(
  promotion: RiderPromotion,
  current: Prisma.Decimal,
) {
  const raw =
    promotion.calculationType === 'FIXED_AMOUNT'
      ? promotion.amount
      : promotion.percentage
        ? rounded(current.mul(promotion.percentage).div('100'))
        : null;
  if (raw === null)
    throw new UnprocessableEntityException({
      code: 'COMMERCIAL_CONFIGURATION_INVALID',
    });
  let value = decimal(raw).abs();
  if (promotion.maximumDiscount && value.gt(promotion.maximumDiscount))
    value = decimal(promotion.maximumDiscount);
  if (value.gt(current)) value = current;
  return rounded(value);
}

export function chooseDeposits(
  deposits: RateCardDeposit[],
  facts: VehicleFacts,
): RateCardDeposit[] {
  const groups = new Map<
    string,
    { deposit: RateCardDeposit; specificity: number }[]
  >();
  for (const deposit of deposits) {
    if (!eligibleDeposit(deposit, facts)) continue;
    const specificity = dimensionSpecificity(deposit, facts)!;
    groups.set(deposit.depositType, [
      ...(groups.get(deposit.depositType) ?? []),
      { deposit, specificity },
    ]);
  }
  const chosen: RateCardDeposit[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        b.specificity - a.specificity ||
        a.deposit.code.localeCompare(b.deposit.code),
    );
    if (group[1] && group[0].specificity === group[1].specificity)
      throw new ConflictException({
        code: 'PRICING_RULE_CONFLICT',
        message: 'Ambiguous deposit rule',
      });
    chosen.push(group[0].deposit);
  }
  return chosen.sort((a, b) => a.code.localeCompare(b.code));
}
