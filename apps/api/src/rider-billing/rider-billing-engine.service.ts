import { WalletBillingService } from '../wallet/wallet-billing.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RiderInvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { allocateCredits, ZERO } from './billing-money.js';
import {
  billingLocalDate,
  nextBillingBoundary,
  proratedAmount,
  resolveCommercialSegments,
  taxForAmount,
} from './billing-cycle.js';

const D = Prisma.Decimal;
const money = (value: Prisma.Decimal) => value.toFixed(2);
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class RiderBillingEngineService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly walletBilling?: WalletBillingService) {}

  async createSchedule(
    clientId: string,
    riderId: string,
    actorId: string,
    input: {
      agreementId: string;
      frequency: string;
      customDays?: number;
      billingMode: string;
      anchorType: string;
      anchorAt: string;
      timezone: string;
    },
  ) {
    const anchorAt = new Date(input.anchorAt);
    if (Number.isNaN(anchorAt.getTime()))
      throw new BadRequestException('Invalid anchorAt.');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      throw new BadRequestException('Invalid timezone.');
    }
    if (
      !['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM'].includes(
        input.frequency,
      ) ||
      !['PREPAID', 'POSTPAID'].includes(input.billingMode) ||
      ![
        'AGREEMENT_START',
        'VEHICLE_HANDOVER',
        'FIXED_WEEKDAY',
        'CALENDAR_MONTH',
        'CUSTOM_DATE',
      ].includes(input.anchorType)
    )
      throw new BadRequestException('Invalid billing schedule policy.');
    nextBillingBoundary(
      anchorAt,
      input.frequency,
      input.timezone,
      input.customDays,
    );
    return this.prisma.$transaction(
      async (tx) => {
        const agreement = await tx.riderRentalAgreement.findFirst({
          where: { id: input.agreementId, clientId, riderId },
          select: { id: true, currency: true, startDate: true },
        });
        if (!agreement) throw new NotFoundException('Agreement not found.');
        const firstVersion = await tx.riderAgreementCommercialVersion.findFirst(
          { where: { clientId, agreementId: agreement.id, versionNumber: 1 } },
        );
        if (!firstVersion)
          throw new ConflictException(
            'COMMERCIAL_VERSION_NOT_FOUND_FOR_PERIOD',
          );
        const firstSnapshot = firstVersion.pricingSnapshot as Record<
          string,
          unknown
        >;
        const rental = firstSnapshot.rental as
          Record<string, unknown> | undefined;
        const customUnit = String(rental?.durationUnit ?? '').toUpperCase();
        const customDuration =
          Number(rental?.durationValue ?? 0) *
          (['WEEK', 'WEEKS', 'WEEKLY'].includes(customUnit) ? 7 : 1);
        if (
          rental?.period !== input.frequency ||
          firstSnapshot.currency !== agreement.currency ||
          (input.frequency === 'CUSTOM' &&
            (customDuration !== input.customDays ||
              !['DAY', 'DAYS', 'DAILY', 'WEEK', 'WEEKS', 'WEEKLY'].includes(
                customUnit,
              )))
        )
          throw new BadRequestException(
            'Billing schedule must match the frozen commercial rental period and currency.',
          );
        if (
          input.anchorType === 'AGREEMENT_START' &&
          agreement.startDate &&
          anchorAt.getTime() !== agreement.startDate.getTime()
        )
          throw new BadRequestException('Anchor must equal agreement start.');
        const existing = await tx.riderBillingSchedule.findUnique({
          where: { agreementId: input.agreementId },
        });
        if (existing)
          throw new ConflictException('BILLING_PERIOD_ALREADY_EXISTS');
        const profile = await tx.riderPaymentProfile.findUnique({
          where: { clientId_riderId: { clientId, riderId } },
        });
        if (profile && profile.currency !== agreement.currency)
          throw new ConflictException('INVOICE_CURRENCY_MISMATCH');
        await tx.riderPaymentProfile.upsert({
          where: { clientId_riderId: { clientId, riderId } },
          create: {
            clientId,
            riderId,
            currency: agreement.currency,
            billingMode: input.billingMode,
          },
          update: { billingMode: input.billingMode },
        });
        const schedule = await tx.riderBillingSchedule.create({
          data: {
            clientId,
            riderId,
            agreementId: agreement.id,
            frequency: input.frequency,
            customDays: input.customDays,
            billingMode: input.billingMode,
            anchorType: input.anchorType,
            anchorAt,
            timezone: input.timezone,
            nextPeriodStart: anchorAt,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'BILLING_SCHEDULE_CREATED',
            entityType: 'RiderBillingSchedule',
            entityId: schedule.id,
            newData: { agreementId: agreement.id, frequency: input.frequency },
          },
        });
        return schedule;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async generate(clientId: string, scheduleId: string, actorId: string | null) {
    for (let attempt = 0; ; attempt++) {
      try {
        const invoice = await this.prisma.$transaction(
          (tx) => this.generateInTransaction(tx, clientId, scheduleId, actorId),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20000,
          },
        );
        const profile = await this.prisma.riderPaymentProfile.findFirst({ where: { clientId, riderId: invoice.riderId } });
        if (profile?.autoSettleInvoiceFromWallet && this.walletBilling && invoice.outstandingAmount.gt(0))
          return this.walletBilling.settle(clientId, invoice.id, actorId ?? 'SYSTEM', `auto:${invoice.id}`);
        return invoice;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }

  private async generateInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    scheduleId: string,
    actorId: string | null,
  ) {
    const schedule = await tx.riderBillingSchedule.findFirst({
      where: { id: scheduleId, clientId, status: 'ACTIVE' },
    });
    if (!schedule) throw new NotFoundException('BILLING_SCHEDULE_NOT_FOUND');
    const start = schedule.nextPeriodStart;
    const naturalEnd = nextBillingBoundary(
      start,
      schedule.frequency,
      schedule.timezone,
      schedule.customDays,
      schedule.anchorAt,
    );
    const agreement = await tx.riderRentalAgreement.findFirst({
      where: { id: schedule.agreementId, clientId, riderId: schedule.riderId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const historicalEnd =
      agreement.terminationEffectiveAt ??
      agreement.terminatedAt ??
      agreement.completedAt;
    const end =
      historicalEnd && historicalEnd < naturalEnd ? historicalEnd : naturalEnd;
    if (end <= start) throw new ConflictException('BILLING_CUTOFF_REACHED');
    if (schedule.billingMode === 'POSTPAID' && end > new Date())
      throw new ConflictException('Billing period is not due yet.');
    if (schedule.billingMode === 'PREPAID' && start > new Date())
      throw new ConflictException('Billing period is not due yet.');
    const overlap = await tx.riderBillingPeriod.findFirst({
      where: {
        clientId,
        agreementId: schedule.agreementId,
        periodStart: { lt: end },
        periodEnd: { gt: start },
      },
    });
    if (overlap) throw new ConflictException('BILLING_PERIOD_OVERLAP');
    if (
      !['ACTIVE', 'PENDING_ACTIVATION'].includes(agreement.status) &&
      !(historicalEnd && end <= historicalEnd)
    )
      throw new ConflictException('Agreement is not billable for this period.');
    const versions = await tx.riderAgreementCommercialVersion.findMany({
      where: {
        clientId,
        agreementId: schedule.agreementId,
        effectiveFrom: { lt: end },
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    const segments = resolveCommercialSegments(versions, start, end);
    if (
      segments.some(
        (segment) =>
          (segment.snapshot.rental as Record<string, unknown> | undefined)
            ?.period !== schedule.frequency ||
          segment.snapshot.currency !== agreement.currency,
      )
    )
      throw new ConflictException(
        'Commercial version billing period or currency differs from schedule.',
      );
    const profile = await tx.riderPaymentProfile.findUniqueOrThrow({
      where: { clientId_riderId: { clientId, riderId: schedule.riderId } },
    });
    const taxProfile = await tx.riderTaxProfile.findUnique({
      where: { clientId },
      include: { rules: true },
    });
    const rules = taxProfile?.rules ?? [];
    const pickRule = (type: string, at: Date) =>
      rules
        .filter(
          (r) =>
            r.chargeType === type &&
            r.effectiveFrom <= at &&
            (!r.effectiveTo || r.effectiveTo > at),
        )
        .sort(
          (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
        )[0];
    const period = await tx.riderBillingPeriod.create({
      data: {
        clientId,
        riderId: schedule.riderId,
        agreementId: schedule.agreementId,
        scheduleId,
        periodStart: start,
        periodEnd: end,
        status: 'PROCESSING',
      },
    });
    const exchangeIds = segments
      .map((s) => versions.find((v) => v.id === s.versionId)?.amendmentId)
      .filter((id): id is string => Boolean(id));
    const amendments = exchangeIds.length
      ? await tx.riderRentalAgreementAmendment.findMany({
          where: { id: { in: exchangeIds }, clientId },
        })
      : [];
    const exchangeByAmendment = new Map(
      amendments.map((a) => [a.id, a.exchangeRequestId]),
    );
    const realizedCharges = await tx.riderCharge.findMany({
      where: {
        clientId,
        riderId: schedule.riderId,
        referenceType: 'VEHICLE_EXCHANGE',
        chargeType: 'VEHICLE_EXCHANGE_PRORATION',
        effectiveAt: { gte: start, lt: end },
      },
    });
    const realizedCredits = await tx.riderCredit.findMany({
      where: {
        clientId,
        riderId: schedule.riderId,
        referenceType: 'VEHICLE_EXCHANGE',
        creditType: 'VEHICLE_EXCHANGE_UNUSED_RENTAL',
        effectiveAt: { gte: start, lt: end },
      },
    });
    const generated: {
      id: string;
      amount: Prisma.Decimal;
      description: string;
      chargeType: string;
      versionId: string;
      vehicleId: string;
      start: Date;
      end: Date;
      quantity: Prisma.Decimal;
      detail: Prisma.InputJsonValue;
    }[] = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const exchangeId = segment.amendmentId
        ? exchangeByAmendment.get(segment.amendmentId)
        : null;
      if (
        exchangeId &&
        realizedCharges.some((c) => c.referenceId === exchangeId)
      )
        continue;
      const next = segments[index + 1];
      const nextExchangeId = next?.amendmentId
        ? exchangeByAmendment.get(next.amendmentId)
        : null;
      const fullOldPeriod =
        nextExchangeId &&
        realizedCredits.some((c) => c.referenceId === nextExchangeId);
      const amount = fullOldPeriod
        ? segment.amount
        : proratedAmount(
            segment.amount,
            segment.start,
            segment.end,
            start,
            naturalEnd,
          );
      if (amount.lte(0)) continue;
      const quantity = new D(segment.end.getTime() - segment.start.getTime())
        .div(end.getTime() - start.getTime())
        .toDecimalPlaces(4, D.ROUND_HALF_UP);
      const rental = segment.snapshot.rental as
        Record<string, unknown> | undefined;
      const detail = {
        pricingHash: segment.pricingHash,
        rental: rental ?? null,
        prorationStrategy:
          exchangeId || nextExchangeId
            ? 'REALIZED_AT_EXCHANGE'
            : 'DEFERRED_TO_BILLING',
        fullOldPeriod: Boolean(fullOldPeriod),
      };
      const charge = await tx.riderCharge.create({
        data: {
          clientId,
          riderId: schedule.riderId,
          sourceKey: `billing:${period.id}:${segment.versionId}`,
          chargeType: 'RENTAL',
          referenceType: 'BILLING_PERIOD',
          referenceId: period.id,
          description: `Vehicle rental (commercial version ${segment.versionId})`,
          quantity: quantity.gt(0) ? quantity : new D('0.0001'),
          unitAmount: segment.amount,
          amount,
          currency: agreement.currency,
          effectiveAt: start,
          agreementId: agreement.id,
          commercialVersionId: segment.versionId,
          vehicleId: segment.vehicleId,
          servicePeriodStart: segment.start,
          servicePeriodEnd: segment.end,
          pricingDetail: json(detail),
        },
      });
      await tx.riderLedgerEntry.create({
        data: {
          clientId,
          riderId: schedule.riderId,
          agreementId: agreement.id,
          vehicleId: segment.vehicleId,
          entryType: 'CHARGE',
          sourceType: 'RIDER_CHARGE',
          sourceId: charge.id,
          description: charge.description,
          debitAmount: amount,
          currency: agreement.currency,
          effectiveAt: start,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'RIDER_CHARGE_GENERATED',
          entityType: 'RiderCharge',
          entityId: charge.id,
          newData: {
            agreementId: agreement.id,
            commercialVersionId: segment.versionId,
            amount: money(amount),
          },
        },
      });
      generated.push({
        id: charge.id,
        amount,
        description: charge.description,
        chargeType: charge.chargeType,
        versionId: segment.versionId,
        vehicleId: segment.vehicleId,
        start: segment.start,
        end: segment.end,
        quantity,
        detail: json(detail),
      });
    }
    if (start.getTime() === schedule.anchorAt.getTime()) {
      const first = versions.find((v) => v.versionNumber === 1);
      const oneTime = (
        first?.pricingSnapshot as Record<string, unknown> | undefined
      )?.oneTimeCharges;
      if (Array.isArray(oneTime))
        for (const item of oneTime) {
          if (!item || typeof item !== 'object') continue;
          const line = item as Record<string, unknown>;
          if (
            typeof line.type !== 'string' ||
            typeof line.code !== 'string' ||
            typeof line.grossAmount !== 'string'
          )
            throw new ConflictException('Invalid frozen one-time charge.');
          const amount = new D(line.grossAmount);
          if (amount.lte(0)) continue;
          if (line.type === 'ONBOARDING_FEE' && await tx.riderInvoice.findFirst({ where: { clientId, sourceKey: `agreement:${agreement.id}:onboarding` } })) continue;
          const charge = await tx.riderCharge.create({
            data: {
              clientId,
              riderId: schedule.riderId,
              sourceKey: `agreement:${agreement.id}:one-time:${first!.id}:${line.code}`,
              chargeType: line.type,
              referenceType: 'RENTAL_AGREEMENT',
              referenceId: agreement.id,
              description: `${line.type} (${line.code})`,
              quantity: new D(1),
              unitAmount: amount,
              amount,
              currency: agreement.currency,
              effectiveAt: start,
              agreementId: agreement.id,
              commercialVersionId: first!.id,
              vehicleId: first!.vehicleId,
              pricingDetail: json({ frozenOneTimeLine: line }),
            },
          });
          await tx.riderLedgerEntry.create({
            data: {
              clientId,
              riderId: schedule.riderId,
              agreementId: agreement.id,
              vehicleId: first!.vehicleId,
              entryType: 'CHARGE',
              sourceType: 'RIDER_CHARGE',
              sourceId: charge.id,
              description: charge.description,
              debitAmount: amount,
              currency: agreement.currency,
              effectiveAt: start,
            },
          });
          await tx.auditLog.create({
            data: {
              clientId,
              actorId,
              action: 'RIDER_CHARGE_GENERATED',
              entityType: 'RiderCharge',
              entityId: charge.id,
              newData: {
                agreementId: agreement.id,
                commercialVersionId: first!.id,
                amount: money(amount),
              },
            },
          });
        }
    }
    const closingSettlement =
      historicalEnd && end.getTime() === historicalEnd.getTime()
        ? await tx.riderFinalSettlement.findUnique({
            where: { agreementId: agreement.id },
          })
        : null;
    const finalSource = closingSettlement
      ? [
          {
            referenceType: 'FINAL_SETTLEMENT',
            referenceId: closingSettlement.id,
          },
        ]
      : [];
    const open = await tx.riderCharge.findMany({
      where: {
        clientId,
        riderId: schedule.riderId,
        status: 'OPEN',
        OR: [{ effectiveAt: { lt: end } }, ...finalSource],
      },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
    });
    const credits = await tx.riderCredit.findMany({
      where: {
        clientId,
        riderId: schedule.riderId,
        status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] },
        OR: [{ effectiveAt: { lt: end } }, ...finalSource],
        remainingAmount: { gt: ZERO },
      },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
    });
    if (
      open.some((c) => c.currency !== agreement.currency) ||
      credits.some((c) => c.currency !== agreement.currency)
    )
      throw new ConflictException('INVOICE_CURRENCY_MISMATCH');
    const {
      subtotal: gross,
      creditAmount,
      allocations,
    } = allocateCredits(
      open.map((c) => c.amount),
      credits.map((c) => c.remainingAmount),
    );
    let taxAmount = ZERO;
    const lineTax = new Map<
      string,
      { amount: Prisma.Decimal; snapshot: Prisma.InputJsonValue }
    >();
    for (const charge of open) {
      const rule = pickRule(charge.chargeType, charge.effectiveAt);
      if (!rule)
        throw new ConflictException(
          `TAX_CONFIGURATION_MISSING:${charge.chargeType}`,
        );
      if (
        (rule.cgstRate.gt(0) && rule.igstRate.gt(0)) ||
        (rule.sgstRate.gt(0) && rule.igstRate.gt(0))
      )
        throw new ConflictException('TAX_CALCULATION_FAILED');
      const rate = rule.cgstRate.plus(rule.sgstRate).plus(rule.igstRate);
      const taxable = charge.amount
        .div(new D(1).plus(rate.div(100)))
        .toDecimalPlaces(2, D.ROUND_HALF_UP);
      const tax = taxForAmount(taxable, rule);
      const actualTax = charge.amount.minus(taxable);
      const delta = actualTax.minus(tax.total);
      if (!delta.eq(0)) {
        if (rule.igstRate.gt(0))
          tax.igst = new D(tax.igst).plus(delta).toFixed(2);
        else if (rule.sgstRate.gt(0))
          tax.sgst = new D(tax.sgst).plus(delta).toFixed(2);
        else if (rule.cgstRate.gt(0))
          tax.cgst = new D(tax.cgst).plus(delta).toFixed(2);
      }
      taxAmount = taxAmount.plus(actualTax);
      lineTax.set(charge.id, {
        amount: actualTax,
        snapshot: json({
          ...tax,
          total: money(actualTax),
          supplierState: taxProfile!.supplierState,
          supplierGstin: taxProfile!.supplierGstin,
          placeOfSupply: taxProfile!.placeOfSupply,
          customerGstin: taxProfile!.customerGstin,
          ruleId: rule.id,
        }),
      });
    }
    const total = gross.minus(creditAmount);
    const localStart = billingLocalDate(start, schedule.timezone);
    const fy =
      localStart.getUTCMonth() >= 3
        ? localStart.getUTCFullYear()
        : localStart.getUTCFullYear() - 1;
    const financialYear = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
    const sequence = await tx.riderInvoiceSequence.upsert({
      where: { clientId_financialYear: { clientId, financialYear } },
      create: { clientId, financialYear, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const issueAt = new Date();
    const due = new Date(
      issueAt.getTime() + profile.paymentTermsDays * 86400000,
    );
    const invoice = await tx.riderInvoice.create({
      data: {
        clientId,
        riderId: schedule.riderId,
        agreementId: agreement.id,
        billingPeriodId: period.id,
        invoiceNumber: `EVS/${clientId.slice(0, 8)}/${financialYear}/${String(sequence.lastNumber).padStart(6, '0')}`,
        billingPeriodStart: localStart,
        billingPeriodEnd: billingLocalDate(end, schedule.timezone),
        subtotal: gross.minus(taxAmount),
        creditAmount,
        taxAmount,
        totalAmount: total,
        outstandingAmount: total,
        currency: agreement.currency,
        dueDate: billingLocalDate(due, schedule.timezone),
        status: RiderInvoiceStatus.DRAFT,
        pricingSnapshot: json({ agreementId: agreement.id, rateCardId: agreement.rateCardId, rateCardVersionId: agreement.rateCardVersionId, segments: segments.map(segment => ({ versionId: segment.versionId, pricingHash: segment.pricingHash, snapshot: segment.snapshot })) }),
        taxSnapshot: json({
          supplierState: taxProfile?.supplierState ?? null,
          supplierGstin: taxProfile?.supplierGstin ?? null,
          placeOfSupply: taxProfile?.placeOfSupply ?? null,
          customerGstin: taxProfile?.customerGstin ?? null,
        }),
      },
    });
    for (const charge of open) {
      const extra = generated.find((g) => g.id === charge.id);
      const tax = lineTax.get(charge.id)!;
      const detail = charge.pricingDetail as Record<string, unknown> | null;
      const rental = detail?.rental as Record<string, unknown> | undefined;
      const factor = extra
        ? charge.amount.div(
            extra.amount.eq(0)
              ? new D(1)
              : new D(
                  (rental?.finalAmount as string) ?? charge.amount.toString(),
                ),
          )
        : new D(1);
      const grossAmount =
        rental && typeof rental.grossAmount === 'string'
          ? new D(rental.grossAmount)
              .mul(factor)
              .toDecimalPlaces(2, D.ROUND_HALF_UP)
          : charge.amount;
      const discountAmount = rental
        ? ['discountAmount', 'promotionAmount', 'subsidyAmount']
            .reduce(
              (sum, field) =>
                sum.plus(
                  typeof rental[field] === 'string'
                    ? new D(rental[field] as string)
                    : ZERO,
                ),
              ZERO,
            )
            .mul(factor)
            .toDecimalPlaces(2, D.ROUND_HALF_UP)
        : ZERO;
      await tx.riderInvoiceLine.create({
        data: {
          clientId,
          invoiceId: invoice.id,
          kind: 'CHARGE',
          sourceId: charge.id,
          description: charge.description,
          amount: charge.amount,
          currency: agreement.currency,
          chargeType: charge.chargeType,
          commercialVersionId: charge.commercialVersionId,
          vehicleId: charge.vehicleId,
          servicePeriodStart: charge.servicePeriodStart,
          servicePeriodEnd: charge.servicePeriodEnd,
          quantity: charge.quantity,
          unit: extra ? schedule.frequency : null,
          unitPrice: charge.unitAmount,
          grossAmount,
          discountAmount,
          taxableAmount: charge.amount.minus(tax.amount),
          taxAmount: tax.amount,
          taxSnapshot: tax.snapshot,
          pricingDetail: charge.pricingDetail ?? undefined,
        },
      });
      await tx.riderCharge.update({
        where: { id: charge.id },
        data: { status: 'INVOICED', invoiceId: invoice.id },
      });
    }
    for (let index = 0; index < credits.length; index++) {
      const used = allocations[index];
      if (!used || used.lte(0)) continue;
      const credit = credits[index];
      const remainder = credit.remainingAmount.minus(used);
      await tx.riderInvoiceLine.create({
        data: {
          clientId,
          invoiceId: invoice.id,
          kind: 'CREDIT',
          sourceId: credit.id,
          description: credit.description,
          amount: used,
          currency: agreement.currency,
        },
      });
      await tx.riderCredit.update({
        where: { id: credit.id },
        data: {
          remainingAmount: remainder,
          status: remainder.eq(0) ? 'APPLIED' : 'PARTIALLY_APPLIED',
        },
      });
    }
    await tx.riderInvoice.update({
      where: { id: invoice.id },
      data: {
        status: total.eq(0) ? 'PAID' : 'FINALIZED',
        issuedAt: issueAt,
        finalizedAt: issueAt,
        paidAt: total.eq(0) ? issueAt : null,
      },
    });
    await tx.riderBillingPeriod.update({
      where: { id: period.id },
      data: { status: 'BILLED', generatedAt: issueAt },
    });
    await tx.riderBillingSchedule.update({
      where: { id: schedule.id },
      data: {
        nextPeriodStart: end,
        status: historicalEnd && end >= historicalEnd ? 'CLOSED' : 'ACTIVE',
      },
    });
    await tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'BILLING_PERIOD_GENERATED',
        entityType: 'RiderBillingPeriod',
        entityId: period.id,
        newData: { invoiceId: invoice.id, amount: money(total) },
      },
    });
    await tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'RIDER_INVOICE_ISSUED',
        entityType: 'RiderInvoice',
        entityId: invoice.id,
        newData: { invoiceNumber: invoice.invoiceNumber, amount: money(total) },
      },
    });
    return tx.riderInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: true },
    });
  }

  async generateDue(limit = 20) {
    const due = await this.prisma.riderBillingSchedule.findMany({
      where: { status: 'ACTIVE', nextPeriodStart: { lte: new Date() } },
      orderBy: { nextPeriodStart: 'asc' },
      take: limit,
    });
    for (const schedule of due) {
      try {
        await this.generate(schedule.clientId, schedule.id, null);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    return due.length;
  }
}
