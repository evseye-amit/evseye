import { requireAllocationTeamLead } from './allocation-team-lead.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Allocation } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import {
  CommercialLifecycleService,
  agreementEnd,
} from '../rider-rate-cards/commercial-lifecycle.service.js';
import {
  parseSnapshot,
  pricingHash,
  canonicalJson,
} from '../rider-rate-cards/commercial-snapshot.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { nextBillingBoundary } from '../rider-billing/billing-cycle.js';

const selection = z
  .object({
    rateCardVersionId: z.string().uuid(),
    rentalPeriodType: z.enum([
      'DAILY',
      'WEEKLY',
      'FORTNIGHTLY',
      'MONTHLY',
      'QUARTERLY',
      'CUSTOM',
    ]),
    durationValue: z.number().int().positive().optional(),
    durationUnit: z.enum(['DAY', 'DAYS', 'WEEK', 'WEEKS']).optional(),
    batteryPlanId: z.string().uuid().optional(),
    promotionCode: z.string().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.rentalPeriodType === 'CUSTOM'
        ? !!v.durationValue &&
          !!v.durationUnit &&
          v.durationValue * (v.durationUnit.startsWith('WEEK') ? 7 : 1) <= 366
        : v.durationValue === undefined && v.durationUnit === undefined,
    'Custom plans require a duration of 1–366 days (or equivalent weeks).',
  );
function fail(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
type Tx = Prisma.TransactionClient;
type Quote = {
  agreementId: string;
  pricingHash: string;
  currency: string;
  nonRefundableAmount: string;
  deposits: Array<{ id: string; amount: string }>;
  total: string;
};

@Injectable()
export class DeploymentCommercialService {
  constructor(
    private readonly db: PrismaService,
    private readonly pricing: CommercialOfferService,
    private readonly lifecycle: CommercialLifecycleService,
    private readonly deposits: RiderDepositService,
  ) {}

  private async scoped(
    clientId: string,
    user: AuthUser,
    id: string,
    rider = false,
  ) {
    const hubIds = rider
      ? []
      : (
          await this.db.userHub.findMany({
            where: {
              clientId,
              userId: user.id,
              hub: { clientId, status: 'ACTIVE', deletedAt: null },
            },
            select: { hubId: true },
          })
        ).map((h) => h.hubId);
    const allocation = await this.db.allocation.findFirst({
      where: {
        id,
        clientId,
        rider: {
          clientId,
          deletedAt: null,
          ...(rider ? { userId: user.id } : {}),
        },
        ...(!rider
          ? {
              fleet: {
                clientId,
                deletedAt: null,
                currentHubId: { in: hubIds },
              },
            }
          : {}),
      },
      include: {
        fleet: { select: { currentHubId: true } },
        mobileDeployment: true,
      },
    });
    if (!allocation)
      throw new NotFoundException('Allocation not found in your assigned hub.');
    return allocation;
  }

  private configuration(snapshot: Record<string, unknown>) {
    if (
      !Array.isArray(snapshot.deposits) ||
      !snapshot.deposits.some(
        (d) => (d as { type?: string }).type === 'VEHICLE_SECURITY',
      )
    )
      fail(
        'VEHICLE_DEPOSIT_NOT_CONFIGURED',
        'Configure a scooter security deposit, including an explicit zero amount when waived.',
      );
    if (
      !Array.isArray(snapshot.feeDecisions) ||
      !snapshot.feeDecisions.some(
        (f) => (f as { type?: string }).type === 'ONBOARDING_FEE',
      )
    )
      fail(
        'ONBOARDING_FEE_NOT_CONFIGURED',
        'Configure an onboarding fee, including an explicit zero amount when no fee applies.',
      );
    const included = (
      snapshot.feeDecisions as Array<{ type: string; included: boolean }>
    ).some((f) => f.type === 'ONBOARDING_FEE' && f.included);
    if (
      included &&
      (!Array.isArray(snapshot.oneTimeCharges) ||
        !snapshot.oneTimeCharges.some(
          (f) => (f as { type?: string }).type === 'ONBOARDING_FEE',
        ))
    )
      fail(
        'ONBOARDING_FEE_NOT_CONFIGURED',
        'Onboarding must be configured as a one-time fee.',
      );
  }

  async plans(
    clientId: string,
    user: AuthUser,
    id: string,
    batteryPlanId?: string,
  ) {
    const a = await this.scoped(clientId, user, id);
    if (a.idempotencyKey?.startsWith('exchange:'))
      fail(
        'EXCHANGE_PLAN_ALREADY_SELECTED',
        'Use the accepted exchange offer for a replacement scooter.',
      );
    if (
      !['RIDER_WAITING', 'FLEET_REQUESTED'].includes(
        a.mobileDeployment?.status ?? '',
      )
    )
      fail(
        'PLAN_SELECTION_CLOSED',
        'Plans can be selected before payment is requested.',
      );
    const versions = await this.db.riderRateCardVersion.findMany({
      where: {
        clientId,
        status: 'ACTIVE',
        rateCard: { clientId, status: 'ACTIVE' },
      },
      include: { rentalRates: { where: { isActive: true } } },
      orderBy: [{ rateCardId: 'asc' }, { version: 'desc' }],
    });
    const plans = [];
    for (const version of versions) {
      const options = new Map(
        version.rentalRates.map((r) => [
          `${r.rentalPeriodType}:${r.durationValue}:${r.durationUnit}`,
          r,
        ]),
      );
      for (const rate of options.values()) {
        if (
          rate.rentalPeriodType === 'CUSTOM' &&
          (!['DAY', 'DAYS', 'WEEK', 'WEEKS'].includes(
            rate.durationUnit ?? '',
          ) ||
            !rate.durationValue ||
            rate.durationValue *
              (rate.durationUnit?.startsWith('WEEK') ? 7 : 1) >
              366)
        )
          continue;
        try {
          const preview = await this.pricing.calculate(clientId, {
            riderId: a.riderId,
            vehicleId: a.fleetId,
            hubId: a.fleet.currentHubId ?? undefined,
            rateCardVersionId: version.id,
            rentalPeriodType: rate.rentalPeriodType,
            ...(rate.rentalPeriodType === 'CUSTOM'
              ? {
                  durationValue: rate.durationValue,
                  durationUnit: rate.durationUnit,
                }
              : {}),
            ...(batteryPlanId ? { batteryPlanId } : {}),
          });
          this.configuration(preview);
          plans.push({
            rateCard: preview.rateCard,
            selection: {
              rateCardVersionId: version.id,
              rentalPeriodType: rate.rentalPeriodType,
              ...(rate.rentalPeriodType === 'CUSTOM'
                ? {
                    durationValue: rate.durationValue,
                    durationUnit: rate.durationUnit,
                  }
                : {}),
              ...(batteryPlanId ? { batteryPlanId } : {}),
            },
            ...this.pricing.riderView(preview),
            scooterAgeMonths: preview.vehicle.ageMonths,
          });
        } catch (error) {
          const response =
            error instanceof UnprocessableEntityException
              ? error.getResponse()
              : null;
          const code =
            typeof response === 'object' && response
              ? (response as { code?: string }).code
              : null;
          if (
            [
              'BASE_RENTAL_NOT_CONFIGURED',
              'RATE_CARD_VERSION_NOT_FOUND',
            ].includes(code ?? '')
          )
            continue;
          throw error;
        }
      }
    }
    return {
      items: plans,
      batteryPlans: await this.db.riderBatteryPlan.findMany({
        where: { clientId, isActive: true },
        select: { id: true, code: true, name: true },
      }),
    };
  }

  async createOffer(
    clientId: string,
    user: AuthUser,
    id: string,
    raw: unknown,
    key?: string,
  ) {
    if (!key || !/^[A-Za-z0-9:_-]{8,100}$/.test(key))
      throw new BadRequestException(
        'An Idempotency-Key of 8–100 characters is required.',
      );
    const parsed = selection.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const a = await this.scoped(clientId, user, id);
    if (
      !['RIDER_WAITING', 'FLEET_REQUESTED'].includes(
        a.mobileDeployment?.status ?? '',
      )
    )
      fail(
        'PLAN_SELECTION_CLOSED',
        'Plan selection is closed after payment starts.',
      );
    if (a.idempotencyKey?.startsWith('exchange:'))
      fail(
        'EXCHANGE_PLAN_ALREADY_SELECTED',
        'Use the accepted exchange offer for a replacement scooter.',
      );
    const offer = await this.lifecycle.createOffer(
      clientId,
      user.id,
      {
        ...parsed.data,
        riderId: a.riderId,
        vehicleId: a.fleetId,
        hubId: a.fleet.currentHubId ?? undefined,
      },
      `deployment:${id}:${key}`,
    );
    this.configuration(offer.pricingSnapshot as Record<string, unknown>);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RiderCommercialOffer" WHERE id = ${offer.id} AND "clientId" = ${clientId} FOR UPDATE`;
      const current = await tx.allocation.findFirstOrThrow({
        where: { id, clientId },
        include: { mobileDeployment: true },
      });
      if (current.commercialOfferId === offer.id) return;
      if (
        current.rentalAgreementId ||
        !['RIDER_WAITING', 'FLEET_REQUESTED'].includes(
          current.mobileDeployment?.status ?? '',
        )
      )
        fail(
          'PLAN_SELECTION_CLOSED',
          'An accepted plan or payment already exists for this allocation.',
        );
      if (
        current.commercialOfferId &&
        current.commercialOfferId !== a.commercialOfferId
      )
        fail(
          'PLAN_SELECTION_CHANGED',
          'Another plan was selected. Refresh and try again.',
        );
      if (current.commercialOfferId) {
        const previous = await tx.riderCommercialOffer.findFirstOrThrow({
          where: { id: current.commercialOfferId, clientId },
        });
        if (previous.status === 'ACCEPTED')
          fail(
            'PLAN_SELECTION_CLOSED',
            'The rider has already accepted this plan.',
          );
        await tx.riderCommercialOffer.updateMany({
          where: {
            id: previous.id,
            status: { in: ['CALCULATED', 'PRESENTED'] },
          },
          data: {
            status: 'SUPERSEDED',
            supersededByOfferId: offer.id,
            supersededAt: new Date(),
          },
        });
      }
      const updated = await tx.riderCommercialOffer.updateMany({
        where: { id: offer.id, clientId, status: 'CALCULATED' },
        data: { status: 'PRESENTED', presentedAt: new Date() },
      });
      if (updated.count !== 1)
        fail(
          'COMMERCIAL_OFFER_NOT_ACCEPTABLE',
          'Create a new offer for the rider.',
        );
      await tx.allocation.update({
        where: { id },
        data: { commercialOfferId: offer.id },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: user.id,
          action: 'ALLOCATION_PLAN_SELECTED',
          entityType: 'Allocation',
          entityId: id,
          newData: { offerId: offer.id },
        },
      });
    });
    return this.getOffer(clientId, user, id);
  }

  async getOffer(clientId: string, user: AuthUser, id: string, rider = false) {
    const a = await this.scoped(clientId, user, id, rider);
    const agreement = a.rentalAgreementId
      ? await this.db.riderRentalAgreement.findFirst({
          where: { id: a.rentalAgreementId, clientId, riderId: a.riderId },
        })
      : null;
    if (!a.commercialOfferId)
      return {
        allocationId: id,
        offer: null,
        agreement: agreement ? this.lifecycle.agreementView(agreement) : null,
      };
    const offer = await this.lifecycle.getOffer(
      clientId,
      a.commercialOfferId,
      a.riderId,
    );
    return {
      allocationId: id,
      offer: this.lifecycle.offerView(offer),
      agreement: agreement ? this.lifecycle.agreementView(agreement) : null,
    };
  }

  private async agreement(tx: Tx, clientId: string, a: Allocation) {
    if (!a.rentalAgreementId || !a.commercialOfferId)
      fail(
        'RENTAL_PLAN_REQUIRED',
        'Select a rental plan and ask the rider to accept it before payment or handover.',
      );
    const agreement = await tx.riderRentalAgreement.findFirst({
      where: {
        id: a.rentalAgreementId!,
        clientId,
        riderId: a.riderId,
        currentVehicleId: a.fleetId,
        commercialOfferId: a.commercialOfferId!,
        status: 'PENDING_ACTIVATION',
      },
    });
    if (!agreement)
      fail(
        'RENTAL_AGREEMENT_NOT_READY',
        'The selected rental agreement is missing, mismatched or no longer awaiting handover.',
      );
    if (
      pricingHash(
        clientId,
        agreement.pricingSnapshot,
        agreement.termsHash,
        agreement.termsVersion,
      ) !== agreement.pricingHash
    )
      fail(
        'COMMERCIAL_OFFER_INTEGRITY_FAILED',
        'The accepted pricing snapshot is invalid.',
      );
    return agreement;
  }

  private async quote(tx: Tx, clientId: string, a: Allocation): Promise<Quote> {
    if (a.idempotencyKey?.startsWith('exchange:')) {
      const { exchange, accepted } = await this.exchange(tx, clientId, a);
      // Existing exchange completion posts its accepted proration and exchange fee.
      // Deposits have already been reconciled before HANDOVER_PENDING; do not collect them again.
      return {
        agreementId: exchange.agreementId,
        pricingHash: accepted.pricingHash,
        currency: exchange.agreement.currency,
        nonRefundableAmount: '0.00',
        deposits: [],
        total: '0.00',
      };
    }
    const agreement = await this.agreement(tx, clientId, a);
    const deposits = await tx.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: agreement.id,
        sourceType: 'RENTAL_AGREEMENT',
      },
      orderBy: { id: 'asc' },
    });
    const snapshot = parseSnapshot(
      agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    if (deposits.length !== (snapshot.deposits as unknown[]).length)
      fail(
        'AGREEMENT_DEPOSITS_NOT_INITIALIZED',
        'The agreement deposit obligations are incomplete.',
      );
    const nonRefundable = agreement.upfrontAmount.minus(
      agreement.refundableAmount,
    );
    const lines = deposits.map((d) => ({
      id: d.id,
      amount: Prisma.Decimal.max(
        0,
        d.requiredAmount.minus(d.fundedAmount),
      ).toFixed(2),
    }));
    return {
      agreementId: agreement.id,
      pricingHash: agreement.pricingHash,
      currency: agreement.currency,
      nonRefundableAmount: nonRefundable.toFixed(2),
      deposits: lines,
      total: lines
        .reduce((sum, d) => sum.plus(d.amount), nonRefundable)
        .toFixed(2),
    };
  }

  private async exchange(tx: Tx, clientId: string, a: Allocation) {
    const exchange = await tx.vehicleExchangeRequest.findFirst({
      where: {
        id: a.idempotencyKey!.slice(9),
        clientId,
        riderId: a.riderId,
        replacementVehicleId: a.fleetId,
        newAllocationId: a.id,
        status: 'HANDOVER_PENDING',
      },
      include: { agreement: true, offers: { where: { status: 'ACCEPTED' } } },
    });
    if (
      !exchange ||
      exchange.agreement.status !== 'ACTIVE' ||
      exchange.agreement.currentVehicleId !== null ||
      a.rentalAgreementId !== exchange.agreementId ||
      exchange.offers.length !== 1
    )
      fail(
        'EXCHANGE_AGREEMENT_NOT_READY',
        'Complete the accepted exchange and old scooter return before replacement handover.',
      );
    const accepted = exchange.offers[0];
    const version = await tx.riderAgreementCommercialVersion.findFirst({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        vehicleId: a.fleetId,
        status: 'PENDING',
      },
    });
    if (!version?.amendmentId || version.pricingHash !== accepted.pricingHash)
      fail(
        'EXCHANGE_AGREEMENT_NOT_READY',
        'The accepted replacement pricing is missing.',
      );
    await tx.$queryRaw`SELECT id FROM "RiderDeposit" WHERE "clientId" = ${clientId} AND "agreementId" = ${exchange.agreementId} ORDER BY id FOR UPDATE`;
    const obligations = await tx.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: exchange.agreementId,
        OR: [
          { sourceId: version.amendmentId! },
          { depositType: 'RIDER_SECURITY' },
        ],
      },
    });
    const snapshot = parseSnapshot(version.pricingSnapshot, 1);
    const expected = (snapshot.deposits as Array<{ type: string }>).filter(
      (d) => d.type !== 'RIDER_SECURITY',
    ).length;
    if (
      obligations.filter((d) => d.depositType !== 'RIDER_SECURITY').length !==
        expected ||
      obligations.some((d) => d.availableAmount.lt(d.requiredAmount))
    )
      fail(
        'DEPOSIT_OUTSTANDING',
        'Complete the replacement scooter deposit reconciliation before handover.',
      );
    const refunds = await tx.riderDepositRefundRequest.aggregate({
      where: {
        clientId,
        depositId: { in: obligations.map((d) => d.id) },
        status: 'REQUESTED',
      },
      _sum: { amount: true },
    });
    if ((refunds._sum.amount ?? new Prisma.Decimal(0)).gt(0))
      fail(
        'DEPOSIT_OUTSTANDING',
        'A replacement security deposit refund is pending.',
      );
    return { exchange, accepted };
  }

  async requestPayment(clientId: string, allocationId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
      const a = await tx.allocation.findFirstOrThrow({
        where: { id: allocationId, clientId },
        include: { mobileDeployment: { include: { payment: true } } },
      });
      const w = a.mobileDeployment;
      if (!w)
        fail('DEPLOYMENT_NOT_FOUND', 'Allocation workflow was not found.');
      if (w.payment) return w.payment;
      if (w.status !== 'FLEET_REQUESTED')
        fail(
          'FLEET_REQUEST_REQUIRED',
          'Request the scooter before requesting payment.',
        );
      const quote = await this.quote(tx, clientId, a);
      const zero = new Prisma.Decimal(quote.total).eq(0);
      const now = new Date();
      const payment = await tx.deploymentPayment.create({
        data: {
          clientId,
          workflowId: w.id,
          currency: quote.currency,
          amount: quote.total,
          breakdown: quote as unknown as Prisma.InputJsonValue,
          ...(zero
            ? {
                status: 'PAID',
                paidAt: now,
                verifiedAt: now,
                provider: 'NO_PAYMENT_REQUIRED',
              }
            : {}),
        },
      });
      await tx.mobileDeploymentWorkflow.update({
        where: { id: w.id },
        data: {
          status: zero ? 'PAYMENT_PAID' : 'PAYMENT_PENDING',
          paymentBreakdown: quote as unknown as Prisma.InputJsonValue,
          ...(zero ? { paymentPaidAt: now } : {}),
        },
      });
      return payment;
    });
  }

  async verifyPayment(clientId: string, actorId: string, allocationId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
      const a = await tx.allocation.findFirstOrThrow({
        where: { id: allocationId, clientId },
        include: { mobileDeployment: { include: { payment: true } } },
      });
      const w = a.mobileDeployment,
        p = w?.payment;
      if (!w || !p)
        fail(
          'PAYMENT_REQUEST_REQUIRED',
          'Generate the allocation payment first.',
        );
      if (p.status === 'PAID') return w;
      if (p.status !== 'SUBMITTED' || w.status !== 'PAYMENT_PENDING')
        fail(
          'PAYMENT_REFERENCE_REQUIRED',
          'The rider must submit a payment reference before verification.',
        );
      const quote = await this.quote(tx, clientId, a);
      if (
        !p.amount.eq(quote.total) ||
        p.currency !== quote.currency ||
        canonicalJson(p.breakdown) !== canonicalJson(quote)
      )
        fail(
          'DEPLOYMENT_PAYMENT_STALE',
          'The agreement or deposit balance changed. Refresh the allocation payment.',
        );
      for (const line of quote.deposits)
        if (new Prisma.Decimal(line.amount).gt(0))
          await this.deposits.collectDeploymentInTransaction(
            tx,
            clientId,
            line.id,
            new Prisma.Decimal(line.amount),
            actorId,
            p.id,
            p.providerReference!,
            p.provider!,
          );
      const nonRefundable = new Prisma.Decimal(quote.nonRefundableAmount);
      if (nonRefundable.gt(0)) {
        const credit = await tx.riderPayment.create({
          data: {
            clientId,
            riderId: a.riderId,
            amount: nonRefundable,
            unallocatedAmount: nonRefundable,
            currency: p.currency,
            method: 'DEPLOYMENT',
            externalReference: p.providerReference,
            idempotencyKey: `deployment:${p.id}`,
            receivedAt: new Date(),
            createdById: actorId,
          },
        });
        await tx.riderLedgerEntry.create({
          data: {
            clientId,
            riderId: a.riderId,
            agreementId: quote.agreementId,
            vehicleId: a.fleetId,
            entryType: 'PAYMENT',
            sourceType: 'RIDER_PAYMENT',
            sourceId: credit.id,
            description: 'Verified upfront rental and onboarding payment',
            creditAmount: nonRefundable,
            currency: p.currency,
          },
        });
      }
      const now = new Date();
      await tx.deploymentPayment.update({
        where: { id: p.id },
        data: {
          status: 'PAID',
          paidAt: now,
          verifiedAt: now,
          verifiedById: actorId,
        },
      });
      return tx.mobileDeploymentWorkflow.update({
        where: { id: w.id },
        data: { status: 'PAYMENT_PAID', paymentPaidAt: now },
      });
    });
  }

  async activateInTransaction(
    tx: Tx,
    clientId: string,
    allocationId: string,
    at: Date,
  ) {
    const a = await tx.allocation.findFirstOrThrow({
      where: { id: allocationId, clientId },
    });
    await requireAllocationTeamLead(tx, clientId, a.riderId);
    // Exchanges retain their accepted agreement and use their existing amendment/deposit workflow.
    if (a.idempotencyKey?.startsWith('exchange:')) {
      await this.exchange(tx, clientId, a);
      return;
    }
    const agreement = await this.agreement(tx, clientId, a);
    const workflow = await tx.mobileDeploymentWorkflow.findUnique({
      where: { allocationId },
      include: { payment: true },
    });
    if (workflow && workflow.payment?.status !== 'PAID')
      fail(
        'ALLOCATION_PAYMENT_REQUIRED',
        'Verify the accepted plan payment before handover.',
      );
    await tx.$queryRaw`SELECT id FROM "RiderDeposit" WHERE "clientId" = ${clientId} AND "agreementId" = ${agreement.id} ORDER BY id FOR UPDATE`;
    const quote = await this.quote(tx, clientId, a);
    if (
      workflow?.payment &&
      ((workflow.payment.breakdown as unknown as Quote).agreementId !==
        agreement.id ||
        (workflow.payment.breakdown as unknown as Quote).pricingHash !==
          agreement.pricingHash)
    )
      fail(
        'DEPLOYMENT_PAYMENT_STALE',
        'The payment does not belong to the accepted plan.',
      );
    // A staff activation also needs the same verified payment; it cannot bypass mobile collection.
    if (!workflow?.payment || workflow.payment.status !== 'PAID')
      fail(
        'ALLOCATION_PAYMENT_REQUIRED',
        'Verify allocation payment before handover.',
      );
    if (quote.deposits.some((d) => new Prisma.Decimal(d.amount).gt(0)))
      fail(
        'DEPOSIT_OUTSTANDING',
        'Collect the accepted security deposit before handover.',
      );
    const obligations = await tx.riderDeposit.findMany({
      where: {
        clientId,
        agreementId: agreement.id,
        sourceType: 'RENTAL_AGREEMENT',
      },
    });
    const pendingRefunds = await tx.riderDepositRefundRequest.aggregate({
      where: {
        clientId,
        depositId: { in: obligations.map((d) => d.id) },
        status: 'REQUESTED',
      },
      _sum: { amount: true },
    });
    const holds = await tx.settlementDepositHold.aggregate({
      where: {
        clientId,
        depositId: { in: obligations.map((d) => d.id) },
        status: 'ACTIVE',
      },
      _sum: { amount: true },
    });
    const held = obligations
      .reduce((sum, d) => sum.plus(d.availableAmount), new Prisma.Decimal(0))
      .minus(pendingRefunds._sum.amount ?? 0)
      .minus(holds._sum.amount ?? 0);
    const required = obligations.reduce(
      (sum, d) => sum.plus(d.requiredAmount),
      new Prisma.Decimal(0),
    );
    if (held.lt(required))
      fail(
        'DEPOSIT_OUTSTANDING',
        'The required security deposit must remain available before handover.',
      );
    const changed = await tx.riderRentalAgreement.updateMany({
      where: { id: agreement.id, clientId, status: 'PENDING_ACTIVATION' },
      data: {
        status: 'ACTIVE',
        activatedAt: at,
        startDate: at,
        billingAnchorDate: at,
        endDate: agreementEnd(
          at,
          agreement.rentalPeriodType,
          agreement.durationValue,
          agreement.durationUnit,
        ),
      },
    });
    if (changed.count !== 1)
      fail(
        'RENTAL_AGREEMENT_STATE_CHANGED',
        'The rental agreement changed. Refresh and try again.',
      );
    const version = await tx.riderAgreementCommercialVersion.updateMany({
      where: {
        clientId,
        agreementId: agreement.id,
        versionNumber: 1,
        vehicleId: a.fleetId,
        pricingHash: agreement.pricingHash,
        status: 'PENDING',
      },
      data: { status: 'ACTIVE', effectiveFrom: at, billingStartAt: at },
    });
    if (version.count !== 1)
      fail(
        'COMMERCIAL_VERSION_NOT_READY',
        'The accepted rental version is not ready for handover.',
      );
    const days =
      agreement.rentalPeriodType === 'CUSTOM'
        ? agreement.durationValue! *
          (agreement.durationUnit?.startsWith('WEEK') ? 7 : 1)
        : null;
    nextBillingBoundary(at, agreement.rentalPeriodType, 'Asia/Kolkata', days);
    const frozen = parseSnapshot(
      agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    const totals = frozen.totals as { firstRentalUpfront: string };
    const billingMode = new Prisma.Decimal(totals.firstRentalUpfront).gt(0)
      ? 'PREPAID'
      : 'POSTPAID';
    const profile = await tx.riderPaymentProfile.findUnique({
      where: { clientId_riderId: { clientId, riderId: a.riderId } },
    });
    if (profile && profile.currency !== agreement.currency)
      fail(
        'PAYMENT_CURRENCY_MISMATCH',
        'The rider payment profile uses a different currency.',
      );
    await tx.riderPaymentProfile.upsert({
      where: { clientId_riderId: { clientId, riderId: a.riderId } },
      create: {
        clientId,
        riderId: a.riderId,
        currency: agreement.currency,
        billingMode,
      },
      update: { billingMode },
    });
    await tx.riderBillingSchedule.create({
      data: {
        clientId,
        riderId: a.riderId,
        agreementId: agreement.id,
        frequency: agreement.rentalPeriodType,
        customDays: days,
        billingMode,
        anchorType: 'VEHICLE_HANDOVER',
        anchorAt: at,
        nextPeriodStart: at,
        timezone: 'Asia/Kolkata',
      },
    });
    await tx.riderRentalAgreementStatusHistory.create({
      data: {
        clientId,
        agreementId: agreement.id,
        previousStatus: 'PENDING_ACTIVATION',
        newStatus: 'ACTIVE',
        reason: 'Scooter allocation handed over',
        changedById: 'SYSTEM',
        changedAt: at,
      },
    });
  }
}
