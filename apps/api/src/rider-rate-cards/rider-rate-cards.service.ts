import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RiderRateCardStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const signedMoney = z
  .string()
  .refine(
    (value) => /^-?\d{1,10}(\.\d{1,2})?$/.test(value),
    'Invalid signed money amount',
  );
const money = z
  .string()
  .refine(
    (value) => /^\d{1,10}(\.\d{1,2})?$/.test(value),
    'Invalid non-negative money amount',
  );
const cardInput = z
  .object({
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(150),
    description: z.string().optional(),
    currency: z.string().length(3).default('INR'),
    priority: z.number().int().default(0),
    isDefault: z.boolean().default(false),
    collectFirstRentalUpfront: z.boolean().default(true),
    offerValidityMinutes: z.number().int().min(1).max(10080).default(60),
  })
  .strict();
const versionInput = z
  .object({
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => !v.effectiveTo || v.effectiveFrom < v.effectiveTo,
    'Invalid effective period',
  );
const rentalInput = z
  .object({
    rentalPeriodType: z.enum([
      'DAILY',
      'WEEKLY',
      'FORTNIGHTLY',
      'MONTHLY',
      'QUARTERLY',
      'CUSTOM',
    ]),
    amount: money,
    vehicleCategoryId: z.string().uuid().optional(),
    vehicleTypeId: z.string().uuid().optional(),
    oemId: z.string().uuid().optional(),
    fleetId: z.string().uuid().optional(),
    modelName: z.string().optional(),
    variantName: z.string().optional(),
    durationValue: z.number().int().positive().optional(),
    durationUnit: z.string().optional(),
    includedKm: money.optional(),
    extraKmRate: money.optional(),
    taxable: z.boolean().default(false),
    taxCode: z.string().optional(),
    taxRate: money.optional(),
    priceIncludesTax: z.boolean().default(false),
    priority: z.number().int().default(0),
  })
  .strict()
  .refine(
    (v) =>
      v.rentalPeriodType !== 'CUSTOM' || (v.durationValue && v.durationUnit),
    'Custom duration required',
  );
const feeInput = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    chargeType: z.string().min(1),
    nature: z.enum([
      'ONE_TIME',
      'RECURRING',
      'USAGE_BASED',
      'PENALTY',
      'ADJUSTMENT',
    ]),
    eligibility: z
      .enum([
        'EVERY_NEW_AGREEMENT',
        'FIRST_RENTAL_ONLY',
        'ONCE_PER_CLIENT_RIDER_RELATIONSHIP',
        'MANUAL',
      ])
      .default('EVERY_NEW_AGREEMENT'),
    amount: money,
    taxable: z.boolean().default(false),
    taxCode: z.string().optional(),
    taxRate: money.optional(),
    priceIncludesTax: z.boolean().default(false),
  })
  .strict();
const depositInput = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    depositType: z.enum([
      'RIDER_SECURITY',
      'VEHICLE_SECURITY',
      'BATTERY_SECURITY',
      'ACCESSORY_SECURITY',
      'HELMET_SECURITY',
      'CHARGER_SECURITY',
      'OTHER',
    ]),
    amount: money,
    waiverAmount: money.default('0'),
    waiverReason: z.string().optional(),
    guaranteedBy: z.string().optional(),
    vehicleCategoryId: z.string().uuid().optional(),
    vehicleTypeId: z.string().uuid().optional(),
    fleetId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (v) => new Prisma.Decimal(v.waiverAmount).lte(v.amount),
    'Waiver exceeds required deposit',
  );
const adjustmentInput = z
  .object({
    code: z.string().min(1),
    description: z.string().optional(),
    adjustmentType: z.enum([
      'LOCATION',
      'HUB',
      'VEHICLE',
      'VEHICLE_AGE',
      'VEHICLE_GRADE',
      'BATTERY_PLAN',
      'RIDER_TIER',
      'CLIENT_SUBSIDY',
      'DISCOUNT',
      'PROMOTION',
      'MANUAL',
      'OTHER',
    ]),
    calculationType: z.enum(['FIXED_AMOUNT', 'PERCENTAGE']),
    target: z.enum(['RENTAL', 'DEPOSIT']).default('RENTAL'),
    targetDepositCode: z.string().min(1).max(80).optional(),
    percentageBasis: z
      .enum(['BASE_AMOUNT', 'CURRENT_AMOUNT'])
      .default('BASE_AMOUNT'),
    selection: z.enum(['EXCLUSIVE', 'STACKABLE']).default('EXCLUSIVE'),
    amount: signedMoney.optional(),
    percentage: signedMoney.optional(),
    maximumDiscount: money.optional(),
    vehicleCategoryId: z.string().uuid().optional(),
    vehicleTypeId: z.string().uuid().optional(),
    oemId: z.string().uuid().optional(),
    fleetId: z.string().uuid().optional(),
    modelName: z.string().optional(),
    variantName: z.string().optional(),
    country: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    zone: z.string().optional(),
    hubId: z.string().uuid().optional(),
    minVehicleAgeMonths: z.number().int().nonnegative().optional(),
    maxVehicleAgeMonths: z.number().int().nonnegative().optional(),
    vehicleCommercialGrade: z.string().optional(),
    rentalPeriodType: z
      .enum([
        'DAILY',
        'WEEKLY',
        'FORTNIGHTLY',
        'MONTHLY',
        'QUARTERLY',
        'CUSTOM',
      ])
      .optional(),
    batteryPlanId: z.string().uuid().optional(),
    priority: z.number().int().default(0),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.target === 'DEPOSIT' ? !!v.targetDepositCode : !v.targetDepositCode,
    'Deposit target required only for deposit adjustments',
  )
  .refine(
    (v) =>
      v.calculationType === 'FIXED_AMOUNT'
        ? v.amount !== undefined && v.percentage === undefined
        : v.percentage !== undefined && v.amount === undefined,
    'Choose exactly one adjustment value',
  )
  .refine(
    (v) =>
      v.maxVehicleAgeMonths === undefined ||
      v.minVehicleAgeMonths === undefined ||
      v.minVehicleAgeMonths <= v.maxVehicleAgeMonths,
    'Invalid vehicle age range',
  )
  .refine(
    (v) =>
      !v.effectiveFrom || !v.effectiveTo || v.effectiveFrom < v.effectiveTo,
    'Invalid effective period',
  );
const batteryInput = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    pricingType: z.enum([
      'INCLUDED',
      'FIXED_SUBSCRIPTION',
      'PER_SWAP',
      'PER_KM',
      'PER_KWH',
      'SWAPS_INCLUDED',
      'UNLIMITED_SWAP',
    ]),
    rentalPeriodType: z
      .enum([
        'DAILY',
        'WEEKLY',
        'FORTNIGHTLY',
        'MONTHLY',
        'QUARTERLY',
        'CUSTOM',
      ])
      .optional(),
    amount: money,
    includedSwaps: z.number().int().nonnegative().optional(),
    taxable: z.boolean().default(false),
    taxCode: z.string().optional(),
    taxRate: money.optional(),
    priceIncludesTax: z.boolean().default(false),
  })
  .strict();
const gradeInput = z
  .object({
    fleetId: z.string().uuid(),
    grade: z.enum(['A_PLUS', 'A', 'B', 'C', 'D']),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable().optional(),
    reason: z.string().min(1),
  })
  .strict()
  .refine(
    (v) => !v.effectiveTo || v.effectiveFrom < v.effectiveTo,
    'Invalid effective period',
  );
const promotionInput = z
  .object({
    code: z.string().min(1).max(80),
    description: z.string().optional(),
    calculationType: z.enum(['FIXED_AMOUNT', 'PERCENTAGE']),
    amount: money.optional(),
    percentage: money.optional(),
    maximumDiscount: money.optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().nullable().optional(),
    rentalPeriodType: z
      .enum([
        'DAILY',
        'WEEKLY',
        'FORTNIGHTLY',
        'MONTHLY',
        'QUARTERLY',
        'CUSTOM',
      ])
      .optional(),
    maxUsage: z.number().int().positive().optional(),
    perRiderUsageLimit: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (v) => !v.validTo || v.validFrom < v.validTo,
    'Invalid promotion period',
  )
  .refine(
    (v) =>
      v.calculationType === 'FIXED_AMOUNT'
        ? v.amount !== undefined && v.percentage === undefined
        : v.percentage !== undefined && v.amount === undefined,
    'Choose exactly one promotion value',
  );
const schemas = {
  rentalRates: rentalInput,
  fees: feeInput,
  deposits: depositInput,
  adjustments: adjustmentInput,
} as const;
type ChildKind = keyof typeof schemas;

@Injectable()
export class RiderRateCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return result.data;
  }
  private async record(
    clientId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    previousData?: object,
    newData?: object,
  ) {
    await this.audit.record({
      clientId,
      actorId,
      action,
      entityType,
      entityId,
      previousData,
      newData,
    });
  }
  async list(clientId: string) {
    return this.prisma.riderRateCard.findMany({
      where: { clientId },
      include: { versions: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async get(clientId: string, id: string) {
    const card = await this.prisma.riderRateCard.findFirst({
      where: { clientId, id },
      include: {
        versions: {
          include: {
            rentalRates: true,
            fees: true,
            deposits: true,
            adjustments: true,
          },
        },
      },
    });
    if (!card) throw new NotFoundException('Rate card not found');
    return card;
  }
  async create(clientId: string, actorId: string, body: unknown) {
    const data = this.parse(cardInput, body);
    const card = await this.prisma.riderRateCard.create({
      data: { ...data, clientId, createdById: actorId, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'CREATE',
      'RiderRateCard',
      card.id,
      undefined,
      card,
    );
    return card;
  }
  async update(clientId: string, actorId: string, id: string, body: unknown) {
    const data = this.parse(cardInput.partial(), body);
    const old = await this.get(clientId, id);
    if (old.status !== 'DRAFT')
      throw new ConflictException('Only draft rate cards can be edited');
    const card = await this.prisma.riderRateCard.update({
      where: { id },
      data: { ...data, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'UPDATE',
      'RiderRateCard',
      id,
      old,
      card,
    );
    return card;
  }
  async deactivateCard(clientId: string, actorId: string, id: string) {
    const old = await this.get(clientId, id);
    const row = await this.prisma.riderRateCard.update({
      where: { id },
      data: { status: 'INACTIVE', updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'DEACTIVATE',
      'RiderRateCard',
      id,
      old,
      row,
    );
    return row;
  }
  async createVersion(
    clientId: string,
    actorId: string,
    cardId: string,
    body: unknown,
  ) {
    const data = this.parse(versionInput, body);
    const card = await this.get(clientId, cardId);
    if (card.status === 'INACTIVE')
      throw new ConflictException('Rate card inactive');
    const latest = await this.prisma.riderRateCardVersion.aggregate({
      where: { clientId, rateCardId: cardId },
      _max: { version: true },
    });
    const version = await this.prisma.riderRateCardVersion.create({
      data: {
        ...data,
        clientId,
        rateCardId: cardId,
        version: (latest._max.version ?? 0) + 1,
        currency: card.currency,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await this.record(
      clientId,
      actorId,
      'CREATE',
      'RiderRateCardVersion',
      version.id,
      undefined,
      version,
    );
    return version;
  }
  async activateVersion(clientId: string, actorId: string, versionId: string) {
    const version = await this.prisma.riderRateCardVersion.findFirst({
      where: { clientId, id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT')
      throw new ConflictException('Only draft versions can be activated');
    const overlap = await this.prisma.riderRateCardVersion.findFirst({
      where: {
        clientId,
        rateCardId: version.rateCardId,
        status: 'ACTIVE',
        effectiveFrom: { lte: version.effectiveTo ?? new Date('9999-12-31') },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: version.effectiveFrom } },
        ],
      },
    });
    if (overlap)
      throw new ConflictException('Active effective period overlaps');
    const rates = await this.prisma.rateCardRentalRate.count({
      where: { clientId, rateCardVersionId: versionId, isActive: true },
    });
    if (!rates)
      throw new ConflictException('At least one rental rate is required');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.riderRateCard.update({
        where: { id: version.rateCardId },
        data: { status: RiderRateCardStatus.ACTIVE },
      });
      return tx.riderRateCardVersion.update({
        where: { id: versionId },
        data: {
          status: RiderRateCardStatus.ACTIVE,
          approvedById: actorId,
          approvedAt: new Date(),
          updatedById: actorId,
        },
      });
    });
    await this.record(
      clientId,
      actorId,
      'ACTIVATE',
      'RiderRateCardVersion',
      versionId,
      version,
      result,
    );
    return result;
  }
  async addChild(
    clientId: string,
    actorId: string,
    versionId: string,
    kind: ChildKind,
    body: unknown,
  ) {
    const version = await this.prisma.riderRateCardVersion.findFirst({
      where: { clientId, id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT')
      throw new ConflictException('Published versions are immutable');
    const parsed = schemas[kind].safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const data = parsed.data;
    await this.validateReferences(
      clientId,
      data as {
        fleetId?: string;
        hubId?: string;
        batteryPlanId?: string;
        vehicleCategoryId?: string;
        vehicleTypeId?: string;
        oemId?: string;
      },
    );
    const common = {
      ...data,
      clientId,
      rateCardVersionId: versionId,
      createdById: actorId,
      updatedById: actorId,
    };
    const row =
      kind === 'rentalRates'
        ? await this.prisma.rateCardRentalRate.create({
            data: common as Prisma.RateCardRentalRateUncheckedCreateInput,
          })
        : kind === 'fees'
          ? await this.prisma.rateCardFee.create({
              data: common as unknown as Prisma.RateCardFeeUncheckedCreateInput,
            })
          : kind === 'deposits'
            ? await this.prisma.rateCardDeposit.create({
                data: common as unknown as Prisma.RateCardDepositUncheckedCreateInput,
              })
            : await this.prisma.rateCardAdjustment.create({
                data: common as unknown as Prisma.RateCardAdjustmentUncheckedCreateInput,
              });
    await this.record(
      clientId,
      actorId,
      'CREATE',
      kind,
      row.id,
      undefined,
      row,
    );
    return row;
  }
  async updateChild(
    clientId: string,
    actorId: string,
    versionId: string,
    kind: ChildKind,
    id: string,
    body: unknown,
  ) {
    const version = await this.prisma.riderRateCardVersion.findFirst({
      where: { clientId, id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT')
      throw new ConflictException('Published versions are immutable');
    const parsed = schemas[kind].safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const data = parsed.data;
    await this.validateReferences(
      clientId,
      data as {
        fleetId?: string;
        hubId?: string;
        batteryPlanId?: string;
        vehicleCategoryId?: string;
        vehicleTypeId?: string;
        oemId?: string;
      },
    );
    const delegate =
      kind === 'rentalRates'
        ? this.prisma.rateCardRentalRate
        : kind === 'fees'
          ? this.prisma.rateCardFee
          : kind === 'deposits'
            ? this.prisma.rateCardDeposit
            : this.prisma.rateCardAdjustment;
    const old = await (
      delegate as typeof this.prisma.rateCardRentalRate
    ).findFirst({ where: { clientId, rateCardVersionId: versionId, id } });
    if (!old) throw new NotFoundException('Rule not found');
    const update = { ...data, updatedById: actorId };
    const row =
      kind === 'rentalRates'
        ? await this.prisma.rateCardRentalRate.update({
            where: { id },
            data: update as Prisma.RateCardRentalRateUncheckedUpdateInput,
          })
        : kind === 'fees'
          ? await this.prisma.rateCardFee.update({
              where: { id },
              data: update as unknown as Prisma.RateCardFeeUncheckedUpdateInput,
            })
          : kind === 'deposits'
            ? await this.prisma.rateCardDeposit.update({
                where: { id },
                data: update as unknown as Prisma.RateCardDepositUncheckedUpdateInput,
              })
            : await this.prisma.rateCardAdjustment.update({
                where: { id },
                data: update as unknown as Prisma.RateCardAdjustmentUncheckedUpdateInput,
              });
    await this.record(clientId, actorId, 'UPDATE', kind, id, old, row);
    return row;
  }
  async deactivateVersion(clientId: string, actorId: string, id: string) {
    const old = await this.prisma.riderRateCardVersion.findFirst({
      where: { clientId, id },
    });
    if (!old) throw new NotFoundException('Version not found');
    if (old.status === 'INACTIVE') return old;
    const row = await this.prisma.riderRateCardVersion.update({
      where: { id },
      data: { status: 'INACTIVE', updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'DEACTIVATE',
      'RiderRateCardVersion',
      id,
      old,
      row,
    );
    return row;
  }
  async listBatteryPlans(clientId: string) {
    return this.prisma.riderBatteryPlan.findMany({ where: { clientId } });
  }
  async createBatteryPlan(clientId: string, actorId: string, body: unknown) {
    const data = this.parse(batteryInput, body);
    const row = await this.prisma.riderBatteryPlan.create({
      data: { ...data, clientId, createdById: actorId, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'CREATE',
      'RiderBatteryPlan',
      row.id,
      undefined,
      row,
    );
    return row;
  }
  async updateBatteryPlan(
    clientId: string,
    actorId: string,
    id: string,
    body: unknown,
  ) {
    const old = await this.prisma.riderBatteryPlan.findFirst({
      where: { clientId, id },
    });
    if (!old) throw new NotFoundException('Battery plan not found');
    const data = this.parse(batteryInput, body);
    const row = await this.prisma.riderBatteryPlan.update({
      where: { id },
      data: { ...data, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'UPDATE',
      'RiderBatteryPlan',
      id,
      old,
      row,
    );
    return row;
  }
  async deactivateBatteryPlan(clientId: string, actorId: string, id: string) {
    const old = await this.prisma.riderBatteryPlan.findFirst({
      where: { clientId, id },
    });
    if (!old) throw new NotFoundException('Battery plan not found');
    const row = await this.prisma.riderBatteryPlan.update({
      where: { id },
      data: { isActive: false, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'DEACTIVATE',
      'RiderBatteryPlan',
      id,
      old,
      row,
    );
    return row;
  }
  async assignGrade(clientId: string, actorId: string, body: unknown) {
    const data = this.parse(gradeInput, body);
    await this.validateReferences(clientId, data);
    const overlap =
      await this.prisma.vehicleCommercialGradeAssignment.findFirst({
        where: {
          clientId,
          fleetId: data.fleetId,
          effectiveFrom: { lte: data.effectiveTo ?? new Date('9999-12-31') },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: data.effectiveFrom } },
          ],
        },
      });
    if (overlap) throw new ConflictException('Grade period overlaps');
    const row = await this.prisma.vehicleCommercialGradeAssignment.create({
      data: { ...data, clientId, assessedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'ASSIGN',
      'VehicleCommercialGradeAssignment',
      row.id,
      undefined,
      row,
    );
    return row;
  }
  async listPromotions(clientId: string) {
    return this.prisma.riderPromotion.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createPromotion(clientId: string, actorId: string, body: unknown) {
    const data = this.parse(promotionInput, body);
    const row = await this.prisma.riderPromotion.create({
      data: { ...data, clientId, createdById: actorId, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'CREATE',
      'RiderPromotion',
      row.id,
      undefined,
      row,
    );
    return row;
  }
  async deactivatePromotion(clientId: string, actorId: string, id: string) {
    const old = await this.prisma.riderPromotion.findFirst({
      where: { clientId, id },
    });
    if (!old) throw new NotFoundException('Promotion not found');
    const row = await this.prisma.riderPromotion.update({
      where: { id },
      data: { isActive: false, updatedById: actorId },
    });
    await this.record(
      clientId,
      actorId,
      'DEACTIVATE',
      'RiderPromotion',
      id,
      old,
      row,
    );
    return row;
  }
  async listGrades(clientId: string, fleetId: string) {
    return this.prisma.vehicleCommercialGradeAssignment.findMany({
      where: { clientId, fleetId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
  private async validateReferences(
    clientId: string,
    data: {
      fleetId?: string;
      hubId?: string;
      batteryPlanId?: string;
      vehicleCategoryId?: string;
      vehicleTypeId?: string;
      oemId?: string;
    },
  ) {
    if (
      data.fleetId &&
      !(await this.prisma.fleet.findFirst({
        where: { id: data.fleetId, clientId },
      }))
    )
      throw new BadRequestException('Fleet does not belong to client');
    if (
      data.hubId &&
      !(await this.prisma.hub.findFirst({
        where: { id: data.hubId, clientId },
      }))
    )
      throw new BadRequestException('Hub does not belong to client');
    if (
      data.batteryPlanId &&
      !(await this.prisma.riderBatteryPlan.findFirst({
        where: { id: data.batteryPlanId, clientId },
      }))
    )
      throw new BadRequestException('Battery plan does not belong to client');
    if (
      data.vehicleCategoryId &&
      !(await this.prisma.vehicleCategory.findUnique({
        where: { id: data.vehicleCategoryId },
      }))
    )
      throw new BadRequestException('Unknown vehicle category');
    if (
      data.vehicleTypeId &&
      !(await this.prisma.vehicleType.findUnique({
        where: { id: data.vehicleTypeId },
      }))
    )
      throw new BadRequestException('Unknown vehicle type');
    if (
      data.oemId &&
      !(await this.prisma.oem.findUnique({ where: { id: data.oemId } }))
    )
      throw new BadRequestException('Unknown OEM');
  }
}
