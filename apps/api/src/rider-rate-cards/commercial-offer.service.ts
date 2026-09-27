import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applicableRules,
  applyAdjustment,
  batteryLine,
  chooseBaseRate,
  chooseDeposits,
  decimal,
  feeLine,
  money,
  promotionChange,
  rounded,
  taxLine,
  wholeMonths,
  zero,
  type VehicleFacts,
} from './pricing-engine.js';

const previewSchema = z
  .object({
    riderId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    hubId: z.string().uuid().optional(),
    rentalPeriodType: z.enum([
      'DAILY',
      'WEEKLY',
      'FORTNIGHTLY',
      'MONTHLY',
      'QUARTERLY',
      'CUSTOM',
    ]),
    durationValue: z.number().int().positive().optional(),
    durationUnit: z.string().min(1).max(20).optional(),
    batteryPlanId: z.string().uuid().optional(),
    effectiveDate: z.iso.date().optional(),
    promotionCode: z.string().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.rentalPeriodType === 'CUSTOM'
        ? !!v.durationValue && !!v.durationUnit
        : v.durationValue === undefined && v.durationUnit === undefined,
    'Custom duration required only for CUSTOM period',
  );
export type CommercialPreviewInput = z.infer<typeof previewSchema>;
const fail = (code: string): never => {
  throw new UnprocessableEntityException({ code, message: code });
};
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const businessToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

@Injectable()
export class CommercialOfferService {
  private readonly logger = new Logger(CommercialOfferService.name);
  constructor(private readonly prisma: PrismaService) {}

  async calculate(clientId: string, raw: unknown, riderScoped = false) {
    const parsed = previewSchema.safeParse(raw);
    if (!parsed.success)
      throw new UnprocessableEntityException({
        code: 'INVALID_COMMERCIAL_PREVIEW_INPUT',
        details: parsed.error.flatten(),
      });
    const input = parsed.data;
    const started = Date.now();
    const calculationId = randomUUID();
    const effectiveDate = new Date(
      `${input.effectiveDate ?? businessToday()}T00:00:00.000Z`,
    );
    const [client, rider, fleet, requestedHub, batteryPlan] = await Promise.all(
      [
        this.prisma.client.findFirst({
          where: { id: clientId, isActive: true },
        }),
        this.prisma.rider.findFirst({
          where: { id: input.riderId, clientId, deletedAt: null },
        }),
        this.prisma.fleet.findFirst({
          where: { id: input.vehicleId, clientId, deletedAt: null },
          include: {
            registration: true,
            allocations: {
              where: {
                riderId: input.riderId,
                status: { in: ['ACTIVE', 'INITIATED'] },
              },
              take: 1,
            },
          },
        }),
        input.hubId
          ? this.prisma.hub.findFirst({
              where: { id: input.hubId, clientId, deletedAt: null },
            })
          : Promise.resolve(null),
        input.batteryPlanId
          ? this.prisma.riderBatteryPlan.findFirst({
              where: { id: input.batteryPlanId, clientId, isActive: true },
            })
          : Promise.resolve(null),
      ],
    );
    if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND' });
    if (!rider) throw new NotFoundException({ code: 'RIDER_NOT_FOUND' });
    if (!fleet) throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND' });
    if (riderScoped && !fleet.allocations.length)
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND' });
    if (input.hubId && !requestedHub)
      throw new NotFoundException({ code: 'HUB_NOT_FOUND' });
    if (input.batteryPlanId && !batteryPlan)
      throw new NotFoundException({ code: 'BATTERY_PLAN_NOT_AVAILABLE' });
    if (fleet.status !== 'AVAILABLE' && !fleet.allocations.length)
      fail('VEHICLE_NOT_AVAILABLE');
    if (rider.status === 'BLOCKED' || rider.status === 'EXITED')
      fail('RIDER_NOT_ELIGIBLE');
    const hub =
      requestedHub ??
      (fleet.currentHubId
        ? await this.prisma.hub.findFirst({
            where: { id: fleet.currentHubId, clientId, deletedAt: null },
          })
        : null);
    const source =
      fleet.registration?.registrationDate ??
      (fleet.manufacturingYear
        ? new Date(
            Date.UTC(
              fleet.manufacturingYear,
              (fleet.manufacturingMonth ?? 1) - 1,
              1,
            ),
          )
        : null);
    const gradeRows =
      await this.prisma.vehicleCommercialGradeAssignment.findMany({
        where: {
          clientId,
          fleetId: fleet.id,
          effectiveFrom: { lte: effectiveDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveDate } }],
        },
        take: 2,
      });
    if (gradeRows.length > 1)
      throw new ConflictException({
        code: 'PRICING_RULE_CONFLICT',
        message: 'Ambiguous vehicle grade',
      });
    const facts: VehicleFacts = {
      id: fleet.id,
      vehicleCategoryId: fleet.vehicleCategoryId,
      vehicleTypeId: fleet.vehicleTypeId,
      oemId: fleet.oemId,
      modelName: fleet.modelName,
      variantName: fleet.variantName,
      ageMonths: source ? wholeMonths(source, effectiveDate) : null,
      ageSourceField: source
        ? fleet.registration?.registrationDate
          ? 'FleetRegistration.registrationDate'
          : 'Fleet.manufacturingYear/manufacturingMonth'
        : null,
      ageSourceDate: source ? dateOnly(source) : null,
      grade: gradeRows[0]?.grade ?? null,
      country: hub?.country ?? null,
      state: hub?.state ?? rider.state ?? null,
      city: hub?.city ?? rider.city ?? null,
      zone:
        typeof (hub?.metadata as { zone?: unknown } | null)?.zone === 'string'
          ? (hub!.metadata as { zone: string }).zone
          : null,
      hubId: hub?.id ?? null,
      batteryPlanId: batteryPlan?.id ?? null,
      rentalPeriodType: input.rentalPeriodType,
      durationValue: input.durationValue ?? null,
      durationUnit: input.durationUnit ?? null,
      effectiveDate,
    };
    const cards = await this.prisma.riderRateCard.findMany({
      where: { clientId, status: 'ACTIVE' },
      include: {
        versions: {
          where: {
            clientId,
            status: 'ACTIVE',
            effectiveFrom: { lte: effectiveDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveDate } }],
          },
          include: {
            rentalRates: true,
            fees: true,
            deposits: true,
            adjustments: true,
          },
        },
      },
    });
    const options: {
      card: (typeof cards)[number];
      version: (typeof cards)[number]['versions'][number];
      base: ReturnType<typeof chooseBaseRate>;
    }[] = [];
    for (const card of cards) {
      if (card.versions.length > 1)
        throw new ConflictException({ code: 'RATE_CARD_VERSION_AMBIGUOUS' });
      const version = card.versions[0];
      if (!version) continue;
      try {
        options.push({
          card,
          version,
          base: chooseBaseRate(version.rentalRates, facts),
        });
      } catch (error) {
        if (error instanceof UnprocessableEntityException) continue;
        throw error;
      }
    }
    options.sort(
      (a, b) =>
        b.card.priority - a.card.priority ||
        b.base.specificity - a.base.specificity ||
        Number(b.card.isDefault) - Number(a.card.isDefault) ||
        a.card.code.localeCompare(b.card.code),
    );
    if (!options.length)
      fail(
        !cards.length
          ? 'RATE_CARD_NOT_FOUND'
          : cards.every((card) => !card.versions.length)
            ? 'RATE_CARD_VERSION_NOT_FOUND'
            : 'BASE_RENTAL_NOT_CONFIGURED',
      );
    if (
      options[1] &&
      options[0].card.priority === options[1].card.priority &&
      options[0].base.specificity === options[1].base.specificity &&
      options[0].card.isDefault === options[1].card.isDefault
    )
      throw new ConflictException({ code: 'RATE_CARD_AMBIGUOUS' });
    const { card, version, base } = options[0];
    const depositCodes = new Set(
      version.deposits.filter((item) => item.isActive).map((item) => item.code),
    );
    if (
      version.adjustments.some(
        (item) =>
          item.isActive &&
          item.target === 'DEPOSIT' &&
          !depositCodes.has(item.targetDepositCode ?? ''),
      )
    )
      fail('COMMERCIAL_CONFIGURATION_INVALID');
    if (batteryPlan && batteryPlan.currency !== card.currency)
      fail('COMMERCIAL_CONFIGURATION_INVALID');
    if (
      base.rate.currency !== card.currency ||
      version.currency !== card.currency
    )
      fail('COMMERCIAL_CONFIGURATION_INVALID');
    const baseAmount = rounded(base.rate.amount);
    let running = baseAmount;
    let grossBeforeConcessions = baseAmount;
    const adjustments: {
      type: string;
      ruleId: string;
      ruleCode: string;
      rateCardVersionId: string;
      description: string;
      calculationType: string;
      percentageBasis: string;
      configuredValue: string;
      basisAmount: string;
      amountBefore: string;
      adjustmentAmount: string;
      amountAfter: string;
      priority: number;
    }[] = [];
    let subsidyAmount = zero(),
      discountAmount = zero();
    const rules = applicableRules(version.adjustments, facts);
    for (const rule of rules) {
      const before = running;
      const applied = applyAdjustment(rule, baseAmount, running);
      running = applied.result;
      if (rule.adjustmentType === 'CLIENT_SUBSIDY')
        subsidyAmount = subsidyAmount.add(applied.change.abs());
      else if (rule.adjustmentType === 'DISCOUNT')
        discountAmount = discountAmount.add(applied.change.abs());
      else grossBeforeConcessions = grossBeforeConcessions.add(applied.change);
      adjustments.push({
        type: rule.adjustmentType,
        ruleId: rule.id,
        ruleCode: rule.code,
        rateCardVersionId: version.id,
        description: rule.description ?? rule.code,
        calculationType: rule.calculationType,
        percentageBasis: rule.percentageBasis,
        configuredValue: applied.configuredValue,
        basisAmount: applied.basis,
        amountBefore: money(before),
        adjustmentAmount: money(applied.change),
        amountAfter: money(running),
        priority: rule.priority,
      });
    }
    let promotionAmount = zero();
    let promotion: { code: string; id: string } | null = null;
    if (input.promotionCode) {
      const row = await this.prisma.riderPromotion.findFirst({
        where: { clientId, code: input.promotionCode },
      });
      if (!row || !row.isActive)
        throw new UnprocessableEntityException({ code: 'PROMOTION_INVALID' });
      if (
        row.validFrom > effectiveDate ||
        (row.validTo && row.validTo <= effectiveDate)
      )
        fail('PROMOTION_EXPIRED');
      if (
        row.rentalPeriodType &&
        row.rentalPeriodType !== input.rentalPeriodType
      )
        fail('PROMOTION_NOT_ELIGIBLE');
      if (row.maxUsage !== null || row.perRiderUsageLimit !== null)
        fail('PROMOTION_USAGE_HISTORY_UNAVAILABLE');
      const before = running;
      promotionAmount = promotionChange(row, running);
      running = rounded(running.sub(promotionAmount));
      promotion = { id: row.id, code: row.code };
      adjustments.push({
        type: 'PROMOTION',
        ruleId: row.id,
        ruleCode: row.code,
        rateCardVersionId: version.id,
        description: row.description ?? row.code,
        calculationType: row.calculationType,
        percentageBasis: 'CURRENT_AMOUNT',
        configuredValue: (row.amount ?? row.percentage)?.toString() ?? '',
        basisAmount: money(before),
        amountBefore: money(before),
        adjustmentAmount: money(promotionAmount.neg()),
        amountAfter: money(running),
        priority: 0,
      });
    }
    const rentalTax = taxLine(
      running,
      base.rate.taxable,
      base.rate.taxRate,
      base.rate.priceIncludesTax,
    );
    const battery = batteryLine(batteryPlan, input.rentalPeriodType);
    const batteryTax =
      batteryPlan && battery.recurring.gt(0)
        ? taxLine(
            battery.recurring,
            batteryPlan.taxable,
            batteryPlan.taxRate,
            batteryPlan.priceIncludesTax,
          )
        : { base: zero(), tax: zero(), gross: zero() };
    const recurringCharges: {
      type: string;
      code: string;
      baseAmount: string;
      taxAmount: string;
      grossAmount: string;
      taxCode?: string | null;
    }[] = [
      {
        type: 'RENTAL',
        code: base.rate.id,
        baseAmount: money(rentalTax.base),
        taxAmount: money(rentalTax.tax),
        grossAmount: money(rentalTax.gross),
        taxCode: base.rate.taxCode,
      },
    ];
    if (batteryPlan && battery.recurring.gt(0))
      recurringCharges.push({
        type: 'BATTERY',
        code: batteryPlan.code,
        baseAmount: money(batteryTax.base),
        taxAmount: money(batteryTax.tax),
        grossAmount: money(batteryTax.gross),
        taxCode: batteryPlan.taxCode,
      });
    const oneTimeCharges: typeof recurringCharges = [];
    const usageCharges: { type: string; unit: string; rate: string }[] = [
      ...battery.usage,
    ];
    const includedServices = [...battery.included];
    if (base.rate.extraKmRate)
      usageCharges.push({
        type: 'EXTRA_KM',
        unit: 'KM',
        rate: money(base.rate.extraKmRate),
      });
    if (base.rate.includedKm)
      includedServices.push(`${money(base.rate.includedKm)} KM included`);
    for (const fee of version.fees
      .filter((f) => f.isActive)
      .sort((a, b) => a.code.localeCompare(b.code))) {
      if (fee.currency !== card.currency)
        fail('COMMERCIAL_CONFIGURATION_INVALID');
      if (fee.eligibility === 'MANUAL') continue;
      if (fee.eligibility !== 'EVERY_NEW_AGREEMENT')
        fail('FEE_ELIGIBILITY_HISTORY_UNAVAILABLE');
      const priced = feeLine(fee);
      const line = {
        type: fee.chargeType,
        code: fee.code,
        baseAmount: money(priced.base),
        taxAmount: money(priced.tax),
        grossAmount: money(priced.gross),
        taxCode: fee.taxCode,
      };
      if (fee.nature === 'ONE_TIME') oneTimeCharges.push(line);
      else if (fee.nature === 'RECURRING') recurringCharges.push(line);
      else if (fee.nature === 'USAGE_BASED')
        usageCharges.push({
          type: fee.chargeType,
          unit: 'UNIT',
          rate: money(fee.amount),
        });
      else fail('COMMERCIAL_CONFIGURATION_INVALID');
      if (fee.amount.eq(0)) includedServices.push(fee.name);
    }
    const deposits = chooseDeposits(version.deposits, facts).map((deposit) => {
      if (deposit.currency !== card.currency)
        fail('COMMERCIAL_CONFIGURATION_INVALID');
      let required = rounded(deposit.amount);
      const depositAdjustments: {
        ruleId: string;
        ruleCode: string;
        type: string;
        amountBefore: string;
        adjustmentAmount: string;
        amountAfter: string;
        configuredValue: string;
        percentageBasis: string;
      }[] = [];
      for (const rule of applicableRules(
        version.adjustments,
        facts,
        'DEPOSIT',
        deposit.code,
      )) {
        const before = required;
        const applied = applyAdjustment(rule, deposit.amount, required);
        required = applied.result;
        depositAdjustments.push({
          ruleId: rule.id,
          ruleCode: rule.code,
          type: rule.adjustmentType,
          amountBefore: money(before),
          adjustmentAmount: money(applied.change),
          amountAfter: money(required),
          configuredValue: applied.configuredValue,
          percentageBasis: rule.percentageBasis,
        });
      }
      if (deposit.waiverAmount.gt(required))
        fail('COMMERCIAL_CONFIGURATION_INVALID');
      return {
        type: deposit.depositType,
        code: deposit.code,
        ruleId: deposit.id,
        originalRequired: money(deposit.amount),
        adjustedRequired: money(required),
        adjustments: depositAdjustments,
        waiverAmount: money(deposit.waiverAmount),
        finalRequired: money(required.sub(deposit.waiverAmount)),
        waiverType: deposit.waiverAmount.eq(0)
          ? 'NONE'
          : deposit.waiverAmount.eq(required)
            ? 'FULL'
            : 'PARTIAL',
        waiverReason: deposit.waiverReason,
        guaranteedBy: deposit.guaranteedBy,
        refundable: true,
      };
    });
    const refundable = deposits.reduce(
      (sum, d) => sum.add(decimal(d.finalRequired)),
      zero(),
    );
    const recurring = recurringCharges.reduce(
      (sum, line) => sum.add(decimal(line.grossAmount)),
      zero(),
    );
    const oneTime = oneTimeCharges.reduce(
      (sum, line) => sum.add(decimal(line.grossAmount)),
      zero(),
    );
    const firstRental = card.collectFirstRentalUpfront ? recurring : zero();
    const nonRefundable = rounded(firstRental.add(oneTime));
    const payableToday = rounded(nonRefundable.add(refundable));
    const taxAmount = [...recurringCharges, ...oneTimeCharges].reduce(
      (sum, line) => sum.add(decimal(line.taxAmount)),
      zero(),
    );
    const expectedRental = baseAmount.add(
      adjustments.reduce(
        (sum, a) => sum.add(decimal(a.adjustmentAmount)),
        zero(),
      ),
    );
    if (
      !rounded(expectedRental).eq(running) ||
      !rounded(refundable.add(nonRefundable)).eq(payableToday) ||
      !rounded(
        recurringCharges.reduce(
          (sum, line) => sum.add(decimal(line.grossAmount)),
          zero(),
        ),
      ).eq(recurring)
    )
      fail('COMMERCIAL_CALCULATION_RECONCILIATION_FAILED');
    const result = {
      calculationId,
      calculatedAt: new Date().toISOString(),
      currency: card.currency,
      effectiveDate: dateOnly(effectiveDate),
      rateCard: {
        id: card.id,
        code: card.code,
        name: card.name,
        versionId: version.id,
        version: version.version,
      },
      rider: { id: rider.id },
      vehicle: {
        id: fleet.id,
        modelName: fleet.modelName,
        variantName: fleet.variantName,
        ageMonths: facts.ageMonths,
        ageSourceField: facts.ageSourceField,
        ageSourceDate: facts.ageSourceDate,
        commercialGrade: facts.grade,
      },
      hub: hub
        ? { id: hub.id, name: hub.name, city: hub.city, state: hub.state }
        : null,
      rental: {
        baseAmount: money(baseAmount),
        baseRateId: base.rate.id,
        adjustmentAmount: money(
          adjustments
            .filter(
              (a) =>
                !['CLIENT_SUBSIDY', 'DISCOUNT', 'PROMOTION'].includes(a.type),
            )
            .reduce((sum, a) => sum.add(decimal(a.adjustmentAmount)), zero()),
        ),
        grossAmount: money(grossBeforeConcessions),
        subsidyAmount: money(subsidyAmount),
        discountAmount: money(discountAmount),
        promotionAmount: money(promotionAmount),
        taxAmount: money(rentalTax.tax),
        finalAmount: money(rentalTax.gross),
        period: input.rentalPeriodType,
        durationValue: input.durationValue ?? null,
        durationUnit: input.durationUnit ?? null,
        includedKm: base.rate.includedKm ? money(base.rate.includedKm) : null,
        extraKmRate: base.rate.extraKmRate
          ? money(base.rate.extraKmRate)
          : null,
      },
      batteryPlan: batteryPlan
        ? {
            id: batteryPlan.id,
            code: batteryPlan.code,
            name: batteryPlan.name,
            pricingType: batteryPlan.pricingType,
          }
        : null,
      promotion,
      adjustments,
      recurringCharges,
      oneTimeCharges,
      deposits,
      usageCharges,
      includedServices,
      totals: {
        recurringAmount: money(recurring),
        firstRentalUpfront: money(firstRental),
        oneTimeNonRefundableAmount: money(oneTime),
        refundableDepositAmount: money(refundable),
        nonRefundableUpfrontAmount: money(nonRefundable),
        taxAmount: money(taxAmount),
        payableToday: money(payableToday),
      },
      calculationOrder: [
        'BASE_RENTAL',
        'VEHICLE',
        'VEHICLE_AGE',
        'VEHICLE_GRADE',
        'LOCATION',
        'HUB',
        'BATTERY_PLAN',
        'OTHER',
        'CLIENT_SUBSIDY',
        'DISCOUNT',
        'PROMOTION',
        'TAX',
        'FEES',
        'DEPOSITS',
        'TOTALS',
      ],
    };
    this.logger.log(
      JSON.stringify({
        event: 'COMMERCIAL_OFFER_CALCULATED',
        calculationId,
        clientId,
        riderId: rider.id,
        vehicleId: fleet.id,
        hubId: hub?.id,
        rateCardId: card.id,
        rateCardVersionId: version.id,
        rentalPeriod: input.rentalPeriodType,
        appliedRuleCount: adjustments.length,
        baseRental: result.rental.baseAmount,
        finalRental: result.rental.finalAmount,
        payableToday: result.totals.payableToday,
        durationMs: Date.now() - started,
      }),
    );
    return result;
  }

  async riderIdForUser(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
    });
    if (!rider) throw new NotFoundException({ code: 'RIDER_NOT_FOUND' });
    return rider.id;
  }

  riderView(result: Awaited<ReturnType<CommercialOfferService['calculate']>>) {
    return {
      calculationId: result.calculationId,
      currency: result.currency,
      effectiveDate: result.effectiveDate,
      vehicle: {
        modelName: result.vehicle.modelName,
        variantName: result.vehicle.variantName,
      },
      period: result.rental.period,
      durationValue: result.rental.durationValue,
      durationUnit: result.rental.durationUnit,
      recurringAmount: result.totals.recurringAmount,
      rentalBreakdown: {
        baseAmount: result.rental.baseAmount,
        changes: result.adjustments.map(({ type, adjustmentAmount }) => ({
          type,
          amount: adjustmentAmount,
        })),
        taxAmount: result.rental.taxAmount,
        finalAmount: result.rental.finalAmount,
      },
      recurringCharges: result.recurringCharges.map(
        ({ type, grossAmount }) => ({ type, amount: grossAmount }),
      ),
      oneTimeCharges: result.oneTimeCharges.map(({ type, grossAmount }) => ({
        type,
        amount: grossAmount,
      })),
      refundableDeposits: result.deposits.map(({ type, finalRequired }) => ({
        type,
        amount: finalRequired,
      })),
      usageCharges: result.usageCharges,
      includedServices: result.includedServices,
      payableToday: result.totals.payableToday,
      refundableAmount: result.totals.refundableDepositAmount,
      nonRefundableAmount: result.totals.nonRefundableUpfrontAmount,
    };
  }
}
