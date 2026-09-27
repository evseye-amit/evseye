import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { RiderBillingEngineService } from '../rider-billing/rider-billing-engine.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { PaymentRefundService } from '../payments/payment-refund.service.js';
import {
  nextBillingBoundary,
  proratedAmount,
  resolveCommercialSegments,
} from '../rider-billing/billing-cycle.js';

const D = Prisma.Decimal;
const zero = new D(0);
const sum = (rows: readonly Prisma.Decimal[]) =>
  rows.reduce((a, b) => a.plus(b), zero);
const money = (n: Prisma.Decimal) => n.toFixed(2);
const amount = (s: string) => {
  const n = new D(s);
  if (!n.isFinite() || n.lte(0) || n.decimalPlaces() > 2)
    throw new BadRequestException('Invalid positive amount.');
  return n;
};
const fail = (code: string): never => {
  throw new ConflictException({ code });
};
const allowedReasons = new Set([
  'RIDER_REQUEST',
  'CLIENT_REQUEST',
  'VEHICLE_RETURN',
  'RENTAL_COMPLETED',
  'PAYMENT_DEFAULT',
  'VEHICLE_UNAVAILABLE',
  'VEHICLE_REPLACED',
  'POLICY_VIOLATION',
  'OTHER',
]);
const chargeTypes = new Set([
  'DAMAGE',
  'MISSING_ACCESSORY',
  'EXCESS_USAGE',
  'CHALLAN',
  'LATE_FEE',
  'CLEANING',
  'VEHICLE_RECOVERY',
  'OTHER',
]);
const creditReasons = new Set([
  'RENTAL_CORRECTION',
  'SERVICE_DOWNTIME',
  'OVERCHARGE',
  'DAMAGE_CHARGE_REVERSAL',
  'LATE_FEE_WAIVER',
  'COMMERCIAL_ADJUSTMENT',
  'OTHER',
]);
const debitReasons = new Set([
  'UNDERCHARGE_CORRECTION',
  'POST_INVOICE_ADJUSTMENT',
  'APPROVED_DAMAGE',
  'MISSING_ACCESSORY',
  'OTHER',
]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class FinalSettlementService {
  constructor(
    private readonly db: PrismaService,
    private readonly billing: RiderBillingService,
    private readonly engine: RiderBillingEngineService,
    private readonly payments: RiderPaymentsService,
    private readonly deposits: RiderDepositService,
    private readonly providerRefunds: PaymentRefundService,
  ) {}

  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          retry < 3
        )
          continue;
        throw error;
      }
    }
  }
  async policy(clientId: string) {
    return (
      (await this.db.clientSettlementPolicy.findUnique({
        where: { clientId },
      })) ?? {
        clientId,
        depositApplicationEnabled: false,
        manualDepositRefundEnabled: true,
      }
    );
  }
  async setPolicy(
    clientId: string,
    actorId: string,
    input: {
      depositApplicationEnabled: boolean;
      manualDepositRefundEnabled: boolean;
    },
  ) {
    if (
      typeof input.depositApplicationEnabled !== 'boolean' ||
      typeof input.manualDepositRefundEnabled !== 'boolean'
    )
      throw new BadRequestException('Invalid settlement policy.');
    return this.serializable(async (tx) => {
      const policy = await tx.clientSettlementPolicy.upsert({
        where: { clientId },
        create: {
          clientId,
          depositApplicationEnabled: input.depositApplicationEnabled,
          manualDepositRefundEnabled: input.manualDepositRefundEnabled,
          updatedById: actorId,
        },
        update: {
          depositApplicationEnabled: input.depositApplicationEnabled,
          manualDepositRefundEnabled: input.manualDepositRefundEnabled,
          updatedById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'SETTLEMENT_POLICY_CHANGED',
        'ClientSettlementPolicy',
        clientId,
        {
          depositApplicationEnabled: policy.depositApplicationEnabled,
          manualDepositRefundEnabled: policy.manualDepositRefundEnabled,
        },
      );
      return policy;
    });
  }
  private audit(
    tx: Prisma.TransactionClient,
    clientId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    data?: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action,
        entityType,
        entityId,
        newData: data ? json(data) : undefined,
      },
    });
  }
  private agreement(clientId: string, agreementId: string) {
    return this.db.riderRentalAgreement.findFirst({
      where: { id: agreementId, clientId },
    });
  }
  private async settlement(clientId: string, id: string) {
    const row = await this.db.riderFinalSettlement.findFirst({
      where: { id, clientId },
    });
    if (!row) throw new NotFoundException('Settlement not found.');
    return row;
  }
  async termination(
    clientId: string,
    agreementId: string,
    actorId: string,
    key: string,
    input: {
      requestedTerminationDate: string;
      reasonCode: string;
      reasonText?: string;
    },
  ) {
    if (!key || key.length > 120)
      throw new BadRequestException('Idempotency-Key is required.');
    if (!allowedReasons.has(input.reasonCode))
      throw new BadRequestException('Invalid termination reason.');
    const requested = new Date(input.requestedTerminationDate);
    if (Number.isNaN(requested.getTime()))
      throw new BadRequestException('Invalid requested termination date.');
    return this.serializable(async (tx) => {
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { id: agreementId, clientId },
      });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      const previous = await tx.rentalTerminationRequest.findUnique({
        where: { agreementId },
      });
      if (previous) {
        if (
          previous.idempotencyKey !== key ||
          previous.reasonCode !== input.reasonCode ||
          previous.requestedTerminationDate.getTime() !== requested.getTime() ||
          previous.reasonText !== (input.reasonText ?? null)
        )
          fail('TERMINATION_ALREADY_REQUESTED');
        return previous;
      }
      if (
        !['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'].includes(
          agreement.status,
        )
      )
        fail('AGREEMENT_NOT_TERMINABLE');
      const row = await tx.rentalTerminationRequest.create({
        data: {
          clientId,
          riderId: agreement.riderId,
          agreementId,
          requestedTerminationDate: requested,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          requestedById: actorId,
          idempotencyKey: key,
        },
      });
      if (agreement.status !== 'TERMINATION_PENDING') {
        await tx.riderRentalAgreement.update({
          where: { id: agreementId },
          data: {
            status: 'TERMINATION_PENDING',
            commercialClosureState: 'TERMINATION_REQUESTED',
            terminationRequestedAt: new Date(),
            terminationReason: input.reasonCode,
            updatedById: actorId,
          },
        });
        await tx.riderRentalAgreementStatusHistory.create({
          data: {
            clientId,
            agreementId,
            previousStatus: agreement.status,
            newStatus: 'TERMINATION_PENDING',
            reason: input.reasonCode,
            changedById: actorId,
          },
        });
      }
      await this.audit(
        tx,
        clientId,
        actorId,
        'RENTAL_TERMINATION_REQUESTED',
        'RentalTerminationRequest',
        row.id,
        { agreementId },
      );
      return row;
    });
  }
  async recordReturn(clientId: string, agreementId: string, actorId: string) {
    return this.serializable(async (tx) => {
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { id: agreementId, clientId },
      });
      const request = await tx.rentalTerminationRequest.findUnique({
        where: { agreementId },
      });
      if (!agreement || !request)
        throw new NotFoundException('Termination request not found.');
      if (request.status === 'RETURNED') return request;
      const allocation = await tx.allocation.findFirst({
        where: {
          clientId,
          riderId: agreement.riderId,
          fleetId: agreement.currentVehicleId ?? agreement.vehicleId,
          status: 'COMPLETED',
          deallocatedAt: { not: null },
        },
        orderBy: { deallocatedAt: 'desc' },
        include: {
          inspections: {
            where: { type: 'POST_DEALLOCATION', status: 'COMPLETED' },
          },
        },
      });
      if (!allocation?.deallocatedAt || !allocation.inspections.length)
        throw new ConflictException('VEHICLE_RETURN_INSPECTION_REQUIRED');
      if (agreement.startDate && allocation.deallocatedAt < agreement.startDate)
        fail('RETURN_BEFORE_AGREEMENT');
      const row = await tx.rentalTerminationRequest.update({
        where: { id: request.id },
        data: {
          status: 'RETURNED',
          actualTerminationDate: allocation.deallocatedAt,
        },
      });
      await tx.riderRentalAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'TERMINATED',
          commercialClosureState: 'FINAL_BILLING_PENDING',
          terminationEffectiveAt: allocation.deallocatedAt,
          terminatedAt: new Date(),
          updatedById: actorId,
        },
      });
      await tx.riderRentalAgreementStatusHistory.create({
        data: {
          clientId,
          agreementId,
          previousStatus: agreement.status,
          newStatus: 'TERMINATED',
          reason: 'VEHICLE_RETURN',
          changedById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'RENTAL_TERMINATED',
        'RiderRentalAgreement',
        agreementId,
        {
          returnInspectionId: allocation.inspections[0].id,
          returnedAt: allocation.deallocatedAt.toISOString(),
        },
      );
      return row;
    });
  }
  private async estimateRental(
    clientId: string,
    agreementId: string,
    cutoff: Date,
  ) {
    const schedule = await this.db.riderBillingSchedule.findFirst({
      where: { clientId, agreementId },
    });
    if (
      !schedule ||
      schedule.nextPeriodStart >= cutoff ||
      schedule.status === 'CLOSED'
    )
      return zero;
    const naturalEnd = nextBillingBoundary(
      schedule.nextPeriodStart,
      schedule.frequency,
      schedule.timezone,
      schedule.customDays,
      schedule.anchorAt,
    );
    const end = cutoff < naturalEnd ? cutoff : naturalEnd;
    const versions = await this.db.riderAgreementCommercialVersion.findMany({
      where: { clientId, agreementId, effectiveFrom: { lt: end } },
      orderBy: { effectiveFrom: 'asc' },
    });
    const segments = resolveCommercialSegments(
      versions,
      schedule.nextPeriodStart,
      end,
    );
    return sum(
      segments.map((s) =>
        proratedAmount(
          s.amount,
          s.start,
          s.end,
          schedule.nextPeriodStart,
          naturalEnd,
        ),
      ),
    );
  }
  async preview(clientId: string, agreementId: string) {
    const agreement = await this.agreement(clientId, agreementId);
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const request = await this.db.rentalTerminationRequest.findUnique({
      where: { agreementId },
    });
    const cutoff =
      request?.actualTerminationDate ??
      agreement.terminationEffectiveAt ??
      null;
    const [invoices, credits, openCharges, payments, deposits, settlement] =
      await Promise.all([
        this.db.riderInvoice.findMany({
          where: {
            clientId,
            agreementId,
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        }),
        this.db.riderCredit.findMany({
          where: {
            clientId,
            riderId: agreement.riderId,
            status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] },
          },
        }),
        this.db.riderCharge.findMany({
          where: {
            clientId,
            riderId: agreement.riderId,
            status: 'OPEN',
            OR: [{ agreementId }, { referenceType: 'FINAL_SETTLEMENT' }],
          },
        }),
        this.db.riderPayment.findMany({
          where: {
            clientId,
            riderId: agreement.riderId,
            status: 'CONFIRMED',
            unallocatedAmount: { gt: zero },
          },
        }),
        this.db.riderDeposit.findMany({ where: { clientId, agreementId } }),
        this.db.riderFinalSettlement.findUnique({
          where: { agreementId },
          include: { charges: true, holds: true },
        }),
      ]);
    const held = sum(deposits.map((d) => d.availableAmount));
    const activeHolds = sum(
      (settlement?.holds ?? [])
        .filter((h) => h.status === 'ACTIVE')
        .map((h) => h.amount),
    );
    const existingOutstanding = sum(invoices.map((i) => i.outstandingAmount));
    const finalRental = cutoff
      ? await this.estimateRental(clientId, agreementId, cutoff)
      : zero;
    const availableCredit = sum(credits.map((c) => c.remainingAmount));
    const unallocated = sum(payments.map((p) => p.unallocatedAmount));
    const pendingCharges = sum(
      (settlement?.charges ?? [])
        .filter((c) => ['ASSESSED', 'APPROVAL_REQUIRED'].includes(c.status))
        .map((c) => c.assessedAmount),
    );
    const approvedCharges = sum(openCharges.map((c) => c.amount));
    const obligation = D.max(
      zero,
      existingOutstanding
        .plus(finalRental)
        .plus(approvedCharges)
        .minus(availableCredit)
        .minus(unallocated),
    );
    const availableDeposit = D.max(zero, held.minus(activeHolds));
    return {
      agreementId,
      terminationDate: cutoff,
      currency: agreement.currency,
      existingOutstanding: money(existingOutstanding),
      finalRentalEstimate: money(finalRental),
      approvedOpenCharges: money(approvedCharges),
      pendingUnapprovedCharges: money(pendingCharges),
      availableCredit: money(availableCredit),
      unallocatedPayment: money(unallocated),
      depositHeld: money(held),
      activeDepositHolds: money(activeHolds),
      estimatedDeduction: money(D.min(obligation, availableDeposit)),
      estimatedRiderPayable: money(
        D.max(zero, obligation.minus(availableDeposit)),
      ),
      estimatedRefund: money(D.max(zero, availableDeposit.minus(obligation))),
      estimated: true,
    };
  }
  async create(clientId: string, agreementId: string, actorId: string) {
    const agreement = await this.agreement(clientId, agreementId);
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const request = await this.db.rentalTerminationRequest.findUnique({
      where: { agreementId },
    });
    if (!request?.actualTerminationDate || agreement.status !== 'TERMINATED')
      throw new ConflictException('VEHICLE_RETURN_REQUIRED');
    const cutoff = request.actualTerminationDate;
    try {
      return await this.serializable(async (tx) => {
        const existing = await tx.riderFinalSettlement.findUnique({
          where: { agreementId },
        });
        if (existing) return existing;
        const now = new Date();
        const fy =
          now.getUTCMonth() >= 3
            ? now.getUTCFullYear()
            : now.getUTCFullYear() - 1;
        const year = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
        const sequence = await tx.settlementSequence.upsert({
          where: { clientId_kind_year: { clientId, kind: 'SET', year } },
          create: { clientId, kind: 'SET', year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const row = await tx.riderFinalSettlement.create({
          data: {
            clientId,
            riderId: agreement.riderId,
            agreementId,
            settlementNumber: `SET/${year}/${String(sequence.lastNumber).padStart(6, '0')}`,
            terminationDate: cutoff,
            billingCutoffAt: cutoff,
            currency: agreement.currency,
            createdById: actorId,
          },
        });
        await tx.riderRentalAgreement.update({
          where: { id: agreementId },
          data: { commercialClosureState: 'SETTLEMENT_PENDING' },
        });
        await this.audit(
          tx,
          clientId,
          actorId,
          'FINAL_SETTLEMENT_CREATED',
          'RiderFinalSettlement',
          row.id,
        );
        return row;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.db.riderFinalSettlement.findFirst({
          where: { clientId, agreementId },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }
  async get(clientId: string, id: string) {
    const row = await this.db.riderFinalSettlement.findFirst({
      where: { id, clientId },
      include: {
        charges: true,
        holds: true,
        applications: true,
        refunds: true,
        adjustments: true,
        revisions: true,
      },
    });
    if (!row) throw new NotFoundException('Settlement not found.');
    return row;
  }
  async assess(
    clientId: string,
    id: string,
    actorId: string,
    input: {
      chargeType: string;
      description: string;
      amount: string;
      sourceType?: string;
      sourceId?: string;
      evidence?: unknown;
    },
  ) {
    if (!chargeTypes.has(input.chargeType))
      throw new BadRequestException('Invalid charge type.');
    const value = amount(input.amount);
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_IMMUTABLE');
    if (!input.description?.trim() || input.description.length > 300)
      throw new BadRequestException('Description is required.');
    return this.serializable(async (tx) => {
      const charge = await tx.settlementChargeAssessment.create({
        data: {
          clientId,
          settlementId: id,
          chargeType: input.chargeType,
          description: input.description.trim(),
          assessedAmount: value,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          evidence: input.evidence ? json(input.evidence) : undefined,
          assessedById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'SETTLEMENT_CHARGE_ASSESSED',
        'SettlementChargeAssessment',
        charge.id,
        { amount: money(value) },
      );
      return charge;
    });
  }
  async decideCharge(
    clientId: string,
    id: string,
    chargeId: string,
    actorId: string,
    approve: boolean,
    approvedAmount?: string,
  ) {
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_IMMUTABLE');
    const charge = await this.db.settlementChargeAssessment.findFirst({
      where: { id: chargeId, clientId, settlementId: id },
    });
    if (!charge) throw new NotFoundException('Assessment not found.');
    if (charge.status !== 'ASSESSED' && charge.status !== 'APPROVAL_REQUIRED')
      fail('CHARGE_ALREADY_DECIDED');
    if (charge.assessedById === actorId) fail('CHARGE_MAKER_CHECKER_REQUIRED');
    const value = approve
      ? approvedAmount
        ? amount(approvedAmount)
        : charge.assessedAmount
      : zero;
    if (value.gt(charge.assessedAmount)) fail('APPROVAL_EXCEEDS_ASSESSMENT');
    if (approve)
      await this.billing.postCharge(
        clientId,
        row.riderId,
        actorId,
        `settlement:${id}:charge:${chargeId}`,
        {
          chargeType: charge.chargeType,
          description: charge.description,
          quantity: '1',
          unitAmount: money(value),
          currency: row.currency,
          referenceType: 'FINAL_SETTLEMENT',
          referenceId: id,
        },
      );
    return this.serializable(async (tx) => {
      const changed = await tx.settlementChargeAssessment.updateMany({
        where: {
          id: chargeId,
          clientId,
          settlementId: id,
          status: { in: ['ASSESSED', 'APPROVAL_REQUIRED'] },
        },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          approvedAmount: approve ? value : zero,
          approvedById: actorId,
          approvedAt: new Date(),
        },
      });
      if (!changed.count) fail('CHARGE_ALREADY_DECIDED');
      await this.audit(
        tx,
        clientId,
        actorId,
        approve ? 'SETTLEMENT_CHARGE_APPROVED' : 'SETTLEMENT_CHARGE_REJECTED',
        'SettlementChargeAssessment',
        chargeId,
        { amount: money(value) },
      );
      return tx.settlementChargeAssessment.findUniqueOrThrow({
        where: { id: chargeId },
      });
    });
  }
  private async finalBilling(
    clientId: string,
    row: { agreementId: string; billingCutoffAt: Date },
    actorId: string,
  ) {
    for (let i = 0; i < 100; i++) {
      const schedule = await this.db.riderBillingSchedule.findFirst({
        where: { clientId, agreementId: row.agreementId },
      });
      if (!schedule)
        throw new ConflictException('FINAL_BILLING_SCHEDULE_REQUIRED');
      if (schedule.nextPeriodStart >= row.billingCutoffAt) return;
      if (schedule.status === 'CLOSED') fail('FINAL_BILLING_INCOMPLETE');
      await this.engine.generate(clientId, schedule.id, actorId);
    }
    fail('FINAL_BILLING_PERIOD_LIMIT');
  }
  async submitReview(clientId: string, id: string, actorId: string) {
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_NOT_REVIEWABLE');
    const [charges, adjustments] = await Promise.all([
      this.db.settlementChargeAssessment.count({
        where: {
          clientId,
          settlementId: id,
          status: { in: ['ASSESSED', 'APPROVAL_REQUIRED'] },
        },
      }),
      this.db.settlementAdjustment.count({
        where: { clientId, settlementId: id, status: 'PENDING' },
      }),
    ]);
    if (charges || adjustments) fail('SETTLEMENT_ITEMS_REQUIRE_DECISION');
    return this.serializable(async (tx) => {
      const changed = await tx.riderFinalSettlement.updateMany({
        where: { id, clientId, status: 'DRAFT' },
        data: { status: 'UNDER_REVIEW' },
      });
      if (!changed.count) fail('SETTLEMENT_NOT_REVIEWABLE');
      await this.audit(
        tx,
        clientId,
        actorId,
        'FINAL_SETTLEMENT_REVIEW_REQUESTED',
        'RiderFinalSettlement',
        id,
      );
      return tx.riderFinalSettlement.findUniqueOrThrow({ where: { id } });
    });
  }
  async requestApproval(clientId: string, id: string, actorId: string) {
    await this.settlement(clientId, id);
    return this.serializable(async (tx) => {
      const changed = await tx.riderFinalSettlement.updateMany({
        where: { id, clientId, status: 'UNDER_REVIEW' },
        data: { status: 'APPROVAL_PENDING' },
      });
      if (!changed.count) fail('SETTLEMENT_NOT_UNDER_REVIEW');
      await this.audit(
        tx,
        clientId,
        actorId,
        'FINAL_SETTLEMENT_APPROVAL_REQUESTED',
        'RiderFinalSettlement',
        id,
      );
      return tx.riderFinalSettlement.findUniqueOrThrow({ where: { id } });
    });
  }
  async approve(clientId: string, id: string, actorId: string) {
    const row = await this.settlement(clientId, id);
    if (
      row.status === 'APPROVED' ||
      row.status === 'PAYMENT_PENDING' ||
      row.status === 'REFUND_PENDING' ||
      row.status === 'SETTLED'
    )
      return row;
    if (!['DRAFT', 'UNDER_REVIEW', 'APPROVAL_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVABLE');
    if (row.createdById === actorId) fail('SETTLEMENT_MAKER_CHECKER_REQUIRED');
    const undecided = await this.db.settlementChargeAssessment.count({
      where: {
        clientId,
        settlementId: id,
        status: { in: ['ASSESSED', 'APPROVAL_REQUIRED'] },
      },
    });
    if (undecided) fail('UNAPPROVED_CHARGES');
    if (
      await this.db.settlementAdjustment.count({
        where: { clientId, settlementId: id, status: 'PENDING' },
      })
    )
      fail('UNAPPROVED_ADJUSTMENTS');
    await this.finalBilling(clientId, row, actorId);
    await this.applyAvailableCredits(clientId, row, actorId);
    await this.applyUnallocatedPayments(clientId, row, actorId);
    const preview = await this.preview(clientId, row.agreementId);
    return this.serializable(async (tx) => {
      const current = await tx.riderFinalSettlement.findFirstOrThrow({
        where: { id, clientId },
      });
      if (
        !['DRAFT', 'UNDER_REVIEW', 'APPROVAL_PENDING'].includes(current.status)
      )
        fail('SETTLEMENT_NOT_APPROVABLE');
      const approved = await tx.riderFinalSettlement.update({
        where: { id },
        data: {
          status: new D(preview.existingOutstanding).gt(0)
            ? 'PAYMENT_PENDING'
            : new D(preview.depositHeld).gt(0)
              ? 'REFUND_PENDING'
              : 'APPROVED',
          approvedById: actorId,
          approvedAt: new Date(),
          snapshot: json(preview),
        },
      });
      await tx.settlementRevision.create({
        data: {
          clientId,
          settlementId: id,
          version: current.version,
          snapshot: json(preview),
          createdById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'FINAL_SETTLEMENT_APPROVED',
        'RiderFinalSettlement',
        id,
        { version: current.version },
      );
      return approved;
    });
  }
  private async applyAvailableCredits(
    clientId: string,
    row: { id: string; riderId: string; agreementId: string },
    actorId: string,
  ) {
    await this.serializable(async (tx) => {
      const invoices = await tx.riderInvoice.findMany({
        where: {
          clientId,
          agreementId: row.agreementId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: zero },
        },
        orderBy: { dueDate: 'asc' },
      });
      const credits = await tx.riderCredit.findMany({
        where: {
          clientId,
          riderId: row.riderId,
          status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] },
          remainingAmount: { gt: zero },
        },
        orderBy: { effectiveAt: 'asc' },
      });
      for (const credit of credits)
        for (const invoice of invoices) {
          if (credit.remainingAmount.lte(0) || invoice.outstandingAmount.lte(0))
            continue;
          if (invoice.currency !== credit.currency)
            fail('SETTLEMENT_CURRENCY_MISMATCH');
          const value = D.min(
            credit.remainingAmount,
            invoice.outstandingAmount,
          );
          await tx.riderSettlementCreditApplication.create({
            data: {
              clientId,
              settlementId: row.id,
              creditId: credit.id,
              invoiceId: invoice.id,
              amount: value,
              createdById: actorId,
            },
          });
          credit.remainingAmount = credit.remainingAmount.minus(value);
          invoice.outstandingAmount = invoice.outstandingAmount.minus(value);
          await tx.riderCredit.update({
            where: { id: credit.id },
            data: {
              remainingAmount: credit.remainingAmount,
              status: credit.remainingAmount.eq(0)
                ? 'APPLIED'
                : 'PARTIALLY_APPLIED',
            },
          });
          await tx.riderInvoice.update({
            where: { id: invoice.id },
            data: {
              outstandingAmount: invoice.outstandingAmount,
              appliedSettlementCreditAmount: { increment: value },
              status: invoice.outstandingAmount.eq(0) ? 'PAID' : invoice.status,
              paidAt: invoice.outstandingAmount.eq(0) ? new Date() : undefined,
            },
          });
          await this.audit(
            tx,
            clientId,
            actorId,
            'SETTLEMENT_CREDIT_APPLIED',
            'RiderSettlementCreditApplication',
            credit.id,
            { invoiceId: invoice.id, amount: money(value) },
          );
        }
    });
  }
  private async applyUnallocatedPayments(
    clientId: string,
    row: { riderId: string; agreementId: string },
    actorId: string,
  ) {
    const payments = await this.db.riderPayment.findMany({
      where: {
        clientId,
        riderId: row.riderId,
        status: 'CONFIRMED',
        unallocatedAmount: { gt: zero },
      },
      orderBy: { receivedAt: 'asc' },
    });
    for (const payment of payments) {
      await this.allocateToAgreement(
        clientId,
        row.riderId,
        row.agreementId,
        payment.id,
        actorId,
      );
    }
  }
  private async allocateToAgreement(
    clientId: string,
    riderId: string,
    agreementId: string,
    paymentId: string,
    actorId: string,
  ) {
    const invoices = await this.db.riderInvoice.findMany({
      where: {
        clientId,
        agreementId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        outstandingAmount: { gt: zero },
      },
      orderBy: { dueDate: 'asc' },
    });
    for (const invoice of invoices) {
      const payment = await this.db.riderPayment.findFirstOrThrow({
        where: { id: paymentId, clientId, riderId },
      });
      if (payment.unallocatedAmount.lte(0)) break;
      await this.payments.allocate(clientId, riderId, paymentId, actorId, {
        policy: 'SPECIFIC_INVOICE',
        invoiceId: invoice.id,
        amount: money(
          D.min(payment.unallocatedAmount, invoice.outstandingAmount),
        ),
      });
    }
  }
  async applyDeposit(
    clientId: string,
    id: string,
    depositId: string,
    actorId: string,
    value: string,
    reason: string,
  ) {
    if (!(await this.policy(clientId)).depositApplicationEnabled)
      fail('DEPOSIT_APPLICATION_POLICY_DISABLED');
    const row = await this.settlement(clientId, id);
    if (!['APPROVED', 'PAYMENT_PENDING', 'REFUND_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVED');
    const requested = amount(value);
    const deposit = await this.deposits.get(clientId, depositId, row.riderId);
    if (
      deposit.agreementId !== row.agreementId ||
      deposit.currency !== row.currency
    )
      fail('DEPOSIT_SCOPE_MISMATCH');
    const existing = await this.db.settlementDepositApplication.findUnique({
      where: { settlementId_depositId: { settlementId: id, depositId } },
    });
    if (existing) {
      if (!existing.amount.eq(requested))
        fail('DEPOSIT_APPLICATION_ALREADY_EXISTS');
      return existing;
    }
    const holds = await this.db.settlementDepositHold.aggregate({
      where: { clientId, depositId, status: 'ACTIVE' },
      _sum: { amount: true },
    });
    if (requested.gt(deposit.availableAmount.minus(holds._sum.amount ?? zero)))
      fail('DEPOSIT_HELD_OR_INSUFFICIENT');
    const due = await this.db.riderInvoice.aggregate({
      where: {
        clientId,
        agreementId: row.agreementId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { outstandingAmount: true },
    });
    if (requested.gt(due._sum.outstandingAmount ?? zero))
      fail('DEPOSIT_APPLICATION_EXCEEDS_RECEIVABLE');
    // A deposit application has two existing financial postings: liability deduction and an internal rider payment.
    const deduction = await this.deposits.move(
      clientId,
      actorId,
      depositId,
      {
        amount: money(requested),
        reason,
        reasonCode: 'FINAL_SETTLEMENT',
        referenceType: 'FINAL_SETTLEMENT',
        referenceId: id,
      },
      `settlement:${id}:deposit:${depositId}:deduct`,
      'DEDUCTION',
    );
    const payment = await this.payments.record(
      clientId,
      row.riderId,
      actorId,
      `settlement:${id}:deposit:${depositId}:payment`,
      {
        amount: money(requested),
        currency: row.currency,
        method: 'OTHER',
        externalReference: deduction.id,
      },
    );
    if (payment.unallocatedAmount.gt(0))
      await this.allocateToAgreement(
        clientId,
        row.riderId,
        row.agreementId,
        payment.id,
        actorId,
      );
    return this.serializable(async (tx) => {
      const old = await tx.settlementDepositApplication.findUnique({
        where: { settlementId_depositId: { settlementId: id, depositId } },
      });
      if (old) return old;
      const created = await tx.settlementDepositApplication.create({
        data: {
          clientId,
          settlementId: id,
          depositId,
          depositTransactionId: deduction.id,
          paymentId: payment.id,
          amount: requested,
        },
      });
      const remainingDue = await tx.riderInvoice.aggregate({
        where: {
          clientId,
          agreementId: row.agreementId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { outstandingAmount: true },
      });
      const remainingDeposit = await tx.riderDeposit.aggregate({
        where: { clientId, agreementId: row.agreementId },
        _sum: { availableAmount: true },
      });
      const nextStatus = (remainingDue._sum.outstandingAmount ?? zero).gt(0)
        ? 'PAYMENT_PENDING'
        : (remainingDeposit._sum.availableAmount ?? zero).gt(0)
          ? 'REFUND_PENDING'
          : 'APPROVED';
      await tx.riderFinalSettlement.update({
        where: { id },
        data: { status: nextStatus },
      });
      await tx.riderRentalAgreement.update({
        where: { id: row.agreementId },
        data: { commercialClosureState: nextStatus },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_DEDUCTION_COMPLETED',
        'SettlementDepositApplication',
        created.id,
        { amount: money(requested) },
      );
      return created;
    });
  }
  async hold(
    clientId: string,
    id: string,
    depositId: string,
    actorId: string,
    value: string,
    reason: string,
    holdUntil?: string,
  ) {
    const row = await this.settlement(clientId, id);
    if (!['DRAFT', 'APPROVED'].includes(row.status))
      fail('SETTLEMENT_IMMUTABLE');
    const requested = amount(value);
    const deposit = await this.deposits.get(clientId, depositId, row.riderId);
    if (deposit.agreementId !== row.agreementId) fail('DEPOSIT_SCOPE_MISMATCH');
    return this.serializable(async (tx) => {
      const active = await tx.settlementDepositHold.aggregate({
        where: { clientId, depositId, status: 'ACTIVE' },
        _sum: { amount: true },
      });
      const refunds = await tx.riderDepositRefundRequest.aggregate({
        where: { clientId, depositId, status: 'REQUESTED' },
        _sum: { amount: true },
      });
      if (
        requested
          .plus(active._sum.amount ?? zero)
          .plus(refunds._sum.amount ?? zero)
          .gt(deposit.availableAmount)
      )
        fail('DEPOSIT_HOLD_EXCEEDS_AVAILABLE');
      const hold = await tx.settlementDepositHold.create({
        data: {
          clientId,
          settlementId: id,
          depositId,
          amount: requested,
          reason,
          holdUntil: holdUntil ? new Date(holdUntil) : undefined,
          createdById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_HOLD_CREATED',
        'SettlementDepositHold',
        hold.id,
        { amount: money(requested) },
      );
      return hold;
    });
  }
  async releaseHold(
    clientId: string,
    id: string,
    holdId: string,
    actorId: string,
  ) {
    await this.settlement(clientId, id);
    return this.serializable(async (tx) => {
      const hold = await tx.settlementDepositHold.findFirst({
        where: { id: holdId, clientId, settlementId: id },
      });
      if (!hold) throw new NotFoundException('Hold not found.');
      if (hold.status === 'RELEASED') return hold;
      const changed = await tx.settlementDepositHold.update({
        where: { id: holdId },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_HOLD_RELEASED',
        'SettlementDepositHold',
        holdId,
      );
      return changed;
    });
  }
  async requestRefund(
    clientId: string,
    id: string,
    depositId: string,
    actorId: string,
    key: string,
    destinationType: string,
  ) {
    if (!(await this.policy(clientId)).manualDepositRefundEnabled)
      fail('MANUAL_DEPOSIT_REFUND_POLICY_DISABLED');
    if (!key || key.length > 80)
      throw new BadRequestException('Idempotency-Key is required.');
    if (
      ![
        'BANK_ACCOUNT',
        'UPI',
        'MANUAL_BANK_TRANSFER',
        'ORIGINAL_PAYMENT_METHOD',
      ].includes(destinationType)
    )
      throw new BadRequestException('Invalid refund destination.');
    const row = await this.settlement(clientId, id);
    if (!['APPROVED', 'REFUND_PENDING', 'PAYMENT_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVED');
    const previous = await this.db.settlementRefundRequest.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
    });
    if (previous) {
      if (previous.settlementId !== id || previous.depositId !== depositId)
        fail('REFUND_KEY_REUSED');
      return previous;
    }
    const deposit = await this.deposits.get(clientId, depositId, row.riderId);
    if (deposit.agreementId !== row.agreementId) fail('DEPOSIT_SCOPE_MISMATCH');
    const holds = await this.db.settlementDepositHold.aggregate({
      where: { clientId, depositId, status: 'ACTIVE' },
      _sum: { amount: true },
    });
    const pending = await this.db.riderDepositRefundRequest.aggregate({
      where: { clientId, depositId, status: 'REQUESTED' },
      _sum: { amount: true },
    });
    const refundable = deposit.availableAmount
      .minus(holds._sum.amount ?? zero)
      .minus(pending._sum.amount ?? zero);
    if (refundable.lte(0)) fail('NO_REFUNDABLE_DEPOSIT');
    const existingDue = await this.db.riderInvoice.aggregate({
      where: {
        clientId,
        agreementId: row.agreementId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { outstandingAmount: true },
    });
    if ((existingDue._sum.outstandingAmount ?? zero).gt(0))
      fail('OUTSTANDING_OBLIGATION_REQUIRES_REVIEW');
    const request = await this.deposits.requestRefund(
      clientId,
      actorId,
      depositId,
      {
        amount: money(refundable),
        reason: `Final settlement ${row.settlementNumber}`,
      },
      `settlement:${id}:refund:${key}`,
    );
    return this.serializable(async (tx) => {
      const old = await tx.settlementRefundRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (old) return old;
      const refund = await tx.settlementRefundRequest.create({
        data: {
          clientId,
          riderId: row.riderId,
          settlementId: id,
          depositId,
          depositRefundId: request.id,
          refundType:
            deposit.depositType === 'RIDER_SECURITY'
              ? 'SECURITY_DEPOSIT'
              : 'VEHICLE_DEPOSIT',
          destinationType,
          amount: refundable,
          currency: row.currency,
          idempotencyKey: key,
          requestedById: actorId,
        },
      });
      await tx.riderFinalSettlement.update({
        where: { id },
        data: { status: 'REFUND_PENDING' },
      });
      await tx.riderRentalAgreement.update({
        where: { id: row.agreementId },
        data: { commercialClosureState: 'REFUND_PENDING' },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'REFUND_REQUESTED',
        'SettlementRefundRequest',
        refund.id,
        { amount: money(refundable) },
      );
      return refund;
    });
  }
  async completeRefund(
    clientId: string,
    id: string,
    refundId: string,
    actorId: string,
    externalReference: string,
  ) {
    await this.settlement(clientId, id);
    const refund = await this.db.settlementRefundRequest.findFirst({
      where: { id: refundId, clientId, settlementId: id },
    });
    if (!refund?.depositRefundId)
      throw new NotFoundException('Deposit refund not found.');
    if (refund.status === 'COMPLETED') {
      if (refund.externalReference !== externalReference)
        fail('REFUND_REFERENCE_MISMATCH');
      return refund;
    }
    if (refund.status !== 'REQUESTED') fail('REFUND_NOT_PENDING');
    await this.deposits.completeRefund(
      clientId,
      actorId,
      refund.depositRefundId,
      externalReference,
    );
    return this.serializable(async (tx) => {
      const updated = await tx.settlementRefundRequest.update({
        where: { id: refundId },
        data: {
          status: 'COMPLETED',
          externalReference,
          completedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'REFUND_COMPLETED',
        'SettlementRefundRequest',
        refundId,
        { amount: money(refund.amount) },
      );
      return updated;
    });
  }
  async failDepositRefund(
    clientId: string,
    id: string,
    refundId: string,
    actorId: string,
    reason: string,
  ) {
    await this.settlement(clientId, id);
    if (!reason?.trim() || reason.length > 500)
      throw new BadRequestException('Failure reason is required.');
    return this.serializable(async (tx) => {
      const refund = await tx.settlementRefundRequest.findFirst({
        where: {
          id: refundId,
          clientId,
          settlementId: id,
          status: 'REQUESTED',
          depositRefundId: { not: null },
        },
      });
      if (!refund?.depositRefundId)
        throw new ConflictException('REFUND_NOT_PENDING');
      await tx.riderDepositRefundRequest.updateMany({
        where: { id: refund.depositRefundId, clientId, status: 'REQUESTED' },
        data: { status: 'FAILED' },
      });
      const updated = await tx.settlementRefundRequest.update({
        where: { id: refundId },
        data: { status: 'FAILED', failureReason: reason },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'REFUND_FAILED',
        'SettlementRefundRequest',
        refundId,
        { reason },
      );
      return updated;
    });
  }
  async issueNote(
    clientId: string,
    id: string,
    actorId: string,
    key: string,
    input: {
      kind: 'CREDIT' | 'DEBIT';
      reasonCode: string;
      description: string;
      amount: string;
      invoiceId?: string;
    },
  ) {
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_IMMUTABLE');
    if (
      !key ||
      key.length > 80 ||
      !input.description?.trim() ||
      input.description.length > 300 ||
      (input.kind !== 'CREDIT' && input.kind !== 'DEBIT') ||
      !(input.kind === 'CREDIT' ? creditReasons : debitReasons).has(
        input.reasonCode,
      )
    )
      throw new BadRequestException('Invalid financial note.');
    const value = amount(input.amount);
    const sourceKey = `settlement:${id}:note:${key}`;
    const existing = await this.db.riderFinancialNote.findUnique({
      where: { sourceId: sourceKey },
    });
    if (existing) {
      if (
        existing.clientId !== clientId ||
        existing.agreementId !== row.agreementId ||
        existing.kind !== input.kind ||
        existing.reasonCode !== input.reasonCode ||
        existing.description !== input.description ||
        !existing.totalAmount.eq(value) ||
        existing.invoiceId !== (input.invoiceId ?? null)
      )
        fail('FINANCIAL_NOTE_KEY_REUSED');
      return existing;
    }
    const invoice = input.invoiceId
      ? await this.db.riderInvoice.findFirst({
          where: {
            id: input.invoiceId,
            clientId,
            riderId: row.riderId,
            agreementId: row.agreementId,
          },
          include: { lines: true },
        })
      : null;
    if (input.invoiceId && !invoice)
      throw new NotFoundException('Invoice not found.');
    if (input.kind === 'CREDIT' && invoice) {
      const prior = await this.db.riderFinancialNote.aggregate({
        where: {
          clientId,
          invoiceId: invoice.id,
          kind: 'CREDIT',
          status: 'ISSUED',
        },
        _sum: { totalAmount: true },
      });
      if (value.plus(prior._sum.totalAmount ?? zero).gt(invoice.totalAmount))
        fail('CREDIT_NOTE_EXCEEDS_INVOICE');
    }
    const taxableLines =
      invoice?.lines.filter((line) => line.kind === 'CHARGE') ?? [];
    if (
      invoice?.taxAmount.gt(0) &&
      (taxableLines.length !== 1 ||
        invoice.lines.some((line) => line.kind === 'CREDIT') ||
        !taxableLines[0].taxAmount ||
        taxableLines[0].amount.lte(0))
    )
      fail('TAX_NOTE_REQUIRES_SINGLE_FROZEN_TAX_LINE');
    const tax =
      invoice?.taxAmount.gt(0) && taxableLines.length === 1
        ? value
            .mul(taxableLines[0].taxAmount!)
            .div(taxableLines[0].amount)
            .toDecimalPlaces(2, D.ROUND_HALF_UP)
        : zero;
    if (input.kind === 'CREDIT')
      await this.billing.postCredit(clientId, row.riderId, actorId, sourceKey, {
        creditType: input.reasonCode,
        description: input.description,
        amount: money(value),
        currency: row.currency,
        referenceType: 'FINAL_SETTLEMENT',
        referenceId: id,
      });
    else
      await this.billing.postCharge(clientId, row.riderId, actorId, sourceKey, {
        chargeType: input.reasonCode,
        description: input.description,
        quantity: '1',
        unitAmount: money(value),
        currency: row.currency,
        referenceType: 'FINAL_SETTLEMENT',
        referenceId: id,
      });
    return this.serializable(async (tx) => {
      const old = await tx.riderFinancialNote.findUnique({
        where: { sourceId: sourceKey },
      });
      if (old) return old;
      const now = new Date();
      const fy =
        now.getUTCMonth() >= 3
          ? now.getUTCFullYear()
          : now.getUTCFullYear() - 1;
      const year = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
      const kind = input.kind === 'CREDIT' ? 'CN' : 'DN';
      const sequence = await tx.settlementSequence.upsert({
        where: { clientId_kind_year: { clientId, kind, year } },
        create: { clientId, kind, year, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const note = await tx.riderFinancialNote.create({
        data: {
          clientId,
          riderId: row.riderId,
          agreementId: row.agreementId,
          invoiceId: input.invoiceId,
          noteNumber: `${kind}/${year}/${String(sequence.lastNumber).padStart(6, '0')}`,
          kind: input.kind,
          reasonCode: input.reasonCode,
          description: input.description,
          subtotal: value.minus(tax),
          taxAmount: tax,
          totalAmount: value,
          currency: row.currency,
          taxSnapshot:
            taxableLines[0]?.taxSnapshot ?? invoice?.taxSnapshot ?? undefined,
          sourceId: sourceKey,
          createdById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        input.kind === 'CREDIT' ? 'CREDIT_NOTE_ISSUED' : 'DEBIT_NOTE_ISSUED',
        'RiderFinancialNote',
        note.id,
        { amount: money(value) },
      );
      return note;
    });
  }
  async adjustment(
    clientId: string,
    id: string,
    actorId: string,
    input: { type: 'CREDIT' | 'DEBIT'; amount: string; reason: string },
  ) {
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_IMMUTABLE');
    if (
      !['CREDIT', 'DEBIT'].includes(input.type) ||
      !input.reason?.trim() ||
      input.reason.length > 500
    )
      throw new BadRequestException('Invalid adjustment.');
    const value = amount(input.amount);
    return this.serializable(async (tx) => {
      const adjustment = await tx.settlementAdjustment.create({
        data: {
          clientId,
          settlementId: id,
          type: input.type,
          reason: input.reason,
          amount: value,
          createdById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'SETTLEMENT_ADJUSTMENT_REQUESTED',
        'SettlementAdjustment',
        adjustment.id,
        { amount: money(value), type: input.type },
      );
      return adjustment;
    });
  }
  async decideAdjustment(
    clientId: string,
    id: string,
    adjustmentId: string,
    actorId: string,
    approve: boolean,
  ) {
    const row = await this.settlement(clientId, id);
    if (row.status !== 'DRAFT') fail('SETTLEMENT_IMMUTABLE');
    const adjustment = await this.db.settlementAdjustment.findFirst({
      where: { id: adjustmentId, settlementId: id, clientId },
    });
    if (!adjustment) throw new NotFoundException('Adjustment not found.');
    if (adjustment.status !== 'PENDING') fail('ADJUSTMENT_ALREADY_DECIDED');
    if (adjustment.createdById === actorId)
      fail('ADJUSTMENT_MAKER_CHECKER_REQUIRED');
    if (approve) {
      const sourceKey = `settlement:${id}:adjustment:${adjustmentId}`;
      if (adjustment.type === 'CREDIT')
        await this.billing.postCredit(
          clientId,
          row.riderId,
          actorId,
          sourceKey,
          {
            creditType: 'SETTLEMENT_ADJUSTMENT',
            description: adjustment.reason,
            amount: money(adjustment.amount),
            currency: row.currency,
            referenceType: 'FINAL_SETTLEMENT',
            referenceId: id,
          },
        );
      else
        await this.billing.postCharge(
          clientId,
          row.riderId,
          actorId,
          sourceKey,
          {
            chargeType: 'SETTLEMENT_ADJUSTMENT',
            description: adjustment.reason,
            quantity: '1',
            unitAmount: money(adjustment.amount),
            currency: row.currency,
            referenceType: 'FINAL_SETTLEMENT',
            referenceId: id,
          },
        );
    }
    return this.serializable(async (tx) => {
      const changed = await tx.settlementAdjustment.updateMany({
        where: {
          id: adjustmentId,
          clientId,
          settlementId: id,
          status: 'PENDING',
        },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          approvedById: actorId,
          approvedAt: new Date(),
        },
      });
      if (!changed.count) fail('ADJUSTMENT_ALREADY_DECIDED');
      await this.audit(
        tx,
        clientId,
        actorId,
        approve
          ? 'SETTLEMENT_ADJUSTMENT_APPROVED'
          : 'SETTLEMENT_ADJUSTMENT_REJECTED',
        'SettlementAdjustment',
        adjustmentId,
      );
      return tx.settlementAdjustment.findUniqueOrThrow({
        where: { id: adjustmentId },
      });
    });
  }
  async requestExcessPaymentRefund(
    clientId: string,
    id: string,
    paymentId: string,
    actorId: string,
    key: string,
  ) {
    const row = await this.settlement(clientId, id);
    if (!['APPROVED', 'REFUND_PENDING', 'PAYMENT_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVED');
    const payment = await this.db.riderPayment.findFirst({
      where: {
        id: paymentId,
        clientId,
        riderId: row.riderId,
        status: 'CONFIRMED',
      },
    });
    if (!payment || !payment.unallocatedAmount.eq(payment.amount))
      throw new ConflictException(
        'PAYMENT_REFUND_REQUIRES_FULLY_UNALLOCATED_SOURCE',
      );
    const due = await this.db.riderInvoice.aggregate({
      where: {
        clientId,
        agreementId: row.agreementId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { outstandingAmount: true },
    });
    if ((due._sum.outstandingAmount ?? zero).gt(0))
      fail('OUTSTANDING_OBLIGATION_REQUIRES_REVIEW');
    const provider = await this.providerRefunds.request(
      clientId,
      row.riderId,
      paymentId,
      actorId,
      key,
      `Excess payment at final settlement ${row.settlementNumber}`,
    );
    return this.serializable(async (tx) => {
      const previous = await tx.settlementRefundRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (previous) return previous;
      return tx.settlementRefundRequest.create({
        data: {
          clientId,
          riderId: row.riderId,
          settlementId: id,
          paymentId,
          paymentRefundId: provider.refundId,
          refundType: 'EXCESS_PAYMENT',
          destinationType: 'ORIGINAL_PAYMENT_METHOD',
          amount: payment.amount,
          currency: row.currency,
          status: provider.status === 'SUCCESS' ? 'COMPLETED' : provider.status,
          idempotencyKey: key,
          requestedById: actorId,
          completedAt: provider.status === 'SUCCESS' ? new Date() : undefined,
        },
      });
    });
  }
  async requestManualExcessRefund(
    clientId: string,
    id: string,
    paymentId: string,
    actorId: string,
    key: string,
    value: string,
  ) {
    const row = await this.settlement(clientId, id);
    if (!['APPROVED', 'REFUND_PENDING', 'PAYMENT_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVED');
    if (!key || key.length > 120)
      throw new BadRequestException('Idempotency-Key is required.');
    const requested = amount(value);
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RiderPayment" WHERE "id" = ${paymentId} AND "clientId" = ${clientId} FOR UPDATE`;
      const old = await tx.settlementRefundRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (old) {
        if (
          old.paymentId !== paymentId ||
          !old.amount.eq(requested) ||
          old.settlementId !== id
        )
          fail('REFUND_KEY_REUSED');
        return old;
      }
      const payment = await tx.riderPayment.findFirst({
        where: {
          id: paymentId,
          clientId,
          riderId: row.riderId,
          status: 'CONFIRMED',
        },
      });
      if (!payment || payment.currency !== row.currency)
        throw new ConflictException('PAYMENT_NOT_REFUNDABLE');
      if (
        await tx.paymentRefund.count({
          where: {
            clientId,
            paymentId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'SUCCESS'] },
          },
        })
      )
        fail('PROVIDER_REFUND_ALREADY_EXISTS');
      const due = await tx.riderInvoice.aggregate({
        where: {
          clientId,
          agreementId: row.agreementId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { outstandingAmount: true },
      });
      if ((due._sum.outstandingAmount ?? zero).gt(0))
        fail('OUTSTANDING_OBLIGATION_REQUIRES_REVIEW');
      const pending = await tx.settlementRefundRequest.aggregate({
        where: { clientId, paymentId, status: 'REQUESTED' },
        _sum: { amount: true },
      });
      if (
        requested
          .plus(pending._sum.amount ?? zero)
          .gt(payment.unallocatedAmount)
      )
        fail('EXCESS_REFUND_EXCEEDS_UNALLOCATED');
      const refund = await tx.settlementRefundRequest.create({
        data: {
          clientId,
          riderId: row.riderId,
          settlementId: id,
          paymentId,
          refundType: 'EXCESS_PAYMENT',
          destinationType: 'MANUAL_BANK_TRANSFER',
          amount: requested,
          currency: row.currency,
          status: 'REQUESTED',
          idempotencyKey: key,
          requestedById: actorId,
        },
      });
      await tx.riderFinalSettlement.update({
        where: { id },
        data: { status: 'REFUND_PENDING' },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'REFUND_REQUESTED',
        'SettlementRefundRequest',
        refund.id,
        { amount: money(requested) },
      );
      return refund;
    });
  }
  async completeManualExcessRefund(
    clientId: string,
    id: string,
    refundId: string,
    actorId: string,
    externalReference: string,
  ) {
    await this.settlement(clientId, id);
    if (!externalReference || externalReference.length > 160)
      throw new BadRequestException('Confirmed payout reference is required.');
    return this.serializable(async (tx) => {
      const refund = await tx.settlementRefundRequest.findFirst({
        where: {
          id: refundId,
          clientId,
          settlementId: id,
          refundType: 'EXCESS_PAYMENT',
          destinationType: 'MANUAL_BANK_TRANSFER',
        },
      });
      if (!refund?.paymentId)
        throw new NotFoundException('Manual payment refund not found.');
      if (refund.status === 'COMPLETED') {
        if (refund.externalReference !== externalReference)
          fail('REFUND_REFERENCE_MISMATCH');
        return refund;
      }
      if (refund.status !== 'REQUESTED') fail('REFUND_NOT_PENDING');
      await tx.$queryRaw`SELECT "id" FROM "RiderPayment" WHERE "id" = ${refund.paymentId} AND "clientId" = ${clientId} FOR UPDATE`;
      const payment = await tx.riderPayment.findFirstOrThrow({
        where: { id: refund.paymentId, clientId, riderId: refund.riderId },
      });
      if (
        payment.status !== 'CONFIRMED' ||
        refund.amount.gt(payment.unallocatedAmount)
      )
        fail('EXCESS_REFUND_EXCEEDS_UNALLOCATED');
      const remaining = payment.unallocatedAmount.minus(refund.amount);
      const refunded = payment.refundedAmount.plus(refund.amount);
      await tx.riderPayment.update({
        where: { id: payment.id },
        data: {
          unallocatedAmount: remaining,
          refundedAmount: refunded,
          status: refunded.eq(payment.amount) ? 'REFUNDED' : 'CONFIRMED',
        },
      });
      await tx.riderLedgerEntry.create({
        data: {
          clientId,
          riderId: refund.riderId,
          entryType: 'REFUND',
          sourceType: 'SETTLEMENT_REFUND_REQUEST',
          sourceId: refund.id,
          description: 'Confirmed excess payment refund',
          debitAmount: refund.amount,
          currency: refund.currency,
        },
      });
      const updated = await tx.settlementRefundRequest.update({
        where: { id: refund.id },
        data: {
          status: 'COMPLETED',
          externalReference,
          completedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'REFUND_COMPLETED',
        'SettlementRefundRequest',
        refund.id,
        { amount: money(refund.amount) },
      );
      return updated;
    });
  }
  async verifyExcessPaymentRefund(
    clientId: string,
    id: string,
    refundId: string,
  ) {
    const row = await this.settlement(clientId, id);
    const refund = await this.db.settlementRefundRequest.findFirst({
      where: {
        id: refundId,
        clientId,
        settlementId: id,
        refundType: 'EXCESS_PAYMENT',
      },
    });
    if (!refund?.paymentRefundId)
      throw new NotFoundException('Payment refund not found.');
    const provider = await this.providerRefunds.verify(
      clientId,
      row.riderId,
      refund.paymentRefundId,
    );
    return this.db.settlementRefundRequest.update({
      where: { id: refundId },
      data: {
        status: provider.status === 'SUCCESS' ? 'COMPLETED' : provider.status,
        completedAt: provider.status === 'SUCCESS' ? new Date() : undefined,
      },
    });
  }
  async reconcile(clientId: string, id: string) {
    const row = await this.settlement(clientId, id);
    await this.billing.reconcile(clientId, row.riderId);
    const invoices = await this.db.riderInvoice.findMany({
      where: {
        clientId,
        agreementId: row.agreementId,
        status: { not: 'VOID' },
      },
      include: {
        allocations: { where: { reversedAt: null } },
        settlementCreditApplications: true,
        paymentTransactions: {
          where: { status: 'SUCCESS', riderPaymentId: null },
        },
      },
    });
    for (const invoice of invoices) {
      const cashApplied = sum(invoice.allocations.map((a) => a.amount)).plus(
        sum(invoice.paymentTransactions.map((p) => p.amount)),
      );
      const creditApplied = sum(
        invoice.settlementCreditApplications.map((a) => a.amount),
      );
      if (
        !invoice.paidAmount.eq(cashApplied) ||
        !invoice.appliedSettlementCreditAmount.eq(creditApplied) ||
        !invoice.totalAmount.eq(
          invoice.outstandingAmount.plus(cashApplied).plus(creditApplied),
        )
      )
        fail('FINAL_SETTLEMENT_RECONCILIATION_FAILED');
    }
    const deposits = await this.db.riderDeposit.findMany({
      where: { clientId, agreementId: row.agreementId },
    });
    for (const deposit of deposits)
      await this.deposits.reconcile(clientId, deposit.id);
    const applications = await this.db.settlementDepositApplication.findMany({
      where: { clientId, settlementId: id },
    });
    for (const application of applications) {
      const [transaction, payment] = await Promise.all([
        this.db.riderDepositTransaction.findFirst({
          where: {
            id: application.depositTransactionId,
            clientId,
            depositId: application.depositId,
          },
        }),
        this.db.riderPayment.findFirst({
          where: { id: application.paymentId, clientId, riderId: row.riderId },
          include: { allocations: { where: { reversedAt: null } } },
        }),
      ]);
      if (
        !transaction ||
        transaction.transactionType !== 'DEDUCTION' ||
        !transaction.amount.eq(application.amount) ||
        !payment ||
        !payment.amount.eq(application.amount) ||
        !sum(payment.allocations.map((a) => a.amount)).eq(application.amount)
      )
        fail('FINAL_SETTLEMENT_RECONCILIATION_FAILED');
    }
    return {
      reconciled: true,
      invoiceReconciled: true,
      deposits: deposits.length,
      depositApplications: applications.length,
    };
  }
  async close(clientId: string, id: string, actorId: string) {
    const row = await this.settlement(clientId, id);
    if (row.status === 'SETTLED') return row;
    if (!['APPROVED', 'PAYMENT_PENDING', 'REFUND_PENDING'].includes(row.status))
      fail('SETTLEMENT_NOT_APPROVED');
    const [
      due,
      deposits,
      pending,
      holds,
      openCharges,
      unallocated,
      availableCredits,
    ] = await Promise.all([
      this.db.riderInvoice.aggregate({
        where: {
          clientId,
          agreementId: row.agreementId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { outstandingAmount: true },
      }),
      this.db.riderDeposit.aggregate({
        where: { clientId, agreementId: row.agreementId },
        _sum: { availableAmount: true },
      }),
      this.db.settlementRefundRequest.count({
        where: {
          clientId,
          settlementId: id,
          status: {
            in: ['REQUESTED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'CREATING'],
          },
        },
      }),
      this.db.settlementDepositHold.count({
        where: { clientId, settlementId: id, status: 'ACTIVE' },
      }),
      this.db.riderCharge.count({
        where: {
          clientId,
          riderId: row.riderId,
          status: 'OPEN',
          referenceType: 'FINAL_SETTLEMENT',
          referenceId: id,
        },
      }),
      this.db.riderPayment.aggregate({
        where: { clientId, riderId: row.riderId, status: 'CONFIRMED' },
        _sum: { unallocatedAmount: true },
      }),
      this.db.riderCredit.aggregate({
        where: {
          clientId,
          riderId: row.riderId,
          status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] },
        },
        _sum: { remainingAmount: true },
      }),
    ]);
    if (
      (due._sum.outstandingAmount ?? zero).gt(0) ||
      (deposits._sum.availableAmount ?? zero).gt(0) ||
      pending ||
      holds ||
      openCharges ||
      (unallocated._sum.unallocatedAmount ?? zero).gt(0) ||
      (availableCredits._sum.remainingAmount ?? zero).gt(0)
    )
      fail('FINANCIAL_CLOSURE_PENDING');
    await this.reconcile(clientId, id);
    return this.serializable(async (tx) => {
      const current = await tx.riderFinalSettlement.findFirstOrThrow({
        where: { id, clientId },
      });
      if (current.status === 'SETTLED') return current;
      const closed = await tx.riderFinalSettlement.update({
        where: { id },
        data: { status: 'SETTLED', closedAt: new Date() },
      });
      await tx.riderRentalAgreement.update({
        where: { id: row.agreementId },
        data: {
          commercialClosureState: 'FINANCIALLY_CLOSED',
          financiallyClosedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'AGREEMENT_FINANCIALLY_CLOSED',
        'RiderRentalAgreement',
        row.agreementId,
        { settlementId: id },
      );
      return closed;
    });
  }
  async statement(
    clientId: string,
    riderId: string,
    agreementId?: string,
    from?: string,
    to?: string,
  ) {
    if (agreementId) {
      const agreement = await this.agreement(clientId, agreementId);
      if (!agreement || agreement.riderId !== riderId)
        throw new NotFoundException('Agreement not found.');
    }
    if (
      (from && Number.isNaN(new Date(from).getTime())) ||
      (to && Number.isNaN(new Date(to).getTime())) ||
      (from && to && new Date(from) > new Date(to))
    )
      throw new BadRequestException('Invalid statement date range.');
    const dateFilter = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
    const where = {
      clientId,
      riderId,
      ...(agreementId ? { agreementId } : {}),
    };
    const [
      agreements,
      invoices,
      payments,
      deposits,
      ledger,
      notes,
      settlements,
    ] = await Promise.all([
      this.db.riderRentalAgreement.findMany({
        where: {
          clientId,
          riderId,
          ...(agreementId ? { id: agreementId } : {}),
        },
        include: { commercialVersions: true, exchanges: true },
      }),
      this.db.riderInvoice.findMany({
        where: { ...where, ...(from || to ? { createdAt: dateFilter } : {}) },
        include: { lines: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.riderPayment.findMany({
        where: {
          clientId,
          riderId,
          ...(agreementId
            ? { allocations: { some: { invoice: { agreementId, clientId } } } }
            : {}),
          ...(from || to ? { receivedAt: dateFilter } : {}),
        },
        include: { allocations: true },
        orderBy: { receivedAt: 'asc' },
      }),
      this.db.riderDeposit.findMany({
        where,
        include: {
          transactions: {
            ...(from || to ? { where: { createdAt: dateFilter } } : {}),
            orderBy: { createdAt: 'asc' },
          },
          refundRequests: true,
        },
      }),
      this.db.riderLedgerEntry.findMany({
        where: { ...where, ...(from || to ? { effectiveAt: dateFilter } : {}) },
        orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      }),
      this.db.riderFinancialNote.findMany({
        where: { ...where, ...(from || to ? { issuedAt: dateFilter } : {}) },
        orderBy: { issuedAt: 'asc' },
      }),
      this.db.riderFinalSettlement.findMany({
        where,
        include: { charges: true, applications: true, refunds: true },
      }),
    ]);
    const charges = sum(
      ledger
        .filter((e) => e.category === 'CHARGE_BALANCE')
        .map((e) => e.debitAmount),
    );
    const credits = sum(
      ledger
        .filter((e) => e.category === 'CHARGE_BALANCE')
        .map((e) => e.creditAmount),
    );
    const depositLiability = sum(
      ledger
        .filter((e) => e.category === 'REFUNDABLE_DEPOSIT_LIABILITY')
        .map((e) => e.creditAmount.minus(e.debitAmount)),
    );
    return {
      riderId,
      agreementId: agreementId ?? null,
      from: from ?? null,
      to: to ?? null,
      agreements,
      invoices,
      payments,
      deposits,
      notes,
      settlements,
      ledger,
      summary: {
        charges: money(charges),
        creditsAndPayments: money(credits),
        receivableLedgerBalance: money(charges.minus(credits)),
        depositLiabilityLedgerBalance: money(depositLiability),
      },
    };
  }
}
