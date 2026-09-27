import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RiderRentalAgreementStatus,
  type RiderCommercialOffer,
  type RiderRentalAgreement,
  type RiderAgreementCommercialVersion,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommercialOfferService } from './commercial-offer.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import {
  canonicalJson,
  parseSnapshot,
  pricingHash,
  PRICING_SNAPSHOT_SCHEMA_VERSION,
  sha256,
  riderSnapshotView,
} from './commercial-snapshot.js';

const uuid = z.string().uuid();
const selectionSchema = z
  .object({
    riderId: uuid,
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
    durationUnit: z.string().min(1).max(20).optional(),
    batteryPlanId: uuid.optional(),
    effectiveDate: z.iso.date().optional(),
    promotionCode: z.string().min(1).max(80).optional(),
    supersedesOfferId: uuid.optional(),
  })
  .strict();
const termsSchema = z
  .object({
    code: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    content: z.string().min(1),
  })
  .strict();
const acceptanceSchema = z
  .object({
    consent: z.literal(true),
    acceptedTermsVersion: z.string().min(1),
    startDate: z.iso.date().optional(),
  })
  .strict();
const assistedSchema = acceptanceSchema.extend({
  riderConsentReference: z.string().min(1),
  reason: z.string().min(1),
});
const reasonSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
const ACTIVE_AGREEMENT_STATUSES: RiderRentalAgreementStatus[] = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATION_PENDING',
];
const fail = (code: string): never => {
  throw new ConflictException({ code, message: code });
};
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const json = (value: unknown) => value as Prisma.InputJsonValue;
function agreementEnd(
  start: Date | null,
  period: string,
  count: number | null,
  unit: string | null,
): Date | null {
  if (!start || period !== 'CUSTOM' || !count || !unit) return null;
  const result = new Date(start);
  const normalized = unit.toUpperCase();
  if (normalized === 'DAY' || normalized === 'DAYS')
    result.setUTCDate(result.getUTCDate() + count);
  else if (normalized === 'WEEK' || normalized === 'WEEKS')
    result.setUTCDate(result.getUTCDate() + count * 7);
  else if (normalized === 'MONTH' || normalized === 'MONTHS') {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);
    result.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  } else throw new BadRequestException('Unsupported custom duration unit');
  return result;
}

@Injectable()
export class CommercialLifecycleService {
  private readonly logger = new Logger(CommercialLifecycleService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: CommercialOfferService,
    private readonly deposits: RiderDepositService,
  ) {}
  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return result.data;
  }
  private async nextNumber(
    tx: Prisma.TransactionClient,
    kind: 'offer' | 'agreement',
  ) {
    const rows =
      kind === 'offer'
        ? await tx.$queryRaw<
            { value: bigint }[]
          >`SELECT nextval('rider_commercial_offer_number_seq') AS value`
        : await tx.$queryRaw<
            { value: bigint }[]
          >`SELECT nextval('rider_rental_agreement_number_seq') AS value`;
    return `${kind === 'offer' ? 'EVO' : 'EVRA'}-${new Date().getUTCFullYear()}-${rows[0].value.toString().padStart(6, '0')}`;
  }
  private audit(
    tx: Prisma.TransactionClient,
    clientId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    previousData?: object,
    newData?: object,
  ) {
    return tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action,
        entityType,
        entityId,
        previousData: previousData as Prisma.InputJsonValue | undefined,
        newData: newData as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async createTerms(clientId: string, actorId: string, raw: unknown) {
    const input = this.parse(termsSchema, raw);
    return this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.riderCommercialTerms.aggregate({
          where: { clientId, code: input.code },
          _max: { version: true },
        });
        const row = await tx.riderCommercialTerms.create({
          data: {
            ...input,
            clientId,
            version: (latest._max.version ?? 0) + 1,
            contentHash: sha256(input.content),
            createdById: actorId,
          },
        });
        await this.audit(
          tx,
          clientId,
          actorId,
          'RIDER_TERMS_CREATED',
          'RiderCommercialTerms',
          row.id,
          undefined,
          {
            code: row.code,
            version: row.version,
            contentHash: row.contentHash,
          },
        );
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async activateTerms(clientId: string, actorId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.riderCommercialTerms.findFirst({
          where: { clientId, id },
        });
        if (!row)
          throw new NotFoundException({ code: 'RIDER_TERMS_NOT_FOUND' });
        if (row.status !== 'DRAFT') fail('INVALID_TERMS_TRANSITION');
        await tx.riderCommercialTerms.updateMany({
          where: { clientId, status: 'ACTIVE' },
          data: { status: 'INACTIVE' },
        });
        const active = await tx.riderCommercialTerms.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            activatedById: actorId,
            activatedAt: new Date(),
          },
        });
        await this.audit(
          tx,
          clientId,
          actorId,
          'RIDER_TERMS_ACTIVATED',
          'RiderCommercialTerms',
          id,
          { status: row.status },
          { status: active.status, version: active.version },
        );
        return active;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  listTerms(clientId: string) {
    return this.prisma.riderCommercialTerms.findMany({
      where: { clientId },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
  }

  async createOffer(
    clientId: string,
    actorId: string,
    raw: unknown,
    idempotencyKey?: string,
    riderScoped = false,
  ) {
    const input = this.parse(selectionSchema, raw);
    const { supersedesOfferId, ...selection } = input;
    const rentalRestriction = await this.prisma.commercialRestriction.findFirst({ where: { clientId, riderId: selection.riderId, code: 'BLOCK_NEW_RENTAL', status: 'ACTIVE' } });
    if (rentalRestriction) fail('COLLECTION_RESTRICTION_ACTIVE');
    if (
      idempotencyKey &&
      (idempotencyKey.length < 1 || idempotencyKey.length > 200)
    )
      throw new BadRequestException('Invalid idempotency key');
    if (riderScoped && supersedesOfferId)
      throw new BadRequestException('Rider cannot supersede an offer');
    const selectionHash = sha256(
      canonicalJson({ clientId, selection, supersedesOfferId }),
    );
    if (idempotencyKey) {
      const existing = await this.prisma.riderCommercialOffer.findFirst({
        where: { clientId, idempotencyKey },
      });
      if (existing) {
        if (existing.selectionHash !== selectionHash)
          fail('IDEMPOTENCY_KEY_REUSED');
        return existing;
      }
    }
    const result = await this.pricing.calculate(
      clientId,
      selection,
      riderScoped,
    );
    const [card, termsRows] = await Promise.all([
      this.prisma.riderRateCard.findFirst({
        where: { clientId, id: result.rateCard.id, status: 'ACTIVE' },
      }),
      this.prisma.riderCommercialTerms.findMany({
        where: { clientId, status: 'ACTIVE' },
        take: 2,
      }),
    ]);
    if (!card)
      throw new ConflictException({
        code: 'COMMERCIAL_OFFER_RECALCULATION_REQUIRED',
      });
    if (termsRows.length !== 1) fail('RIDER_TERMS_NOT_CONFIGURED');
    const terms = termsRows[0];
    const termsVersion = `${terms.code}@${terms.version}`;
    const expiresAt = new Date(Date.now() + card.offerValidityMinutes * 60_000);
    const calculationHash = pricingHash(
      clientId,
      result,
      terms.contentHash,
      termsVersion,
    );
    const now = new Date();
    const offer = await this.prisma.$transaction(
      async (tx) => {
        if (supersedesOfferId) {
          const previous = await tx.riderCommercialOffer.findFirst({
            where: {
              clientId,
              id: supersedesOfferId,
              riderId: selection.riderId,
              vehicleId: selection.vehicleId,
            },
          });
          if (!previous)
            throw new NotFoundException({ code: 'COMMERCIAL_OFFER_NOT_FOUND' });
          if (!['CALCULATED', 'PRESENTED'].includes(previous.status))
            fail('COMMERCIAL_OFFER_NOT_SUPERSEDABLE');
        }
        const id = randomUUID();
        const offerNumber = await this.nextNumber(tx, 'offer');
        const created = await tx.riderCommercialOffer.create({
          data: {
            id,
            clientId,
            offerNumber,
            riderId: selection.riderId,
            vehicleId: selection.vehicleId,
            hubId: result.hub?.id ?? null,
            rateCardId: result.rateCard.id,
            rateCardVersionId: result.rateCard.versionId,
            rentalPeriodType: selection.rentalPeriodType,
            durationValue: selection.durationValue,
            durationUnit: selection.durationUnit,
            batteryPlanId: selection.batteryPlanId,
            promotionCode: selection.promotionCode,
            effectiveDate: date(result.effectiveDate),
            currency: result.currency,
            status: riderScoped ? 'PRESENTED' : 'CALCULATED',
            finalRecurringAmount: result.totals.recurringAmount,
            upfrontAmount: result.totals.payableToday,
            refundableAmount: result.totals.refundableDepositAmount,
            pricingSnapshot: json(result),
            pricingSnapshotSchemaVersion: PRICING_SNAPSHOT_SCHEMA_VERSION,
            calculationHash,
            selectionHash,
            termsVersion,
            termsTitle: terms.title,
            termsSnapshot: terms.content,
            termsHash: terms.contentHash,
            expiresAt,
            presentedAt: riderScoped ? now : null,
            idempotencyKey,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        if (supersedesOfferId) {
          const superseded = await tx.riderCommercialOffer.updateMany({
            where: {
              clientId,
              id: supersedesOfferId,
              status: { in: ['CALCULATED', 'PRESENTED'] },
            },
            data: {
              status: 'SUPERSEDED',
              supersededAt: now,
              supersededByOfferId: created.id,
              updatedById: actorId,
            },
          });
          if (superseded.count !== 1) fail('COMMERCIAL_OFFER_NOT_SUPERSEDABLE');
        }
        await this.audit(
          tx,
          clientId,
          actorId,
          'COMMERCIAL_OFFER_CREATED',
          'RiderCommercialOffer',
          created.id,
          undefined,
          { offerNumber, status: created.status, calculationHash },
        );
        if (supersedesOfferId)
          await this.audit(
            tx,
            clientId,
            actorId,
            'COMMERCIAL_OFFER_SUPERSEDED',
            'RiderCommercialOffer',
            supersedesOfferId,
            { status: 'PRESENTED' },
            { status: 'SUPERSEDED', supersededByOfferId: created.id },
          );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.logger.log(
      JSON.stringify({
        event: 'COMMERCIAL_OFFER_CREATED',
        clientId,
        offerId: offer.id,
        offerNumber: offer.offerNumber,
        riderId: offer.riderId,
        vehicleId: offer.vehicleId,
        rateCardVersionId: offer.rateCardVersionId,
      }),
    );
    return offer;
  }
  async getOffer(clientId: string, id: string, riderId?: string) {
    const offer = await this.prisma.riderCommercialOffer.findFirst({
      where: { clientId, id, ...(riderId ? { riderId } : {}) },
    });
    if (!offer)
      throw new NotFoundException({ code: 'COMMERCIAL_OFFER_NOT_FOUND' });
    return offer;
  }
  listOffers(clientId: string, riderId?: string) {
    return this.prisma.riderCommercialOffer.findMany({
      where: { clientId, ...(riderId ? { riderId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  offerView(offer: RiderCommercialOffer) {
    const snapshot = parseSnapshot(
      offer.pricingSnapshot,
      offer.pricingSnapshotSchemaVersion,
    );
    const totals = snapshot.totals as {
      recurringAmount: string;
      payableToday: string;
      refundableDepositAmount: string;
    };
    return {
      id: offer.id,
      offerNumber: offer.offerNumber,
      status:
        offer.expiresAt < new Date() &&
        ['CALCULATED', 'PRESENTED'].includes(offer.status)
          ? 'EXPIRED'
          : offer.status,
      validUntil: offer.expiresAt,
      rentalPeriodType: offer.rentalPeriodType,
      recurringAmount: totals.recurringAmount,
      payableToday: totals.payableToday,
      refundableAmount: totals.refundableDepositAmount,
      ...riderSnapshotView(snapshot),
      termsVersion: offer.termsVersion,
      termsTitle: offer.termsTitle,
      termsContent: offer.termsSnapshot,
    };
  }
  async transitionOffer(
    clientId: string,
    actorId: string,
    id: string,
    action: 'PRESENT' | 'REJECT' | 'CANCEL',
    raw?: unknown,
    riderId?: string,
  ) {
    const reason =
      action === 'PRESENT' ? undefined : this.parse(reasonSchema, raw).reason;
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.riderCommercialOffer.findFirst({
        where: { clientId, id, ...(riderId ? { riderId } : {}) },
      });
      if (!offer)
        throw new NotFoundException({ code: 'COMMERCIAL_OFFER_NOT_FOUND' });
      if (offer.expiresAt <= new Date()) fail('COMMERCIAL_OFFER_EXPIRED');
      const expected = action === 'PRESENT' ? 'CALCULATED' : 'PRESENTED';
      if (offer.status !== expected) fail('COMMERCIAL_OFFER_NOT_ACCEPTABLE');
      const status =
        action === 'PRESENT'
          ? 'PRESENTED'
          : action === 'REJECT'
            ? 'REJECTED'
            : 'CANCELLED';
      const now = new Date();
      const updated = await tx.riderCommercialOffer.updateMany({
        where: { clientId, id, status: expected },
        data: {
          status,
          ...(action === 'PRESENT'
            ? { presentedAt: now }
            : action === 'REJECT'
              ? {
                  rejectedAt: now,
                  rejectedById: actorId,
                  rejectionReason: reason,
                }
              : {
                  cancelledAt: now,
                  cancelledById: actorId,
                  cancellationReason: reason,
                }),
          updatedById: actorId,
        },
      });
      if (updated.count !== 1) fail('COMMERCIAL_OFFER_NOT_ACCEPTABLE');
      await this.audit(
        tx,
        clientId,
        actorId,
        `COMMERCIAL_OFFER_${status}`,
        'RiderCommercialOffer',
        id,
        { status: expected },
        { status, reason },
      );
      return tx.riderCommercialOffer.findUniqueOrThrow({ where: { id } });
    });
  }
  async acceptOffer(
    clientId: string,
    actorId: string,
    id: string,
    raw: unknown,
    riderId?: string,
    assisted = false,
  ) {
    const input = this.parse(assisted ? assistedSchema : acceptanceSchema, raw);
    const now = new Date();
    const agreement = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "RiderCommercialOffer" WHERE "id" = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
        if (!locked.length)
          throw new NotFoundException({ code: 'COMMERCIAL_OFFER_NOT_FOUND' });
        const offer = await tx.riderCommercialOffer.findFirst({
          where: { clientId, id, ...(riderId ? { riderId } : {}) },
        });
        if (!offer)
          throw new NotFoundException({ code: 'COMMERCIAL_OFFER_NOT_FOUND' });
        if (offer.status === 'ACCEPTED') {
          const existing = await tx.riderRentalAgreement.findUnique({
            where: { commercialOfferId: id },
          });
          if (existing) return existing;
          fail('COMMERCIAL_OFFER_INTEGRITY_FAILED');
        }
        if (offer.expiresAt <= now) fail('COMMERCIAL_OFFER_EXPIRED');
        if (offer.status !== 'PRESENTED')
          fail(`COMMERCIAL_OFFER_${offer.status}`);
        if (input.acceptedTermsVersion !== offer.termsVersion)
          fail('TERMS_VERSION_MISMATCH');
        if (sha256(offer.termsSnapshot) !== offer.termsHash)
          fail('COMMERCIAL_OFFER_INTEGRITY_FAILED');
        const snapshot = parseSnapshot(
          offer.pricingSnapshot,
          offer.pricingSnapshotSchemaVersion,
        );
        if (
          pricingHash(
            clientId,
            offer.pricingSnapshot,
            offer.termsHash,
            offer.termsVersion,
          ) !== offer.calculationHash
        )
          fail('COMMERCIAL_OFFER_INTEGRITY_FAILED');
        const snapshotRateCard = snapshot.rateCard as {
          id: string;
          versionId: string;
        };
        const snapshotRider = snapshot.rider as { id: string };
        const snapshotVehicle = snapshot.vehicle as { id: string };
        const totals = snapshot.totals as {
          recurringAmount: string;
          payableToday: string;
          refundableDepositAmount: string;
        };
        if (
          snapshotRider.id !== offer.riderId ||
          snapshotVehicle.id !== offer.vehicleId ||
          snapshotRateCard.id !== offer.rateCardId ||
          snapshotRateCard.versionId !== offer.rateCardVersionId ||
          totals.recurringAmount !== offer.finalRecurringAmount.toFixed(2) ||
          totals.payableToday !== offer.upfrontAmount.toFixed(2) ||
          totals.refundableDepositAmount !== offer.refundableAmount.toFixed(2)
        )
          fail('COMMERCIAL_OFFER_INTEGRITY_FAILED');
        // Sorted advisory locks serialize competing offers for either the rider or vehicle.
        for (const key of [
          `${clientId}:rider:${offer.riderId}`,
          `${clientId}:vehicle:${offer.vehicleId}`,
        ].sort())
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const [
          rider,
          vehicle,
          hub,
          version,
          activeAllocation,
          conflictingAllocation,
          riderConflict,
          vehicleConflict,
        ] = await Promise.all([
          tx.rider.findFirst({
            where: { clientId, id: offer.riderId, deletedAt: null },
          }),
          tx.fleet.findFirst({
            where: { clientId, id: offer.vehicleId, deletedAt: null },
          }),
          offer.hubId
            ? tx.hub.findFirst({
                where: { clientId, id: offer.hubId, deletedAt: null },
              })
            : Promise.resolve(null),
          tx.riderRateCardVersion.findFirst({
            where: {
              clientId,
              id: offer.rateCardVersionId,
              rateCardId: offer.rateCardId,
            },
          }),
          tx.allocation.findFirst({
            where: {
              clientId,
              riderId: offer.riderId,
              fleetId: offer.vehicleId,
              status: {
                in: [
                  'INITIATED',
                  'INSPECTION_PENDING',
                  'OTP_PENDING',
                  'ACTIVE',
                ],
              },
            },
          }),
          tx.allocation.findFirst({
            where: {
              clientId,
              fleetId: offer.vehicleId,
              riderId: { not: offer.riderId },
              status: {
                in: [
                  'INITIATED',
                  'INSPECTION_PENDING',
                  'OTP_PENDING',
                  'ACTIVE',
                  'DEALLOCATION_INITIATED',
                ],
              },
            },
          }),
          tx.riderRentalAgreement.findFirst({
            where: {
              clientId,
              riderId: offer.riderId,
              status: { in: ACTIVE_AGREEMENT_STATUSES },
            },
          }),
          tx.riderRentalAgreement.findFirst({
            where: {
              clientId,
              currentVehicleId: offer.vehicleId,
              status: { in: ACTIVE_AGREEMENT_STATUSES },
            },
          }),
        ]);
        if (!rider || rider.status !== 'ACTIVE') fail('RIDER_NOT_ELIGIBLE');
        if (!vehicle || (vehicle.status !== 'AVAILABLE' && !activeAllocation))
          fail('COMMERCIAL_OFFER_VEHICLE_UNAVAILABLE');
        if (conflictingAllocation)
          fail('COMMERCIAL_OFFER_VEHICLE_UNAVAILABLE');
        if (offer.hubId && (!hub || hub.status !== 'ACTIVE'))
          fail('HUB_NOT_FOUND');
        if (!version) fail('COMMERCIAL_OFFER_RECALCULATION_REQUIRED');
        if (riderConflict) fail('RIDER_ALREADY_HAS_ACTIVE_RENTAL');
        if (vehicleConflict) fail('VEHICLE_ALREADY_ALLOCATED');
        const acceptedAt = new Date();
        const startDate = input.startDate ? date(input.startDate) : null;
        const agreementNumber = await this.nextNumber(tx, 'agreement');
        const created = await tx.riderRentalAgreement.create({
          data: {
            clientId,
            agreementNumber,
            commercialOfferId: offer.id,
            riderId: offer.riderId,
            vehicleId: offer.vehicleId,
            currentVehicleId: offer.vehicleId,
            hubId: offer.hubId,
            rateCardId: offer.rateCardId,
            rateCardVersionId: offer.rateCardVersionId,
            rentalPeriodType: offer.rentalPeriodType,
            durationValue: offer.durationValue,
            durationUnit: offer.durationUnit,
            batteryPlanId: offer.batteryPlanId,
            currency: offer.currency,
            startDate,
            endDate: agreementEnd(
              startDate,
              offer.rentalPeriodType,
              offer.durationValue,
              offer.durationUnit,
            ),
            billingAnchorDate: startDate,
            status: 'PENDING_ACTIVATION',
            finalRecurringAmount: offer.finalRecurringAmount,
            upfrontAmount: offer.upfrontAmount,
            refundableAmount: offer.refundableAmount,
            pricingSnapshot: json(offer.pricingSnapshot),
            pricingSnapshotSchemaVersion: offer.pricingSnapshotSchemaVersion,
            pricingHash: offer.calculationHash,
            termsSnapshot: offer.termsSnapshot,
            termsVersion: offer.termsVersion,
            termsTitle: offer.termsTitle,
            termsHash: offer.termsHash,
            acceptedAt,
            acceptedById: actorId,
            acceptanceMethod: assisted
              ? 'OPERATIONS_ASSISTED'
              : 'APP_CONFIRMATION',
            riderConsentReference: assisted
              ? (input as z.infer<typeof assistedSchema>).riderConsentReference
              : null,
            assistedReason: assisted
              ? (input as z.infer<typeof assistedSchema>).reason
              : null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await tx.riderAgreementCommercialVersion.create({
          data: {
            clientId,
            agreementId: created.id,
            versionNumber: 1,
            vehicleId: offer.vehicleId,
            rateCardVersionId: offer.rateCardVersionId,
            pricingSnapshot: json(offer.pricingSnapshot),
            pricingHash: offer.calculationHash,
            termsVersion: offer.termsVersion,
            termsHash: offer.termsHash,
            termsSnapshot: offer.termsSnapshot,
            termsTitle: offer.termsTitle,
            recurringAmount: offer.finalRecurringAmount,
            effectiveFrom: startDate ?? acceptedAt,
            billingStartAt: startDate ?? acceptedAt,
            status: 'ACTIVE',
          },
        });
        await this.deposits.initializeInTransaction(tx, created, actorId);
        await tx.riderRentalAgreementStatusHistory.create({
          data: {
            clientId,
            agreementId: created.id,
            previousStatus: null,
            newStatus: 'PENDING_ACTIVATION',
            reason: 'Commercial offer accepted',
            changedById: actorId,
          },
        });
        await tx.riderCommercialOffer.update({
          where: { id: offer.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt,
            acceptedById: actorId,
            acceptanceMethod: assisted
              ? 'OPERATIONS_ASSISTED'
              : 'APP_CONFIRMATION',
            riderConsentReference: assisted
              ? (input as z.infer<typeof assistedSchema>).riderConsentReference
              : null,
            assistedReason: assisted
              ? (input as z.infer<typeof assistedSchema>).reason
              : null,
            updatedById: actorId,
          },
        });
        await this.audit(
          tx,
          clientId,
          actorId,
          'COMMERCIAL_OFFER_ACCEPTED',
          'RiderCommercialOffer',
          offer.id,
          { status: 'PRESENTED' },
          {
            status: 'ACCEPTED',
            agreementId: created.id,
            calculationHash: offer.calculationHash,
          },
        );
        await this.audit(
          tx,
          clientId,
          actorId,
          'RENTAL_AGREEMENT_CREATED',
          'RiderRentalAgreement',
          created.id,
          undefined,
          {
            agreementNumber,
            status: created.status,
            pricingHash: created.pricingHash,
          },
        );
        return created;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
    this.logger.log(
      JSON.stringify({
        event: 'COMMERCIAL_OFFER_ACCEPTED',
        clientId,
        offerId: id,
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        riderId: agreement.riderId,
        vehicleId: agreement.vehicleId,
        rateCardVersionId: agreement.rateCardVersionId,
      }),
    );
    return agreement;
  }
  async getAgreement(clientId: string, id: string, riderId?: string) {
    const agreement = await this.prisma.riderRentalAgreement.findFirst({
      where: { clientId, id, ...(riderId ? { riderId } : {}) },
      include: { statusHistory: { orderBy: { changedAt: 'asc' } }, commercialVersions: true },
    });
    if (!agreement)
      throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
    return agreement;
  }
  listAgreements(clientId: string, riderId?: string) {
    return this.prisma.riderRentalAgreement.findMany({
      where: { clientId, ...(riderId ? { riderId } : {}) },
      include: { commercialVersions: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  agreementView(agreement: RiderRentalAgreement & { commercialVersions?: RiderAgreementCommercialVersion[] }) {
    const current = agreement.commercialVersions?.find((version) => version.versionNumber === agreement.currentCommercialVersionNumber);
    const snapshot = parseSnapshot(
      current?.pricingSnapshot ?? agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    return {
      id: agreement.id,
      agreementNumber: agreement.agreementNumber,
      currentVehicleId: agreement.currentVehicleId,
      status: agreement.status,
      rentalPeriodType: agreement.rentalPeriodType,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      recurringAmount: (current?.recurringAmount ?? agreement.finalRecurringAmount).toFixed(2),
      payableToday: agreement.upfrontAmount.toFixed(2),
      refundableAmount: agreement.refundableAmount.toFixed(2),
      batteryPlan:
        snapshot.batteryPlan && typeof snapshot.batteryPlan === 'object'
          ? { name: (snapshot.batteryPlan as { name: string }).name }
          : null,
      ...riderSnapshotView(snapshot),
      acceptedAt: agreement.acceptedAt,
      termsVersion: current?.termsVersion ?? agreement.termsVersion,
      termsTitle: current?.termsTitle ?? agreement.termsTitle,
      termsContent: current?.termsSnapshot ?? agreement.termsSnapshot,
    };
  }
  async changeAgreementStatus(
    clientId: string,
    actorId: string,
    id: string,
    target: RiderRentalAgreementStatus,
    raw: unknown,
  ) {
    const { reason } = this.parse(reasonSchema, raw);
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.riderRentalAgreement.findFirst({
          where: { clientId, id },
        });
        if (!current)
          throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
        const allowed: Record<
          RiderRentalAgreementStatus,
          RiderRentalAgreementStatus[]
        > = {
          PENDING_ACTIVATION: ['ACTIVE', 'CANCELLED'],
          ACTIVE: ['SUSPENDED', 'TERMINATION_PENDING', 'COMPLETED'],
          SUSPENDED: ['ACTIVE', 'TERMINATION_PENDING'],
          TERMINATION_PENDING: ['TERMINATED'],
          TERMINATED: [],
          COMPLETED: [],
          CANCELLED: [],
        };
        if (!allowed[current.status].includes(target))
          fail('INVALID_AGREEMENT_STATUS_TRANSITION');
        const allocation = await tx.allocation.findFirst({
          where: {
            clientId,
            riderId: current.riderId,
            fleetId: current.vehicleId,
            status: 'ACTIVE',
          },
        });
        if (target === 'ACTIVE' && !allocation)
          fail('AGREEMENT_ACTIVATION_REQUIRES_ACTIVE_ALLOCATION');
        if (target === 'ACTIVE') {
          const readiness = await this.deposits.readiness(clientId, id);
          if (!readiness.satisfied)
            fail('AGREEMENT_ACTIVATION_DEPOSIT_REQUIREMENT_NOT_SATISFIED');
        }
        if (
          (target === 'TERMINATED' ||
            target === 'COMPLETED' ||
            target === 'CANCELLED') &&
          allocation
        )
          fail('AGREEMENT_TERMINATION_REQUIRES_DEALLOCATION');
        const now = new Date();
        const updated = await tx.riderRentalAgreement.updateMany({
          where: { clientId, id, status: current.status },
          data: {
            status: target,
            updatedById: actorId,
            ...(target === 'ACTIVE'
              ? {
                  activatedAt: now,
                  startDate: current.startDate ?? now,
                  billingAnchorDate: current.billingAnchorDate ?? now,
                  endDate:
                    current.endDate ??
                    agreementEnd(
                      current.startDate ?? now,
                      current.rentalPeriodType,
                      current.durationValue,
                      current.durationUnit,
                    ),
                }
              : target === 'TERMINATED'
                ? {
                    terminatedAt: now,
                    terminationReason: reason,
                    terminationEffectiveAt: now,
                  }
                : target === 'TERMINATION_PENDING'
                  ? { terminationRequestedAt: now, terminationReason: reason }
                  : target === 'COMPLETED'
                    ? { completedAt: now }
                    : {}),
          },
        });
        if (updated.count !== 1) fail('INVALID_AGREEMENT_STATUS_TRANSITION');
        await tx.riderRentalAgreementStatusHistory.create({
          data: {
            clientId,
            agreementId: id,
            previousStatus: current.status,
            newStatus: target,
            reason,
            changedById: actorId,
          },
        });
        await this.audit(
          tx,
          clientId,
          actorId,
          'RENTAL_AGREEMENT_STATUS_CHANGED',
          'RiderRentalAgreement',
          id,
          { status: current.status },
          { status: target, reason },
        );
        return tx.riderRentalAgreement.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
