import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import {
  canonicalJson,
  pricingHash,
  sha256,
} from '../rider-rate-cards/commercial-snapshot.js';
import {
  billingWindow,
  depositDifferenceByType,
  prorateExchange,
} from './exchange-math.js';

const uuid = z.string().uuid();
function fail(code: string): never {
  throw new ConflictException({ code });
}
function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new BadRequestException({
      code: 'INVALID_EXCHANGE_INPUT',
      details: result.error.flatten(),
    });
  return result.data;
}
const money = (value: Prisma.Decimal | string) =>
  new Prisma.Decimal(value).toFixed(2);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const active = [
  'REQUESTED',
  'APPROVED',
  'REPLACEMENT_SELECTED',
  'OFFER_PRESENTED',
  'ACCEPTED',
  'RETURN_PENDING',
  'DEPOSIT_PENDING',
  'HANDOVER_PENDING',
] as const;
const selection = z
  .object({
    vehicleId: uuid,
    hubId: uuid.optional(),
    rentalPeriodType: z.enum([
      'DAILY',
      'WEEKLY',
      'FORTNIGHTLY',
      'MONTHLY',
      'QUARTERLY',
      'CUSTOM',
    ]),
    durationValue: z.number().int().positive().optional(),
    durationUnit: z.string().optional(),
    batteryPlanId: uuid.optional(),
    promotionCode: z.string().optional(),
  })
  .strict();

@Injectable()
export class VehicleExchangeService {
  constructor(
    private readonly db: PrismaService,
    private readonly pricing: CommercialOfferService,
    private readonly deposits: RiderDepositService,
    private readonly allocations: AllocationsService,
  ) {}

  private async get(clientId: string, id: string, riderId?: string) {
    const exchange = await this.db.vehicleExchangeRequest.findFirst({
      where: { id, clientId, ...(riderId ? { riderId } : {}) },
      include: { offers: { orderBy: { createdAt: 'desc' } }, agreement: true },
    });
    if (!exchange) throw new NotFoundException({ code: 'EXCHANGE_NOT_FOUND' });
    return exchange;
  }
  details(clientId: string, id: string, riderId?: string) {
    return this.get(clientId, id, riderId);
  }
  list(clientId: string, riderId?: string) {
    return this.db.vehicleExchangeRequest.findMany({
      where: { clientId, ...(riderId ? { riderId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
  async history(clientId: string, agreementId: string, riderId?: string) {
    const agreement = await this.db.riderRentalAgreement.findFirst({
      where: { clientId, id: agreementId, ...(riderId ? { riderId } : {}) },
    });
    if (!agreement)
      throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
    return this.db.riderAgreementCommercialVersion.findMany({
      where: { clientId, agreementId },
      orderBy: { versionNumber: 'asc' },
    });
  }
  policy(clientId: string) {
    return this.db.clientExchangePolicy.findUnique({ where: { clientId } });
  }
  private async verifiedOldPeriodPayment(
    clientId: string,
    riderId: string,
    agreementId: string,
    amendmentId: string | null,
    amount: Prisma.Decimal,
    at: Date,
  ) {
    return !!(await this.db.riderCharge.findFirst({
      where: {
        clientId,
        riderId,
        chargeType: { in: ['RENT', 'RENTAL', 'RECURRING_RENTAL'] },
        referenceType: amendmentId ? 'AGREEMENT_AMENDMENT' : 'RENTAL_AGREEMENT',
        referenceId: amendmentId ?? agreementId,
        amount: { gte: amount },
        invoice: {
          is: {
            status: 'PAID',
            paidAt: { not: null },
            outstandingAmount: 0,
            paidAmount: { gte: amount },
            billingPeriodStart: { lte: at },
            billingPeriodEnd: { gt: at },
          },
        },
      },
      select: { id: true },
    }));
  }
  setPolicy(clientId: string, actorId: string, raw: unknown) {
    const data = parseInput(
      z
        .object({
          exchangeAllowed: z.boolean(),
          minimumDaysOnVehicle: z.number().int().nonnegative(),
          prorationMode: z.enum([
            'NONE',
            'DAILY',
            'HOURLY',
            'CALENDAR_DAY',
            'BILLING_PERIOD_REMAINDER',
          ]),
          prorationPolicy: z.enum([
            'NO_PRORATION',
            'PRORATE_OLD_ONLY',
            'PRORATE_NEW_ONLY',
            'PRORATE_BOTH',
            'START_NEW_NEXT_BILLING_CYCLE',
          ]),
          depositExcessPolicy: z.enum(['REFUND_REQUEST', 'RETAIN_HELD']),
          exchangeFeeAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
          feeWaiverReasonCodes: z.array(z.string().min(1).max(80)),
          offerValidityMinutes: z.number().int().min(5).max(10080),
          reservationMinutes: z.number().int().min(5).max(10080),
        })
        .strict(),
      raw,
    );
    return this.db.clientExchangePolicy.upsert({
      where: { clientId },
      create: {
        clientId,
        ...data,
        feeWaiverReasonCodes: json(data.feeWaiverReasonCodes),
        updatedById: actorId,
      },
      update: {
        ...data,
        feeWaiverReasonCodes: json(data.feeWaiverReasonCodes),
        updatedById: actorId,
      },
    });
  }
  async request(
    clientId: string,
    actorId: string,
    raw: unknown,
    riderId?: string,
  ) {
    const input = parseInput(
      z
        .object({
          agreementId: uuid,
          reasonCode: z.string().min(1).max(80),
          reason: z.string().max(500).optional(),
        })
        .strict(),
      raw,
    );
    const agreement = await this.db.riderRentalAgreement.findFirst({
      where: {
        clientId,
        id: input.agreementId,
        ...(riderId ? { riderId } : {}),
      },
    });
    if (!agreement)
      throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
    // Safety replacements remain available while commercial exchanges are restricted.
    if (!['SAFETY_EXCHANGE', 'VEHICLE_BREAKDOWN', 'VEHICLE_UNSAFE'].includes(input.reasonCode)) {
      const restriction = await this.db.commercialRestriction.findFirst({ where: { clientId, riderId: agreement.riderId, code: 'BLOCK_VEHICLE_EXCHANGE', status: 'ACTIVE' } });
      if (restriction) fail('COLLECTION_RESTRICTION_ACTIVE');
    }
    if (agreement.status !== 'ACTIVE') fail('AGREEMENT_NOT_ACTIVE');
    const policy = await this.policy(clientId);
    if (!policy?.exchangeAllowed) fail('EXCHANGE_DISABLED');
    const currentVehicleId = agreement.currentVehicleId ?? agreement.vehicleId;
    const allocation = await this.db.allocation.findFirst({
      where: {
        clientId,
        riderId: agreement.riderId,
        fleetId: currentVehicleId,
        status: 'ACTIVE',
      },
      orderBy: { allocatedAt: 'desc' },
    });
    if (!allocation?.allocatedAt) fail('ACTIVE_ALLOCATION_REQUIRED');
    if (
      Date.now() - allocation.allocatedAt.getTime() <
      policy.minimumDaysOnVehicle * 86_400_000
    )
      fail('MINIMUM_DAYS_NOT_MET');
    return this.db.$transaction(async (tx) => {
      const created = await tx.vehicleExchangeRequest.create({
        data: {
          clientId,
          agreementId: agreement.id,
          riderId: agreement.riderId,
          oldVehicleId: currentVehicleId,
          oldAllocationId: allocation.id,
          baseVersionNumber: agreement.currentCommercialVersionNumber,
          reasonCode: input.reasonCode,
          reason: input.reason,
          createdById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'VEHICLE_EXCHANGE_REQUESTED',
          entityType: 'VehicleExchangeRequest',
          entityId: created.id,
          newData: {
            agreementId: agreement.id,
            oldVehicleId: currentVehicleId,
            reasonCode: input.reasonCode,
          },
        },
      });
      return created;
    });
  }
  async approve(clientId: string, id: string, actorId: string) {
    const changed = await this.db.vehicleExchangeRequest.updateMany({
      where: { clientId, id, status: 'REQUESTED' },
      data: { status: 'APPROVED', updatedById: actorId },
    });
    if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'VEHICLE_EXCHANGE_APPROVED',
        entityType: 'VehicleExchangeRequest',
        entityId: id,
      },
    });
    return this.get(clientId, id);
  }
  async reject(clientId: string, id: string, actorId: string, raw: unknown) {
    const input = parseInput(
      z.object({ reason: z.string().min(1).max(500) }).strict(),
      raw,
    );
    const changed = await this.db.vehicleExchangeRequest.updateMany({
      where: { clientId, id, status: 'REQUESTED' },
      data: { status: 'REJECTED', reason: input.reason, updatedById: actorId },
    });
    if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'VEHICLE_EXCHANGE_REJECTED',
        entityType: 'VehicleExchangeRequest',
        entityId: id,
        newData: { reason: input.reason },
      },
    });
    return this.get(clientId, id);
  }
  async select(clientId: string, id: string, actorId: string, raw: unknown) {
    const input = parseInput(selection, raw);
    const exchange = await this.get(clientId, id);
    if (
      !['APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED'].includes(
        exchange.status,
      )
    )
      fail('EXCHANGE_STATE_INVALID');
    if (exchange.agreement.status !== 'ACTIVE') fail('AGREEMENT_NOT_ACTIVE');
    if (!exchange.returnInspectionId) fail('OLD_RETURN_ASSESSMENT_REQUIRED');
    if (
      exchange.agreement.currentCommercialVersionNumber !==
      exchange.baseVersionNumber
    )
      fail('EXCHANGE_VERSION_STALE');
    if (input.vehicleId === exchange.oldVehicleId) fail('SAME_VEHICLE');
    const policy = await this.policy(clientId);
    if (!policy?.exchangeAllowed) fail('EXCHANGE_DISABLED');
    // Price before taking the hold, while the replacement is still AVAILABLE.
    const preview = await this.pricing.calculate(clientId, {
      ...input,
      riderId: exchange.riderId,
    });
    const now = new Date();
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Fleet" WHERE "id" = ${input.vehicleId} AND "clientId" = ${clientId} FOR UPDATE`;
        await tx.vehicleExchangeRequest.updateMany({
          where: {
            clientId,
            replacementVehicleId: input.vehicleId,
            status: { in: [...active] },
            reservationExpiresAt: { lt: now },
          },
          data: { status: 'EXPIRED' },
        });
        const fleet = await tx.fleet.findFirst({
          where: {
            id: input.vehicleId,
            clientId,
            status: 'AVAILABLE',
            deletedAt: null,
          },
        });
        if (!fleet) fail('REPLACEMENT_NOT_AVAILABLE');
        const competing = await tx.vehicleExchangeRequest.count({
          where: {
            clientId,
            replacementVehicleId: input.vehicleId,
            id: { not: id },
            OR: [
              {
                status: { in: ['REPLACEMENT_SELECTED', 'OFFER_PRESENTED'] },
                reservationExpiresAt: { gt: now },
              },
              {
                status: {
                  in: [
                    'ACCEPTED',
                    'RETURN_PENDING',
                    'DEPOSIT_PENDING',
                    'HANDOVER_PENDING',
                  ],
                },
              },
            ],
          },
        });
        if (competing) fail('REPLACEMENT_RESERVED');
        await tx.vehicleExchangeOffer.updateMany({
          where: { exchangeRequestId: id, status: 'PRESENTED' },
          data: { status: 'SUPERSEDED' },
        });
        const updated = await tx.vehicleExchangeRequest.updateMany({
          where: {
            id,
            clientId,
            status: {
              in: ['APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED'],
            },
            baseVersionNumber: exchange.baseVersionNumber,
          },
          data: {
            status: 'REPLACEMENT_SELECTED',
            replacementVehicleId: input.vehicleId,
            replacementSelection: json(input),
            reservationExpiresAt: new Date(
              now.getTime() + policy.reservationMinutes * 60_000,
            ),
            updatedById: actorId,
          },
        });
        if (!updated.count) fail('EXCHANGE_STATE_CHANGED');
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'VEHICLE_EXCHANGE_REPLACEMENT_SELECTED',
            entityType: 'VehicleExchangeRequest',
            entityId: id,
            newData: {
              replacementVehicleId: input.vehicleId,
              rateCardVersionId: preview.rateCard.versionId,
            },
          },
        });
        return {
          exchange: await tx.vehicleExchangeRequest.findUniqueOrThrow({
            where: { id },
          }),
          preview,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async preview(clientId: string, id: string) {
    const exchange = await this.get(clientId, id);
    if (
      !exchange.replacementVehicleId ||
      !exchange.reservationExpiresAt ||
      exchange.reservationExpiresAt <= new Date()
    )
      fail('REPLACEMENT_HOLD_EXPIRED');
    const old = await this.db.riderAgreementCommercialVersion.findUnique({
      where: {
        agreementId_versionNumber: {
          agreementId: exchange.agreementId,
          versionNumber: exchange.baseVersionNumber,
        },
      },
    });
    if (!old) fail('COMMERCIAL_VERSION_MISSING');
    const snapshot = old.pricingSnapshot as Record<string, unknown>;
    const rental = snapshot.rental as {
      period: string;
      durationValue?: number;
      durationUnit?: string;
    };
    const selected = exchange.replacementSelection as Record<
      string,
      unknown
    > | null;
    if (!selected) fail('REPLACEMENT_SELECTION_MISSING');
    const price = await this.pricing.calculate(clientId, {
      ...selected,
      riderId: exchange.riderId,
    });
    const policy = await this.policy(clientId);
    if (!policy?.exchangeAllowed) fail('EXCHANGE_DISABLED');
    const now = new Date();
    const anchor =
      exchange.agreement.billingAnchorDate ??
      exchange.agreement.startDate ??
      now;
    const { periodStart, periodEnd } = billingWindow(
      anchor,
      now,
      rental.period,
      rental.durationValue,
      rental.durationUnit,
    );
    const oldPeriodPaid = await this.verifiedOldPeriodPayment(
      clientId,
      exchange.riderId,
      exchange.agreementId,
      old.amendmentId,
      old.recurringAmount,
      now,
    );
    const proration = prorateExchange({
      oldAmount: money(old.recurringAmount),
      newAmount: price.totals.recurringAmount,
      periodStart,
      periodEnd,
      effectiveAt: now,
      mode: policy.prorationMode,
      policy: policy.prorationPolicy,
      oldPeriodPaid,
    });
    const previous = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        vehicleId: exchange.oldVehicleId,
        sourceId: old.amendmentId ?? exchange.agreementId,
        depositType: { not: 'RIDER_SECURITY' },
      },
    });
    const pendingRefunds = await this.db.riderDepositRefundRequest.findMany({
      where: {
        clientId,
        depositId: { in: previous.map((row) => row.id) },
        status: 'REQUESTED',
      },
    });
    const oldByType: Record<string, Prisma.Decimal> = {};
    for (const row of previous) {
      const pending = pendingRefunds
        .filter((refund) => refund.depositId === row.id)
        .reduce(
          (sum, refund) => sum.plus(refund.amount),
          new Prisma.Decimal(0),
        );
      oldByType[row.depositType] = (
        oldByType[row.depositType] ?? new Prisma.Decimal(0)
      ).plus(
        Prisma.Decimal.max(
          new Prisma.Decimal(0),
          row.availableAmount.minus(pending),
        ),
      );
    }
    const newByType: Record<string, Prisma.Decimal> = {};
    for (const row of price.deposits as {
      type: string;
      finalRequired: string;
    }[]) {
      if (row.type === 'RIDER_SECURITY') continue;
      newByType[row.type] = (newByType[row.type] ?? new Prisma.Decimal(0)).plus(
        row.finalRequired,
      );
    }
    const existingSecurity = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        depositType: 'RIDER_SECURITY',
      },
    });
    const currentSecurity = existingSecurity.reduce(
      (sum, row) => sum.plus(row.requiredAmount),
      new Prisma.Decimal(0),
    );
    const proposedSecurity = (
      price.deposits as { type: string; finalRequired: string }[]
    )
      .filter((row) => row.type === 'RIDER_SECURITY')
      .reduce((sum, row) => sum.plus(row.finalRequired), new Prisma.Decimal(0));
    if (!currentSecurity.eq(proposedSecurity))
      fail('RIDER_SECURITY_CHANGE_REQUIRES_SEPARATE_AMENDMENT');
    const difference = depositDifferenceByType(
      Object.fromEntries(
        Object.entries(oldByType).map(([type, amount]) => [
          type,
          money(amount),
        ]),
      ),
      Object.fromEntries(
        Object.entries(newByType).map(([type, amount]) => [
          type,
          money(amount),
        ]),
      ),
    );
    const feeWaived =
      Array.isArray(policy.feeWaiverReasonCodes) &&
      policy.feeWaiverReasonCodes.includes(exchange.reasonCode);
    return {
      pricing: price,
      proration,
      prorationMode: policy.prorationMode,
      prorationPolicy: policy.prorationPolicy,
      billingStartAt:
        policy.prorationPolicy === 'START_NEW_NEXT_BILLING_CYCLE'
          ? periodEnd.toISOString()
          : null,
      depositDifference: difference,
      exchangeFee: feeWaived ? '0.00' : money(policy.exchangeFeeAmount),
      feeWaived,
      oldVehicleId: exchange.oldVehicleId,
      replacementVehicleId: exchange.replacementVehicleId,
      excessPolicy: policy.depositExcessPolicy,
      oldPeriodPaid,
    };
  }
  async present(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (exchange.status !== 'REPLACEMENT_SELECTED')
      fail('EXCHANGE_STATE_INVALID');
    const calculated = await this.preview(clientId, id);
    const terms = await this.db.riderCommercialTerms.findMany({
      where: { clientId, status: 'ACTIVE' },
      take: 2,
    });
    if (terms.length !== 1) fail('RIDER_TERMS_NOT_CONFIGURED');
    const policy = await this.policy(clientId);
    if (!policy?.exchangeAllowed) fail('EXCHANGE_DISABLED');
    const termsVersion = `${terms[0].code}@${terms[0].version}`;
    const hash = pricingHash(
      clientId,
      calculated.pricing,
      terms[0].contentHash,
      termsVersion,
    );
    const difference = {
      proration: calculated.proration,
      prorationMode: calculated.prorationMode,
      prorationPolicy: calculated.prorationPolicy,
      billingStartAt: calculated.billingStartAt,
      deposit: calculated.depositDifference,
      excessPolicy: calculated.excessPolicy,
      oldPeriodPaid: calculated.oldPeriodPaid,
      exchangeFee: calculated.exchangeFee,
      feeWaived: calculated.feeWaived,
    };
    const offerHash = sha256(
      canonicalJson({
        clientId,
        id,
        hash,
        difference,
        termsHash: terms[0].contentHash,
        termsTitle: terms[0].title,
      }),
    );
    return this.db.$transaction(
      async (tx) => {
        const changed = await tx.vehicleExchangeRequest.updateMany({
          where: {
            id,
            clientId,
            status: 'REPLACEMENT_SELECTED',
            reservationExpiresAt: { gt: new Date() },
          },
          data: { status: 'OFFER_PRESENTED', updatedById: actorId },
        });
        if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
        const offer = await tx.vehicleExchangeOffer.create({
          data: {
            clientId,
            exchangeRequestId: id,
            pricingSnapshot: json(calculated.pricing),
            pricingHash: hash,
            commercialDifference: json(difference),
            offerHash,
            termsSnapshot: terms[0].content,
            termsTitle: terms[0].title,
            termsHash: terms[0].contentHash,
            termsVersion,
            expiresAt: new Date(
              Date.now() + policy.offerValidityMinutes * 60_000,
            ),
            createdById: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'VEHICLE_EXCHANGE_OFFER_PRESENTED',
            entityType: 'VehicleExchangeOffer',
            entityId: offer.id,
            newData: { exchangeRequestId: id, offerHash, pricingHash: hash },
          },
        });
        return offer;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async rejectOffer(
    clientId: string,
    id: string,
    actorId: string,
    raw: unknown,
    riderId?: string,
  ) {
    const input = parseInput(
      z.object({ offerId: uuid, reason: z.string().min(1).max(500) }).strict(),
      raw,
    );
    const exchange = await this.get(clientId, id, riderId);
    if (exchange.status !== 'OFFER_PRESENTED') fail('EXCHANGE_STATE_INVALID');
    const offer = exchange.offers.find(
      (row) => row.id === input.offerId && row.status === 'PRESENTED',
    );
    if (!offer) fail('EXCHANGE_OFFER_NOT_PRESENTED');
    return this.db.$transaction(async (tx) => {
      const changed = await tx.vehicleExchangeRequest.updateMany({
        where: { clientId, id, status: 'OFFER_PRESENTED' },
        data: { status: 'REPLACEMENT_SELECTED', updatedById: actorId },
      });
      if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
      const offerChanged = await tx.vehicleExchangeOffer.updateMany({
        where: { id: offer.id, clientId, status: 'PRESENTED' },
        data: { status: 'REJECTED' },
      });
      if (!offerChanged.count) fail('EXCHANGE_OFFER_NOT_PRESENTED');
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'VEHICLE_EXCHANGE_OFFER_REJECTED',
          entityType: 'VehicleExchangeOffer',
          entityId: offer.id,
          newData: { reason: input.reason },
        },
      });
      return tx.vehicleExchangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }
  async accept(
    clientId: string,
    id: string,
    actorId: string,
    raw: unknown,
    riderId?: string,
    assisted = false,
  ) {
    const base = z.object({
      offerId: uuid,
      offerHash: z.string().length(64),
      consent: z.literal(true),
    });
    const assistedInput = assisted
      ? parseInput(
          base
            .extend({
              riderConsentReference: z.string().min(1).max(200),
              assistedReason: z.string().min(1).max(500),
            })
            .strict(),
          raw,
        )
      : null;
    const input = assistedInput ?? parseInput(base.strict(), raw);
    const exchange = await this.get(clientId, id, riderId);
    if (
      exchange.status !== 'OFFER_PRESENTED' ||
      exchange.agreement.status !== 'ACTIVE' ||
      exchange.agreement.currentCommercialVersionNumber !==
        exchange.baseVersionNumber
    )
      fail('EXCHANGE_VERSION_STALE');
    const offer = exchange.offers.find((row) => row.id === input.offerId);
    if (
      !offer ||
      offer.status !== 'PRESENTED' ||
      offer.expiresAt <= new Date() ||
      exchange.reservationExpiresAt! <= new Date()
    )
      fail('EXCHANGE_OFFER_EXPIRED');
    if (
      offer.offerHash !== input.offerHash ||
      sha256(
        canonicalJson({
          clientId,
          id,
          hash: offer.pricingHash,
          difference: offer.commercialDifference,
          termsHash: offer.termsHash,
          termsTitle: offer.termsTitle,
        }),
      ) !== offer.offerHash ||
      sha256(offer.termsSnapshot) !== offer.termsHash ||
      pricingHash(
        clientId,
        offer.pricingSnapshot,
        offer.termsHash,
        offer.termsVersion,
      ) !== offer.pricingHash
    )
      fail('EXCHANGE_OFFER_INTEGRITY_FAILED');
    const snapshot = offer.pricingSnapshot as Record<string, unknown>;
    const rateCard = snapshot.rateCard as { versionId: string };
    const totals = snapshot.totals as { recurringAmount: string };
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RiderRentalAgreement" WHERE "id" = ${exchange.agreementId} AND "clientId" = ${clientId} FOR UPDATE`;
        const currentAgreement =
          await tx.riderRentalAgreement.findUniqueOrThrow({
            where: { id: exchange.agreementId },
          });
        if (
          currentAgreement.status !== 'ACTIVE' ||
          currentAgreement.currentCommercialVersionNumber !==
            exchange.baseVersionNumber
        )
          fail('EXCHANGE_VERSION_STALE');
        const changed = await tx.vehicleExchangeRequest.updateMany({
          where: {
            clientId,
            id,
            status: 'OFFER_PRESENTED',
            baseVersionNumber: exchange.baseVersionNumber,
            reservationExpiresAt: { gt: new Date() },
          },
          data: {
            status: 'DEPOSIT_PENDING',
            acceptedAt: new Date(),
            reservationExpiresAt: null,
            updatedById: actorId,
          },
        });
        if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
        const number =
          (await tx.riderRentalAgreementAmendment.count({
            where: { agreementId: exchange.agreementId },
          })) + 1;
        const previousVersion =
          await tx.riderAgreementCommercialVersion.findUniqueOrThrow({
            where: {
              agreementId_versionNumber: {
                agreementId: exchange.agreementId,
                versionNumber: exchange.baseVersionNumber,
              },
            },
          });
        const amendment = await tx.riderRentalAgreementAmendment.create({
          data: {
            clientId,
            agreementId: exchange.agreementId,
            amendmentNumber: number,
            reason: exchange.reason ?? exchange.reasonCode,
            previousPricingHash: previousVersion.pricingHash,
            proposedPricingHash: offer.pricingHash,
            proposedPricingSnapshot: json(snapshot),
            status: 'ACCEPTED_PENDING_FULFILLMENT',
            createdById: actorId,
            approvedById: actorId,
            approvedAt: new Date(),
            acceptedAt: new Date(),
            exchangeRequestId: id,
            previousVehicleId: exchange.oldVehicleId,
            replacementVehicleId: exchange.replacementVehicleId,
            commercialDifference:
              offer.commercialDifference as Prisma.InputJsonValue,
          },
        });
        const offeredDifference = offer.commercialDifference as {
          billingStartAt?: string | null;
        };
        await tx.riderAgreementCommercialVersion.create({
          data: {
            clientId,
            agreementId: exchange.agreementId,
            versionNumber: exchange.baseVersionNumber + 1,
            vehicleId: exchange.replacementVehicleId!,
            rateCardVersionId: rateCard.versionId,
            pricingSnapshot: json(snapshot),
            pricingHash: offer.pricingHash,
            termsVersion: offer.termsVersion,
            termsHash: offer.termsHash,
            termsSnapshot: offer.termsSnapshot,
            termsTitle: offer.termsTitle,
            recurringAmount: new Prisma.Decimal(totals.recurringAmount),
            effectiveFrom: new Date(),
            billingStartAt: offeredDifference.billingStartAt
              ? new Date(offeredDifference.billingStartAt)
              : null,
            amendmentId: amendment.id,
            status: 'PENDING',
          },
        });
        await this.deposits.initializeInTransaction(
          tx,
          {
            ...exchange.agreement,
            vehicleId: exchange.replacementVehicleId!,
            pricingSnapshot: offer.pricingSnapshot,
            pricingHash: offer.pricingHash,
            pricingSnapshotSchemaVersion: 1,
            termsHash: offer.termsHash,
            termsVersion: offer.termsVersion,
          },
          actorId,
          amendment.id,
          true,
        );
        await tx.vehicleExchangeOffer.update({
          where: { id: offer.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedById: actorId,
            acceptanceMethod: assisted
              ? 'OPERATIONS_ASSISTED'
              : 'APP_CONFIRMATION',
            riderConsentReference: assistedInput?.riderConsentReference ?? null,
            assistedReason: assistedInput?.assistedReason ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'VEHICLE_EXCHANGE_ACCEPTED',
            entityType: 'VehicleExchangeRequest',
            entityId: id,
            newData: {
              offerId: offer.id,
              amendmentId: amendment.id,
              pricingHash: offer.pricingHash,
              acceptanceMethod: assisted
                ? 'OPERATIONS_ASSISTED'
                : 'APP_CONFIRMATION',
            },
          },
        });
        return amendment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async startReturn(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (
      !['APPROVED', 'RETURN_PENDING'].includes(exchange.status) ||
      !exchange.oldAllocationId
    )
      fail('EXCHANGE_STATE_INVALID');
    if (exchange.returnInspectionId) fail('OLD_RETURN_ALREADY_COMPLETED');
    if (exchange.status === 'RETURN_PENDING') return exchange;
    const pending = await this.db.inspection.findFirst({
      where: {
        clientId,
        allocationId: exchange.oldAllocationId,
        type: 'POST_DEALLOCATION',
      },
    });
    const result = pending
      ? { inspectionId: pending.id }
      : await this.allocations.initiateDeallocation(
          clientId,
          exchange.oldAllocationId,
        );
    await this.db.vehicleExchangeRequest.update({
      where: { id },
      data: {
        status: 'RETURN_PENDING',
        returnInspectionId: result.inspectionId,
        updatedById: actorId,
      },
    });
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'VEHICLE_EXCHANGE_RETURN_STARTED',
        entityType: 'VehicleExchangeRequest',
        entityId: id,
        newData: { inspectionId: result.inspectionId },
      },
    });
    return this.get(clientId, id);
  }
  async confirmReturn(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (exchange.status !== 'RETURN_PENDING' || !exchange.oldAllocationId)
      fail('EXCHANGE_STATE_INVALID');
    const allocation = await this.db.allocation.findFirst({
      where: { clientId, id: exchange.oldAllocationId, status: 'COMPLETED' },
    });
    if (!allocation) fail('OLD_RETURN_NOT_COMPLETED');
    const inspection = await this.db.inspection.findFirst({
      where: {
        clientId,
        allocationId: allocation.id,
        type: 'POST_DEALLOCATION',
        status: 'COMPLETED',
      },
    });
    if (!inspection) fail('RETURN_INSPECTION_NOT_COMPLETED');
    return this.db.$transaction(async (tx) => {
      const released = await tx.riderRentalAgreement.updateMany({
        where: {
          clientId,
          id: exchange.agreementId,
          status: 'ACTIVE',
          currentVehicleId: exchange.oldVehicleId,
          currentCommercialVersionNumber: exchange.baseVersionNumber,
        },
        data: { currentVehicleId: null, updatedById: actorId },
      });
      if (!released.count) fail('EXCHANGE_VERSION_STALE');
      const changed = await tx.vehicleExchangeRequest.updateMany({
        where: { clientId, id, status: 'RETURN_PENDING' },
        data: {
          status: 'APPROVED',
          returnInspectionId: inspection.id,
          updatedById: actorId,
        },
      });
      if (!changed.count) fail('EXCHANGE_STATE_CHANGED');
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'VEHICLE_EXCHANGE_OLD_VEHICLE_RETURNED',
          entityType: 'VehicleExchangeRequest',
          entityId: id,
          newData: { inspectionId: inspection.id, allocationId: allocation.id },
        },
      });
      return tx.vehicleExchangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }
  async reconcileDeposits(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (exchange.status !== 'DEPOSIT_PENDING') fail('EXCHANGE_STATE_INVALID');
    const amendment = await this.db.riderRentalAgreementAmendment.findUnique({
      where: { exchangeRequestId: id },
    });
    if (!amendment) fail('EXCHANGE_AMENDMENT_MISSING');
    const previousVersion =
      await this.db.riderAgreementCommercialVersion.findUniqueOrThrow({
        where: {
          agreementId_versionNumber: {
            agreementId: exchange.agreementId,
            versionNumber: exchange.baseVersionNumber,
          },
        },
      });
    const sources = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        vehicleId: exchange.oldVehicleId,
        sourceId: previousVersion.amendmentId ?? exchange.agreementId,
        depositType: { not: 'RIDER_SECURITY' },
      },
      orderBy: { id: 'asc' },
    });
    const targets = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        sourceType: 'AGREEMENT_AMENDMENT',
        sourceId: amendment.id,
        vehicleId: exchange.replacementVehicleId,
      },
      orderBy: { id: 'asc' },
    });
    for (const target of targets) {
      let needed = target.requiredAmount.minus(target.fundedAmount);
      for (const source of sources) {
        if (source.depositType !== target.depositType) continue;
        if (needed.lte(0)) break;
        const current = await this.db.riderDeposit.findUniqueOrThrow({
          where: { id: source.id },
        });
        const pending = await this.db.riderDepositRefundRequest.aggregate({
          where: { clientId, depositId: source.id, status: 'REQUESTED' },
          _sum: { amount: true },
        });
        const transferable = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          current.availableAmount.minus(pending._sum.amount ?? 0),
        );
        const amount = Prisma.Decimal.min(transferable, needed);
        if (amount.lte(0)) continue;
        await this.deposits.transfer(
          clientId,
          actorId,
          {
            sourceDepositId: source.id,
            targetDepositId: target.id,
            amount: money(amount),
            reason: 'Vehicle exchange deposit transfer',
            referenceType: 'VEHICLE_EXCHANGE',
            referenceId: id,
          },
          `exchange:${id}:${source.id}:${target.id}`,
        );
        needed = needed.minus(amount);
      }
    }
    const refreshed = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        sourceType: 'AGREEMENT_AMENDMENT',
        sourceId: amendment.id,
      },
    });
    const security = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        depositType: 'RIDER_SECURITY',
      },
    });
    const securityShortfall = security.reduce(
      (sum, row) =>
        sum.plus(
          Prisma.Decimal.max(
            new Prisma.Decimal(0),
            row.requiredAmount.minus(row.availableAmount),
          ),
        ),
      new Prisma.Decimal(0),
    );
    const outstanding = refreshed.reduce(
      (sum, row) =>
        sum.plus(
          Prisma.Decimal.max(
            new Prisma.Decimal(0),
            row.requiredAmount.minus(row.fundedAmount),
          ),
        ),
      securityShortfall,
    );
    if (outstanding.gt(0))
      return {
        status: 'DEPOSIT_PENDING',
        additionalRequired: money(outstanding),
        riderSecurityShortfall: money(securityShortfall),
        deposits: refreshed,
      };
    const acceptedOffer = exchange.offers.find(
      (row) => row.status === 'ACCEPTED',
    );
    if (!acceptedOffer) fail('EXCHANGE_OFFER_MISSING');
    const acceptedDifference = acceptedOffer.commercialDifference as {
      excessPolicy: string;
    };
    if (acceptedDifference.excessPolicy === 'REFUND_REQUEST') {
      for (const source of sources) {
        const current = await this.db.riderDeposit.findUniqueOrThrow({
          where: { id: source.id },
        });
        if (current.availableAmount.gt(0))
          await this.deposits.requestRefund(
            clientId,
            actorId,
            source.id,
            {
              amount: money(current.availableAmount),
              reason: 'Vehicle exchange excess deposit',
              referenceType: 'VEHICLE_EXCHANGE',
              referenceId: id,
            },
            `exchange:excess:${id}:${source.id}`,
          );
      }
    }
    await this.db.vehicleExchangeRequest.update({
      where: { id },
      data: { status: 'HANDOVER_PENDING', updatedById: actorId },
    });
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'VEHICLE_EXCHANGE_DEPOSITS_READY',
        entityType: 'VehicleExchangeRequest',
        entityId: id,
      },
    });
    return {
      status: 'HANDOVER_PENDING',
      additionalRequired: '0.00',
      deposits: refreshed,
    };
  }
  async startHandover(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (
      exchange.status !== 'HANDOVER_PENDING' ||
      !exchange.replacementVehicleId
    )
      fail('EXCHANGE_STATE_INVALID');
    if (exchange.newAllocationId) return exchange;
    const existing = await this.db.allocation.findFirst({
      where: { clientId, idempotencyKey: `exchange:${id}` },
    });
    const allocation =
      existing ??
      (await this.allocations.initiate(
        clientId,
        exchange.replacementVehicleId,
        exchange.riderId,
        actorId,
        `exchange:${id}`,
      ));
    const updated = await this.db.vehicleExchangeRequest.update({
      where: { id },
      data: { newAllocationId: allocation.id, updatedById: actorId },
    });
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'VEHICLE_EXCHANGE_HANDOVER_STARTED',
        entityType: 'VehicleExchangeRequest',
        entityId: id,
        newData: { allocationId: allocation.id },
      },
    });
    return updated;
  }
  async complete(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (exchange.status !== 'HANDOVER_PENDING' || !exchange.newAllocationId)
      fail('EXCHANGE_STATE_INVALID');
    if (exchange.agreement.status !== 'ACTIVE') fail('AGREEMENT_NOT_ACTIVE');
    const allocation = await this.db.allocation.findFirst({
      where: {
        clientId,
        id: exchange.newAllocationId,
        riderId: exchange.riderId,
        fleetId: exchange.replacementVehicleId!,
        status: 'ACTIVE',
      },
    });
    if (!allocation?.allocatedAt) fail('NEW_HANDOVER_NOT_COMPLETED');
    const effectiveAt = allocation.allocatedAt;
    const replacementVehicleId = exchange.replacementVehicleId!;
    const amendment = await this.db.riderRentalAgreementAmendment.findUnique({
      where: { exchangeRequestId: id },
    });
    if (!amendment) fail('EXCHANGE_AMENDMENT_MISSING');
    const acceptedOffer = exchange.offers.find(
      (row) => row.status === 'ACCEPTED',
    );
    if (!acceptedOffer) fail('EXCHANGE_OFFER_MISSING');
    const difference = acceptedOffer.commercialDifference as {
      proration: { newCharge: string; oldCredit: string };
      prorationMode:
        | 'NONE'
        | 'DAILY'
        | 'HOURLY'
        | 'CALENDAR_DAY'
        | 'BILLING_PERIOD_REMAINDER';
      prorationPolicy:
        | 'NO_PRORATION'
        | 'PRORATE_OLD_ONLY'
        | 'PRORATE_NEW_ONLY'
        | 'PRORATE_BOTH'
        | 'START_NEW_NEXT_BILLING_CYCLE';
      oldPeriodPaid: boolean;
      billingStartAt?: string | null;
      exchangeFee: string;
    };
    const oldVersion =
      await this.db.riderAgreementCommercialVersion.findUniqueOrThrow({
        where: {
          agreementId_versionNumber: {
            agreementId: exchange.agreementId,
            versionNumber: exchange.baseVersionNumber,
          },
        },
      });
    if (
      difference.oldPeriodPaid &&
      !(await this.verifiedOldPeriodPayment(
        clientId,
        exchange.riderId,
        exchange.agreementId,
        oldVersion.amendmentId,
        oldVersion.recurringAmount,
        effectiveAt,
      ))
    )
      fail('OLD_RENTAL_PAYMENT_NO_LONGER_VERIFIED');
    const oldRental = (oldVersion.pricingSnapshot as Record<string, unknown>)
      .rental as {
      period: string;
      durationValue?: number;
      durationUnit?: string;
    };
    const newTotal = (
      (acceptedOffer.pricingSnapshot as Record<string, unknown>).totals as {
        recurringAmount: string;
      }
    ).recurringAmount;
    const actualWindow = billingWindow(
      exchange.agreement.billingAnchorDate ??
        exchange.agreement.startDate ??
        effectiveAt,
      effectiveAt,
      oldRental.period,
      oldRental.durationValue,
      oldRental.durationUnit,
    );
    const actualProration = prorateExchange({
      oldAmount: money(oldVersion.recurringAmount),
      newAmount: newTotal,
      ...actualWindow,
      effectiveAt,
      mode: difference.prorationMode,
      policy: difference.prorationPolicy,
      oldPeriodPaid: difference.oldPeriodPaid,
    });
    if (
      actualProration.newCharge !== difference.proration.newCharge ||
      actualProration.oldCredit !== difference.proration.oldCredit
    )
      fail('EXCHANGE_PRORATION_STALE');
    if (
      difference.billingStartAt &&
      actualWindow.periodEnd.toISOString() !== difference.billingStartAt
    )
      fail('EXCHANGE_BILLING_CYCLE_STALE');
    const deposits = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        sourceType: 'AGREEMENT_AMENDMENT',
        sourceId: amendment.id,
      },
    });
    if (deposits.some((row) => row.fundedAmount.lt(row.requiredAmount)))
      fail('EXCHANGE_DEPOSIT_OUTSTANDING');
    const security = await this.db.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        depositType: 'RIDER_SECURITY',
      },
    });
    if (security.some((row) => row.availableAmount.lt(row.requiredAmount)))
      fail('RIDER_SECURITY_REPLENISHMENT_REQUIRED');
    return this.db.$transaction(
      async (tx) => {
        const changed = await tx.riderRentalAgreement.updateMany({
          where: {
            id: exchange.agreementId,
            clientId,
            status: 'ACTIVE',
            currentCommercialVersionNumber: exchange.baseVersionNumber,
            currentVehicleId: null,
          },
          data: {
            currentVehicleId: replacementVehicleId,
            currentCommercialVersionNumber: exchange.baseVersionNumber + 1,
            updatedById: actorId,
          },
        });
        if (!changed.count) fail('EXCHANGE_VERSION_STALE');
        const newCharge = new Prisma.Decimal(difference.proration.newCharge);
        if (newCharge.gt(0)) {
          const charge = await tx.riderCharge.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              sourceKey: `exchange:${id}:proration`,
              chargeType: 'VEHICLE_EXCHANGE_PRORATION',
              referenceType: 'VEHICLE_EXCHANGE',
              referenceId: id,
              description: 'Replacement vehicle prorated rental',
              quantity: new Prisma.Decimal(1),
              unitAmount: newCharge,
              amount: newCharge,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
          await tx.riderLedgerEntry.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              entryType: 'CHARGE',
              sourceType: 'RIDER_CHARGE',
              sourceId: charge.id,
              description: charge.description,
              debitAmount: newCharge,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
        }
        const exchangeFee = new Prisma.Decimal(difference.exchangeFee);
        if (exchangeFee.gt(0)) {
          const fee = await tx.riderCharge.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              sourceKey: `exchange:${id}:fee`,
              chargeType: 'VEHICLE_EXCHANGE_FEE',
              referenceType: 'VEHICLE_EXCHANGE',
              referenceId: id,
              description: 'Vehicle exchange fee',
              quantity: new Prisma.Decimal(1),
              unitAmount: exchangeFee,
              amount: exchangeFee,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
          await tx.riderLedgerEntry.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              entryType: 'CHARGE',
              sourceType: 'RIDER_CHARGE',
              sourceId: fee.id,
              description: fee.description,
              debitAmount: exchangeFee,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
        }
        const oldCredit = new Prisma.Decimal(difference.proration.oldCredit);
        if (oldCredit.gt(0)) {
          const credit = await tx.riderCredit.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              sourceKey: `exchange:${id}:credit`,
              creditType: 'VEHICLE_EXCHANGE_UNUSED_RENTAL',
              referenceType: 'VEHICLE_EXCHANGE',
              referenceId: id,
              description: 'Unused rental on returned vehicle',
              amount: oldCredit,
              remainingAmount: oldCredit,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
          await tx.riderLedgerEntry.create({
            data: {
              clientId,
              riderId: exchange.riderId,
              entryType: 'CREDIT',
              sourceType: 'RIDER_CREDIT',
              sourceId: credit.id,
              description: credit.description,
              creditAmount: oldCredit,
              currency: exchange.agreement.currency,
              effectiveAt,
            },
          });
        }
        await tx.riderAgreementCommercialVersion.update({
          where: {
            agreementId_versionNumber: {
              agreementId: exchange.agreementId,
              versionNumber: exchange.baseVersionNumber,
            },
          },
          data: { effectiveTo: effectiveAt, status: 'SUPERSEDED' },
        });
        await tx.riderAgreementCommercialVersion.update({
          where: {
            agreementId_versionNumber: {
              agreementId: exchange.agreementId,
              versionNumber: exchange.baseVersionNumber + 1,
            },
          },
          data: {
            effectiveFrom: effectiveAt,
            billingStartAt: difference.billingStartAt
              ? new Date(difference.billingStartAt)
              : effectiveAt,
            status: 'ACTIVE',
          },
        });
        await tx.riderRentalAgreementAmendment.update({
          where: { id: amendment.id },
          data: { status: 'ACTIVE', effectiveAt, activatedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'VEHICLE_EXCHANGE_COMPLETED',
            entityType: 'VehicleExchangeRequest',
            entityId: id,
            newData: {
              amendmentId: amendment.id,
              oldVehicleId: exchange.oldVehicleId,
              replacementVehicleId,
              effectiveAt: effectiveAt.toISOString(),
            },
          },
        });
        return tx.vehicleExchangeRequest.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            effectiveAt,
            completedAt: new Date(),
            updatedById: actorId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async cancel(clientId: string, id: string, actorId: string) {
    const exchange = await this.get(clientId, id);
    if (
      ![
        'REQUESTED',
        'APPROVED',
        'REPLACEMENT_SELECTED',
        'OFFER_PRESENTED',
      ].includes(exchange.status) ||
      exchange.returnInspectionId
    )
      fail('EXCHANGE_CANCELLATION_REQUIRES_COMPENSATION');
    return this.db.$transaction(async (tx) => {
      const changed = await tx.vehicleExchangeRequest.updateMany({
        where: {
          clientId,
          id,
          status: {
            in: [
              'REQUESTED',
              'APPROVED',
              'REPLACEMENT_SELECTED',
              'OFFER_PRESENTED',
            ],
          },
          returnInspectionId: null,
        },
        data: {
          status: 'CANCELLED',
          reservationExpiresAt: null,
          updatedById: actorId,
        },
      });
      if (!changed.count) fail('EXCHANGE_CANCELLATION_REQUIRES_COMPENSATION');
      await tx.vehicleExchangeOffer.updateMany({
        where: { exchangeRequestId: id, status: 'PRESENTED' },
        data: { status: 'CANCELLED' },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'VEHICLE_EXCHANGE_CANCELLED',
          entityType: 'VehicleExchangeRequest',
          entityId: id,
        },
      });
      return tx.vehicleExchangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}
