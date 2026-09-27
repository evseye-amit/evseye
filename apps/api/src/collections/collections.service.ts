import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PaymentOrchestratorService } from '../payments/payment-orchestrator.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { delinquency, localDay } from './collection-math.js';

const fail = (code: string): never => {
  throw new ConflictException({ code });
};
const number = (value: unknown, low: number, high: number) =>
  Number.isInteger(value) &&
  (value as number) >= low &&
  (value as number) <= high;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const billingDay = (now: Date, timezone: string) =>
  new Date(`${localDay(now, timezone)}T00:00:00.000Z`);
const decimal = (value: unknown, code: string) => {
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw new BadRequestException({ code });
  }
};

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly billing: RiderBillingService,
  ) {}
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        });
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
  private async lockRider(
    tx: Prisma.TransactionClient,
    clientId: string,
    riderId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "Rider" WHERE "id" = ${riderId} AND "clientId" = ${clientId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new NotFoundException({ code: 'RIDER_NOT_FOUND' });
  }
  private async event(
    tx: Prisma.TransactionClient,
    clientId: string,
    caseId: string,
    eventType: string,
    actorId?: string,
    details?: unknown,
  ) {
    await tx.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType,
        actorId,
        details: details ? json(details) : undefined,
      },
    });
  }
  private async paidOnTime(
    tx: Prisma.TransactionClient,
    clientId: string,
    riderId: string,
    caseId: string,
    promise: { createdAt: Date; promiseDate: Date },
    timezone: string,
  ) {
    const linked = await tx.collectionCaseInvoice.findMany({
      where: { clientId, caseId },
      select: { invoiceId: true },
    });
    const allocations = await tx.riderPaymentAllocation.findMany({
      where: {
        clientId,
        riderId,
        invoiceId: { in: linked.map((i) => i.invoiceId) },
        reversedAt: null,
        payment: {
          status: 'CONFIRMED',
          receivedAt: { gte: promise.createdAt },
        },
      },
      select: { amount: true, payment: { select: { receivedAt: true } } },
    });
    const deadline = promise.promiseDate.toISOString().slice(0, 10);
    return allocations
      .filter((a) => localDay(a.payment.receivedAt, timezone) <= deadline)
      .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
  }
  async listPolicies(clientId: string) {
    return this.db.collectionPolicy.findMany({
      where: { clientId },
      include: {
        versions: { include: { stages: true }, orderBy: { version: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createPolicy(clientId: string, actorId: string, input: any) {
    if (
      !input ||
      typeof input.code !== 'string' ||
      !/^[A-Z0-9_]{2,60}$/.test(input.code) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      !number(input.gracePeriodDays, 0, 365) ||
      !number(input.maximumPromiseDays ?? 14, 1, 365) ||
      !number(input.maximumMessagesPerDay ?? 1, 0, 20) ||
      !number(input.minimumMessageIntervalHours ?? 24, 0, 720) ||
      !number(input.communicationStartHour ?? 8, 0, 23) ||
      !number(input.communicationEndHour ?? 20, 1, 24) ||
      (input.communicationStartHour ?? 8) >=
        (input.communicationEndHour ?? 20) ||
      !Array.isArray(input.stages) ||
      input.stages.some(
        (s: any) =>
          typeof s.stageCode !== 'string' ||
          !/^[A-Z0-9_]{2,60}$/.test(s.stageCode) ||
          !number(s.daysFromDue, 0, 3650) ||
          !Array.isArray(s.actions),
      )
    )
      throw new BadRequestException({ code: 'INVALID_COLLECTION_POLICY' });
    try {
      new Intl.DateTimeFormat('en-US', {
        timeZone: input.timezone ?? 'Asia/Kolkata',
      });
    } catch {
      throw new BadRequestException({ code: 'INVALID_COLLECTION_TIMEZONE' });
    }
    const codes = input.stages.map((s: any) => s.stageCode);
    if (new Set(codes).size !== codes.length)
      throw new BadRequestException({ code: 'DUPLICATE_STAGE' });
    const allowed = [
      'SMS',
      'WHATSAPP',
      'EMAIL',
      'PUSH_NOTIFICATION',
      'AUTOPAY_RETRY',
      'MANUAL_CALL',
      'OPERATIONS_TASK',
      'PROMISE_TO_PAY_REQUEST',
      'FINAL_REMINDER',
      'COMMERCIAL_RESTRICTION_REVIEW',
    ];
    if (
      input.stages.some((s: any) =>
        s.actions.some((a: any) => !allowed.includes(a)),
      )
    )
      throw new BadRequestException({ code: 'INVALID_COLLECTION_ACTION' });
    return this.serializable(async (tx) => {
      const competing = await tx.collectionPolicy.findFirst({
        where: { clientId, status: 'ACTIVE', code: { not: input.code } },
      });
      if (competing) fail('COLLECTION_POLICY_ALREADY_ACTIVE');
      const policy = await tx.collectionPolicy.upsert({
        where: { clientId_code: { clientId, code: input.code } },
        create: { clientId, code: input.code, name: input.name },
        update: { name: input.name },
      });
      const previous = await tx.collectionPolicyVersion.aggregate({
        where: { policyId: policy.id },
        _max: { version: true },
      });
      const versionNumber = (previous._max.version ?? 0) + 1;
      const effectiveFrom = new Date(
        `${input.effectiveFrom ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
      );
      if (!Number.isFinite(effectiveFrom.getTime()))
        throw new BadRequestException({ code: 'INVALID_EFFECTIVE_DATE' });
      const latest = await tx.collectionPolicyVersion.findFirst({
        where: { policyId: policy.id },
        orderBy: { version: 'desc' },
      });
      if (latest && effectiveFrom <= latest.effectiveFrom)
        throw new BadRequestException({ code: 'INVALID_EFFECTIVE_DATE' });
      if (versionNumber > 1)
        await tx.collectionPolicyVersion.updateMany({
          where: { policyId: policy.id, effectiveTo: null },
          data: { effectiveTo: new Date(effectiveFrom.getTime() - 86400000) },
        });
      const version = await tx.collectionPolicyVersion.create({
        data: {
          clientId,
          policyId: policy.id,
          version: versionNumber,
          effectiveFrom,
          gracePeriodDays: input.gracePeriodDays,
          dunningEnabled: !!input.dunningEnabled,
          autoPayRetryEnabled: !!input.autoPayRetryEnabled,
          promiseToPayEnabled: !!input.promiseToPayEnabled,
          promiseHoldEnabled: !!input.promiseHoldEnabled,
          maximumPromiseDays: input.maximumPromiseDays ?? 14,
          lateFeeEnabled: !!input.lateFeeEnabled,
          restrictionEnabled: !!input.restrictionEnabled,
          maximumMessagesPerDay: input.maximumMessagesPerDay ?? 1,
          minimumMessageIntervalHours: input.minimumMessageIntervalHours ?? 24,
          communicationStartHour: input.communicationStartHour ?? 8,
          communicationEndHour: input.communicationEndHour ?? 20,
          timezone: input.timezone ?? 'Asia/Kolkata',
          stages: {
            create: input.stages.map((s: any, i: number) => ({
              clientId,
              stageCode: s.stageCode,
              stageName: s.stageName ?? s.stageCode,
              daysFromDue: s.daysFromDue,
              severity: s.severity ?? 0,
              displayOrder: s.displayOrder ?? i,
              actions: json(s.actions),
              isActive: s.isActive !== false,
            })),
          },
        },
        include: { stages: true },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'COLLECTION_POLICY_VERSION_CREATED',
          entityType: 'CollectionPolicyVersion',
          entityId: version.id,
          newData: { code: input.code, version: versionNumber },
        },
      });
      return version;
    });
  }
  private async policy(
    tx: Prisma.TransactionClient,
    clientId: string,
    now: Date,
  ) {
    const candidates = await tx.collectionPolicyVersion.findMany({
      where: {
        clientId,
        effectiveFrom: { lte: new Date(now.getTime() + 86400000) },
        policy: { status: 'ACTIVE' },
      },
      include: { stages: true },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    return (
      candidates.find(
        (v) =>
          v.effectiveFrom.toISOString().slice(0, 10) <=
            localDay(now, v.timezone) &&
          (!v.effectiveTo ||
            v.effectiveTo.toISOString().slice(0, 10) >=
              localDay(now, v.timezone)),
      ) ?? null
    );
  }
  async summary(clientId: string, riderId: string, now = new Date()) {
    const rider = await this.db.rider.findFirst({
      where: { clientId, id: riderId, deletedAt: null },
      select: { id: true },
    });
    if (!rider) throw new NotFoundException({ code: 'RIDER_NOT_FOUND' });
    const policy = await this.policy(this.db, clientId, now);
    const timezone = policy?.timezone ?? 'Asia/Kolkata';
    const invoices = await this.db.riderInvoice.findMany({
      where: {
        clientId,
        riderId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        outstandingAmount: { gt: 0 },
      },
      orderBy: { dueDate: 'asc' },
    });
    const state = delinquency(
      invoices,
      now,
      timezone,
      policy?.gracePeriodDays ?? 0,
      policy?.stages ?? [],
    );
    const [collectionCase, restrictions] = await Promise.all([
      this.db.riderCollectionCase.findFirst({
        where: { clientId, riderId, activeRiderId: riderId },
        include: { promises: { where: { activeCaseId: { not: null } } } },
      }),
      this.db.commercialRestriction.findMany({
        where: { clientId, riderId, status: 'ACTIVE' },
      }),
    ]);
    const reminders = collectionCase
      ? await this.db.collectionAction.findMany({
          where: { clientId, caseId: collectionCase.id, status: 'READY' },
          select: { id: true, result: true, executedAt: true },
          orderBy: { executedAt: 'desc' },
          take: 10,
        })
      : [];
    return {
      ...state,
      reminders,
      stage: state.stage?.stageCode ?? null,
      nextActionAt: collectionCase?.nextActionAt ?? null,
      restrictionEligibility:
        !!policy?.restrictionEnabled &&
        !!state.stage &&
        Array.isArray(state.stage.actions) &&
        state.stage.actions.includes('COMMERCIAL_RESTRICTION_REVIEW') &&
        state.overdueOutstanding.gt(0),
      due: undefined,
      overdue: undefined,
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        dueDate: i.dueDate,
        outstandingAmount: i.outstandingAmount,
      })),
      collectionCase,
      restrictions,
      commercialStanding: restrictions.length
        ? 'RESTRICTED'
        : state.delinquencyState === 'CURRENT'
          ? 'GOOD_STANDING'
          : state.delinquencyState === 'DUE'
            ? 'PAYMENT_DUE'
            : state.delinquencyState,
    };
  }
  async riderSummary(clientId: string, riderId: string, now = new Date()) {
    const summary = await this.summary(clientId, riderId, now);
    const [policy, mandate] = await Promise.all([
      this.policy(this.db, clientId, now),
      this.db.paymentMandate.findFirst({
        where: { clientId, riderId },
        select: { status: true, method: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      amountDue: summary.totalOutstanding.toFixed(2),
      overdueAmount: summary.overdueOutstanding.toFixed(2),
      dueDate: summary.oldestDueDate ?? summary.invoices[0]?.dueDate ?? null,
      daysPastDue: summary.daysPastDue,
      graceStatus:
        summary.delinquencyState === 'GRACE'
          ? 'IN_GRACE'
          : summary.delinquencyState === 'CURRENT'
            ? 'CURRENT'
            : 'PAST_GRACE',
      canPayNow: summary.totalOutstanding.gt(0),
      autoPayStatus: mandate?.status ?? 'NOT_CONFIGURED',
      promiseToPayEnabled: !!policy?.promiseToPayEnabled,
      maximumPromiseDays: policy?.maximumPromiseDays ?? null,
      collectionCaseId: summary.collectionCase?.id ?? null,
      activePromiseToPay: summary.collectionCase?.promises[0]
        ? {
            id: summary.collectionCase.promises[0].id,
            promisedAmount: summary.collectionCase.promises[0].promisedAmount,
            promiseDate: summary.collectionCase.promises[0].promiseDate,
            status: summary.collectionCase.promises[0].status,
          }
        : null,
      restrictions: summary.restrictions.map((r) => ({
        message:
          r.code === 'BLOCK_VEHICLE_EXCHANGE'
            ? 'Vehicle exchange is temporarily unavailable while payment is overdue.'
            : r.code === 'BLOCK_NEW_VEHICLE_ALLOCATION'
              ? 'New vehicle allocation is temporarily unavailable while payment is overdue.'
              : r.code === 'BLOCK_NEW_RENTAL'
                ? 'A new rental is temporarily unavailable while payment is overdue.'
                : 'Please contact operations about your outstanding payment.',
      })),
      reminders: summary.reminders,
      invoices: summary.invoices,
    };
  }
  async evaluate(clientId: string, riderId: string, now = new Date()) {
    return this.serializable(async (tx) => {
      await this.lockRider(tx, clientId, riderId);
      const existing = await tx.riderCollectionCase.findFirst({
        where: { clientId, riderId, activeRiderId: riderId },
      });
      const policy = existing
        ? await tx.collectionPolicyVersion.findFirst({
            where: { id: existing.policyVersionId, clientId },
            include: { stages: true },
          })
        : await this.policy(tx, clientId, now);
      if (!policy) return null;
      const invoices = await tx.riderInvoice.findMany({
        where: {
          clientId,
          riderId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: 0 },
        },
        orderBy: { dueDate: 'asc' },
      });
      const state = delinquency(
        invoices,
        now,
        policy.timezone,
        policy.gracePeriodDays,
        policy.stages,
      );
      if (!state.due.length) {
        if (existing) {
          const linked = await tx.collectionCaseInvoice.findMany({
            where: { clientId, caseId: existing.id },
            select: { invoiceId: true },
          });
          const settled = await tx.riderInvoice.count({
            where: {
              clientId,
              id: { in: linked.map((i) => i.invoiceId) },
              status: 'PAID',
            },
          });
          const resolutionType =
            linked.length > 0 && settled === linked.length
              ? 'FULL_PAYMENT'
              : 'INVOICE_REVERSAL';
          const activePromises = await tx.promiseToPay.findMany({
            where: { clientId, caseId: existing.id, activeCaseId: existing.id },
          });
          for (const promise of activePromises) {
            const paid = await this.paidOnTime(
              tx,
              clientId,
              riderId,
              existing.id,
              promise,
              policy.timezone,
            );
            const status =
              resolutionType === 'FULL_PAYMENT'
                ? paid.gte(promise.promisedAmount)
                  ? 'FULFILLED'
                  : 'BROKEN'
                : 'CANCELLED';
            await tx.promiseToPay.update({
              where: { id: promise.id },
              data: {
                status,
                paidSince: paid,
                activeCaseId: null,
                fulfilledAt: status === 'FULFILLED' ? now : undefined,
                brokenAt: status === 'BROKEN' ? now : undefined,
              },
            });
            await this.event(
              tx,
              clientId,
              existing.id,
              `PROMISE_${status}`,
              undefined,
              { promiseId: promise.id },
            );
          }
          await tx.riderCollectionCase.update({
            where: { id: existing.id },
            data: {
              status: 'RESOLVED',
              activeRiderId: null,
              totalOutstanding: state.totalOutstanding,
              overdueOutstanding: 0,
              delinquencyState: 'RESOLVED',
              resolvedAt: now,
              resolutionType,
            },
          });
          await tx.commercialRestriction.updateMany({
            where: { clientId, caseId: existing.id, status: 'ACTIVE' },
            data: { status: 'REMOVED', removedAt: now },
          });
          await this.event(
            tx,
            clientId,
            existing.id,
            'COLLECTION_CASE_RESOLVED',
            undefined,
            { reason: resolutionType },
          );
        }
        return null;
      }
      let current = existing;
      if (!current && state.daysPastDue > policy.gracePeriodDays) {
        current = await tx.riderCollectionCase.create({
          data: {
            clientId,
            riderId,
            agreementId: state.due[0]?.agreementId,
            policyVersionId: policy.id,
            caseNumber: `COL/${now.getUTCFullYear()}/${randomUUID().replaceAll('-', '').toUpperCase()}`,
            activeRiderId: riderId,
            delinquencyState: state.delinquencyState,
            totalOutstanding: state.totalOutstanding,
            overdueOutstanding: state.overdueOutstanding,
            oldestDueDate: state.oldestDueDate,
            daysPastDue: state.daysPastDue,
            currentStage: state.stage?.stageCode,
          },
        });
        await this.event(
          tx,
          clientId,
          current.id,
          'COLLECTION_CASE_OPENED',
          undefined,
          { invoiceIds: state.due.map((i) => i.id) },
        );
      }
      if (!current) return null;
      for (const invoice of state.due)
        await tx.collectionCaseInvoice.upsert({
          where: {
            caseId_invoiceId: { caseId: current.id, invoiceId: invoice.id },
          },
          create: { clientId, caseId: current.id, invoiceId: invoice.id },
          update: {},
        });
      const promises = await tx.promiseToPay.findMany({
        where: {
          clientId,
          caseId: current.id,
          status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] },
        },
      });
      for (const promise of promises) {
        const paid = await this.paidOnTime(
          tx,
          clientId,
          riderId,
          current.id,
          promise,
          policy.timezone,
        );
        const status = paid.gte(promise.promisedAmount)
          ? 'FULFILLED'
          : localDay(now, policy.timezone) >
              promise.promiseDate.toISOString().slice(0, 10)
            ? 'BROKEN'
            : paid.gt(0)
              ? 'PARTIALLY_FULFILLED'
              : 'ACTIVE';
        await tx.promiseToPay.update({
          where: { id: promise.id },
          data: {
            status,
            paidSince: paid,
            activeCaseId:
              status === 'FULFILLED' || status === 'BROKEN' ? null : current.id,
            fulfilledAt: status === 'FULFILLED' ? now : undefined,
            brokenAt: status === 'BROKEN' ? now : undefined,
          },
        });
        if (status !== promise.status)
          await this.event(
            tx,
            clientId,
            current.id,
            `PROMISE_${status}`,
            undefined,
            { promiseId: promise.id },
          );
      }
      const activePromise = await tx.promiseToPay.findFirst({
        where: { caseId: current.id, activeCaseId: current.id },
      });
      const dispute = await tx.collectionDispute.findFirst({
        where: { clientId, caseId: current.id, status: 'OPEN' },
      });
      const hold = !!dispute || (!!activePromise && policy.promiseHoldEnabled);
      const nextStage = policy.stages
        .filter(
          (stage) => stage.isActive && stage.daysFromDue > state.daysPastDue,
        )
        .sort((a, b) => a.daysFromDue - b.daysFromDue)[0];
      const nextActionAt =
        activePromise?.promiseDate ??
        (nextStage && state.oldestDueDate
          ? new Date(
              state.oldestDueDate.getTime() + nextStage.daysFromDue * 86400000,
            )
          : null);
      const restrictionEligible =
        !!policy.restrictionEnabled &&
        !hold &&
        !!state.stage &&
        Array.isArray(state.stage.actions) &&
        state.stage.actions.includes('COMMERCIAL_RESTRICTION_REVIEW');
      const status = dispute
        ? 'ON_HOLD'
        : activePromise
          ? 'PROMISE_TO_PAY'
          : restrictionEligible
            ? 'RESTRICTION_ELIGIBLE'
            : current.status === 'ON_HOLD'
              ? 'IN_PROGRESS'
              : current.status;
      await tx.riderCollectionCase.update({
        where: { id: current.id },
        data: {
          totalOutstanding: state.totalOutstanding,
          overdueOutstanding: state.overdueOutstanding,
          oldestDueDate: state.oldestDueDate,
          daysPastDue: state.daysPastDue,
          delinquencyState: state.delinquencyState,
          currentStage: state.stage?.stageCode,
          nextActionAt,
          status,
        },
      });
      if (state.stage && state.stage.stageCode !== current.currentStage)
        await this.event(
          tx,
          clientId,
          current.id,
          'COLLECTION_STAGE_CHANGED',
          undefined,
          { from: current.currentStage, to: state.stage.stageCode },
        );
      if (policy.dunningEnabled && state.stage && !hold) {
        for (const actionType of (Array.isArray(state.stage.actions)
          ? state.stage.actions
          : []) as string[]) {
          if (actionType === 'AUTOPAY_RETRY' && !policy.autoPayRetryEnabled)
            continue;
          if (
            actionType === 'COMMERCIAL_RESTRICTION_REVIEW' &&
            !policy.restrictionEnabled
          )
            continue;
          const cadence = [
            'SMS',
            'WHATSAPP',
            'EMAIL',
            'PUSH_NOTIFICATION',
            'FINAL_REMINDER',
            'PROMISE_TO_PAY_REQUEST',
            'AUTOPAY_RETRY',
          ].includes(actionType)
            ? localDay(now, policy.timezone)
            : 'once';
          const key = `${current.id}:${state.stage.stageCode}:${actionType}:${cadence}`;
          const created = await tx.collectionAction.createMany({
            data: [
              {
                clientId,
                caseId: current.id,
                stageCode: state.stage.stageCode,
                actionType,
                scheduledAt: now,
                idempotencyKey: key,
              },
            ],
            skipDuplicates: true,
          });
          if (created.count)
            await this.event(
              tx,
              clientId,
              current.id,
              'COLLECTION_ACTION_SCHEDULED',
              undefined,
              { actionType, stageCode: state.stage.stageCode },
            );
        }
      }
      return current.id;
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async runQueue() {
    await this.db.collectionAction.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date(Date.now() - 15 * 60000) },
      },
      data: { status: 'PENDING' },
    });
    const rows = await this.db.collectionEvaluationQueue.findMany({
      orderBy: { requestedAt: 'asc' },
      take: 100,
    });
    let evaluated = 0;
    for (const row of rows) {
      try {
        await this.evaluate(row.clientId, row.riderId);
        await this.db.collectionEvaluationQueue.deleteMany({
          where: { id: row.id, requestedAt: row.requestedAt },
        });
        evaluated++;
      } catch (error) {
        this.logger.error(
          `Collection queue failed rider=${row.riderId}`,
          error,
        );
        await this.db.collectionEvaluationQueue.updateMany({
          where: { id: row.id, requestedAt: row.requestedAt },
          data: { requestedAt: new Date() },
        });
      }
    }
    await this.processActions(100);
    if (evaluated)
      this.logger.log(
        JSON.stringify({ event: 'COLLECTION_QUEUE_RUN', evaluated }),
      );
    return { evaluated };
  }
  @Cron(CronExpression.EVERY_HOUR)
  async runEvaluation() {
    try {
      const now = new Date();
      const unique = new Map<string, { clientId: string; riderId: string }>();
      let invoiceCursor: string | undefined;
      for (;;) {
        const page = await this.db.riderInvoice.findMany({
          where: {
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
            dueDate: { lte: new Date(now.getTime() + 86400000) },
          },
          select: { id: true, clientId: true, riderId: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(invoiceCursor ? { cursor: { id: invoiceCursor }, skip: 1 } : {}),
        });
        for (const row of page)
          unique.set(`${row.clientId}:${row.riderId}`, row);
        if (page.length < 500) break;
        invoiceCursor = page.at(-1)!.id;
      }
      let caseCursor: string | undefined;
      for (;;) {
        const page = await this.db.riderCollectionCase.findMany({
          where: { activeRiderId: { not: null } },
          select: { id: true, clientId: true, riderId: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(caseCursor ? { cursor: { id: caseCursor }, skip: 1 } : {}),
        });
        for (const row of page)
          unique.set(`${row.clientId}:${row.riderId}`, row);
        if (page.length < 500) break;
        caseCursor = page.at(-1)!.id;
      }
      for (const row of unique.values()) {
        try {
          await this.evaluate(row.clientId, row.riderId, now);
        } catch (error) {
          this.logger.error(
            `Collection evaluation failed for rider ${row.riderId}`,
            error,
          );
        }
      }
      await this.processActions(100, now);
      this.logger.log(
        JSON.stringify({
          event: 'COLLECTION_EVALUATION_RUN',
          evaluated: unique.size,
        }),
      );
      return { evaluated: unique.size };
    } catch (error) {
      this.logger.error('Collection scheduler failed', error);
      throw error;
    }
  }
  async processActions(limit = 50, now = new Date()) {
    const actions = await this.db.collectionAction.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const action of actions) {
      const claimed = await this.db.collectionAction.updateMany({
        where: { id: action.id, clientId: action.clientId, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      if (!claimed.count) continue;
      try {
        const collectionCase = await this.db.riderCollectionCase.findFirst({
          where: {
            id: action.caseId,
            clientId: action.clientId,
            activeRiderId: { not: null },
          },
        });
        if (!collectionCase) {
          await this.finishAction(action.id, 'SKIPPED', now, {
            reason: 'CASE_RESOLVED',
          });
          continue;
        }
        const policy = await this.db.collectionPolicyVersion.findUniqueOrThrow({
          where: { id: collectionCase.policyVersionId },
        });
        const fresh = await this.db.riderInvoice.findMany({
          where: {
            clientId: action.clientId,
            riderId: collectionCase.riderId,
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
            dueDate: { lte: billingDay(now, policy.timezone) },
          },
          orderBy: { dueDate: 'asc' },
        });
        if (!fresh.length) {
          await this.finishAction(action.id, 'SKIPPED', now, {
            reason: 'OUTSTANDING_BALANCE_CHANGED',
          });
          await this.evaluate(action.clientId, collectionCase.riderId, now);
          continue;
        }
        const hold =
          (await this.db.collectionDispute.findFirst({
            where: {
              clientId: action.clientId,
              caseId: action.caseId,
              status: 'OPEN',
            },
          })) ||
          (policy.promiseHoldEnabled &&
            (await this.db.promiseToPay.findFirst({
              where: { clientId: action.clientId, activeCaseId: action.caseId },
            })));
        if (hold) {
          await this.finishAction(action.id, 'SKIPPED', now, {
            reason: 'CASE_ON_HOLD',
          });
          continue;
        }
        if (
          [
            'SMS',
            'WHATSAPP',
            'EMAIL',
            'PUSH_NOTIFICATION',
            'FINAL_REMINDER',
            'PROMISE_TO_PAY_REQUEST',
          ].includes(action.actionType)
        ) {
          const localHour = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: policy.timezone,
              hour: '2-digit',
              hourCycle: 'h23',
            }).format(now),
          );
          if (
            localHour < policy.communicationStartHour ||
            localHour >= policy.communicationEndHour
          ) {
            await this.db.collectionAction.update({
              where: { id: action.id },
              data: {
                status: 'PENDING',
                scheduledAt: new Date(now.getTime() + 3600000),
              },
            });
            continue;
          }
          const dayStart = new Date(now.getTime() - 86400000);
          const sent = await this.db.collectionAction.count({
            where: {
              clientId: action.clientId,
              caseId: action.caseId,
              status: 'READY',
              executedAt: { gte: dayStart },
              actionType: {
                in: [
                  'SMS',
                  'WHATSAPP',
                  'EMAIL',
                  'PUSH_NOTIFICATION',
                  'FINAL_REMINDER',
                  'PROMISE_TO_PAY_REQUEST',
                ],
              },
            },
          });
          if (sent >= policy.maximumMessagesPerDay) {
            await this.finishAction(action.id, 'SKIPPED', now, {
              reason: 'MESSAGE_LIMIT',
            });
            continue;
          }
          const last = await this.db.collectionAction.findFirst({
            where: {
              clientId: action.clientId,
              caseId: action.caseId,
              status: 'READY',
              executedAt: {
                gte: new Date(
                  now.getTime() - policy.minimumMessageIntervalHours * 3600000,
                ),
              },
            },
          });
          if (last) {
            await this.finishAction(action.id, 'SKIPPED', now, {
              reason: 'MESSAGE_INTERVAL',
            });
            continue;
          }
          // No collection-approved SMS/WhatsApp/email/push transport is configured. READY is an app-visible reminder, not a delivery claim.
          await this.finishAction(action.id, 'READY', now, {
            templateCode:
              action.actionType === 'FINAL_REMINDER'
                ? 'PAYMENT_FINAL_REMINDER'
                : 'PAYMENT_OVERDUE_REMINDER',
            amountDue: fresh
              .reduce(
                (sum, i) => sum.plus(i.outstandingAmount),
                new Prisma.Decimal(0),
              )
              .toFixed(2),
            dueDate: fresh[0].dueDate.toISOString().slice(0, 10),
            requestedChannel: action.actionType,
            delivery: 'IN_APP_ONLY',
          });
        } else if (
          action.actionType === 'OPERATIONS_TASK' ||
          action.actionType === 'MANUAL_CALL' ||
          action.actionType === 'COMMERCIAL_RESTRICTION_REVIEW'
        ) {
          await this.db.collectionTask.upsert({
            where: { idempotencyKey: action.idempotencyKey },
            create: {
              clientId: action.clientId,
              caseId: action.caseId,
              taskType: action.actionType,
              dueAt: now,
              assignedToId: collectionCase.assignedToId,
              idempotencyKey: action.idempotencyKey,
            },
            update: {},
          });
          await this.finishAction(action.id, 'COMPLETED', now, {
            taskCreated: true,
          });
        } else if (action.actionType === 'AUTOPAY_RETRY') {
          if (!policy.autoPayRetryEnabled) {
            await this.finishAction(action.id, 'SKIPPED', now, {
              reason: 'POLICY_DISABLED',
            });
            continue;
          }
          const invoice = fresh[0];
          const paymentPolicy =
            await this.db.paymentCollectionPolicy.findUnique({
              where: { clientId: action.clientId },
            });
          const profile = await this.db.riderPaymentProfile.findUnique({
            where: {
              clientId_riderId: {
                clientId: action.clientId,
                riderId: collectionCase.riderId,
              },
            },
          });
          if (
            !paymentPolicy?.enabled ||
            !paymentPolicy.retryEnabled ||
            !profile?.autoPayEnabled
          ) {
            await this.finishAction(action.id, 'SKIPPED', now, {
              reason: 'AUTOPAY_DISABLED',
            });
            continue;
          }
          const transactions = await this.db.paymentTransaction.findMany({
            where: { clientId: action.clientId, invoiceId: invoice.id },
            orderBy: { createdAt: 'asc' },
          });
          if (
            transactions.some((t) =>
              ['CREATING', 'PENDING', 'UNKNOWN', 'SUCCESS'].includes(t.status),
            ) ||
            transactions.length >= paymentPolicy.maximumAttempts ||
            (transactions.length &&
              transactions.at(-1)?.retryability !== 'RETRYABLE')
          ) {
            await this.finishAction(action.id, 'SKIPPED', now, {
              reason: 'AUTOPAY_RETRY_GUARD',
            });
            continue;
          }
          const intervals = paymentPolicy.retryIntervalsDays as number[];
          if (
            transactions.length &&
            now.getTime() <
              transactions.at(-1)!.updatedAt.getTime() +
                (intervals[transactions.length - 1] ?? 1) * 86400000
          ) {
            await this.db.collectionAction.update({
              where: { id: action.id },
              data: {
                status: 'PENDING',
                scheduledAt: new Date(now.getTime() + 86400000),
              },
            });
            continue;
          }
          const at = new Date(now.getTime() + 86400000);
          const result = await this.orchestrator.collect(
            action.clientId,
            collectionCase.riderId,
            invoice.id,
            `collection:${action.id}`,
            at.toISOString(),
          );
          await this.finishAction(action.id, 'COMPLETED', now, {
            payment: result,
          });
        } else
          await this.finishAction(action.id, 'SKIPPED', now, {
            reason: 'ACTION_NOT_SUPPORTED',
          });
        processed++;
      } catch (error) {
        this.logger.error(`Collection action failed ${action.id}`, error);
        await this.db.$transaction(async (tx) => {
          await tx.collectionAction.update({
            where: { id: action.id },
            data: {
              status: 'FAILED',
              result: {
                error: error instanceof Error ? error.message : String(error),
              },
            },
          });
          await tx.collectionEvent.create({
            data: {
              clientId: action.clientId,
              caseId: action.caseId,
              eventType: 'COLLECTION_ACTION_FAILED',
              details: { actionId: action.id, actionType: action.actionType },
            },
          });
        });
      }
    }
    if (processed)
      this.logger.log(
        JSON.stringify({ event: 'COLLECTION_ACTION_RUN', processed }),
      );
    return { processed };
  }
  private async finishAction(
    id: string,
    status: string,
    now: Date,
    result: unknown,
  ) {
    await this.db.$transaction(async (tx) => {
      const action = await tx.collectionAction.update({
        where: { id },
        data: { status, executedAt: now, result: json(result) },
      });
      await tx.collectionEvent.create({
        data: {
          clientId: action.clientId,
          caseId: action.caseId,
          eventType:
            status === 'READY'
              ? 'REMINDER_READY'
              : `COLLECTION_ACTION_${status}`,
          details: { actionId: id, actionType: action.actionType },
        },
      });
    });
  }
  async requireCase(clientId: string, caseId: string) {
    const item = await this.db.riderCollectionCase.findFirst({
      where: { clientId, id: caseId },
      include: {
        invoices: true,
        actions: true,
        promises: true,
        notes: true,
        tasks: true,
        waivers: true,
        disputes: true,
        restrictions: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!item)
      throw new NotFoundException({ code: 'COLLECTION_CASE_NOT_FOUND' });
    const [rider, agreement, paymentAttempts, mandate] = await Promise.all([
      this.db.rider.findFirst({
        where: { clientId, id: item.riderId },
        select: { id: true, name: true, mobile: true, status: true },
      }),
      item.agreementId
        ? this.db.riderRentalAgreement.findFirst({
            where: { clientId, id: item.agreementId },
            select: {
              id: true,
              agreementNumber: true,
              status: true,
              currentVehicleId: true,
              vehicleId: true,
            },
          })
        : Promise.resolve(null),
      this.db.paymentTransaction.findMany({
        where: {
          clientId,
          riderId: item.riderId,
          invoiceId: { in: item.invoices.map((i) => i.invoiceId) },
        },
        select: {
          id: true,
          invoiceId: true,
          status: true,
          amount: true,
          scheduledAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.db.paymentMandate.findFirst({
        where: { clientId, riderId: item.riderId },
        select: { id: true, status: true, method: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { ...item, rider, agreement, paymentAttempts, mandate };
  }
  async dashboard(clientId: string, userId: string) {
    const cases = await this.db.riderCollectionCase.findMany({
      where: { clientId, activeRiderId: { not: null } },
      select: {
        daysPastDue: true,
        overdueOutstanding: true,
        currentStage: true,
        assignedToId: true,
        status: true,
      },
    });
    const buckets = [
      { code: '0_3', min: 0, max: 3 },
      { code: '4_7', min: 4, max: 7 },
      { code: '8_15', min: 8, max: 15 },
      { code: '16_30', min: 16, max: 30 },
      { code: '31_PLUS', min: 31, max: Number.MAX_SAFE_INTEGER },
    ];
    const ageing = buckets.map((b) => ({
      bucket: b.code,
      cases: cases.filter(
        (c) => c.daysPastDue >= b.min && c.daysPastDue <= b.max,
      ).length,
      outstanding: cases
        .filter((c) => c.daysPastDue >= b.min && c.daysPastDue <= b.max)
        .reduce(
          (sum, c) => sum.plus(c.overdueOutstanding),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    }));
    const [activePromises, brokenPromises, restrictedRiders] =
      await Promise.all([
        this.db.promiseToPay.count({
          where: {
            clientId,
            status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] },
          },
        }),
        this.db.promiseToPay.count({ where: { clientId, status: 'BROKEN' } }),
        this.db.commercialRestriction.findMany({
          where: { clientId, status: 'ACTIVE' },
          select: { riderId: true },
          distinct: ['riderId'],
        }),
      ]);
    return {
      openCases: cases.length,
      totalOverdue: cases
        .reduce(
          (sum, c) => sum.plus(c.overdueOutstanding),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
      byStage: Array.from(
        new Set(cases.map((c) => c.currentStage ?? 'UNSTAGED')),
      ).map((stage) => ({
        stage,
        count: cases.filter((c) => (c.currentStage ?? 'UNSTAGED') === stage)
          .length,
      })),
      ageing,
      activePromises,
      brokenPromises,
      restrictedRiders: restrictedRiders.length,
      unassignedCases: cases.filter((c) => !c.assignedToId).length,
      assignedToMe: cases.filter((c) => c.assignedToId === userId).length,
    };
  }
  async cases(
    clientId: string,
    filters: {
      status?: string;
      stage?: string;
      riderId?: string;
      agreementId?: string;
      assignedToId?: string;
      daysPastDue?: number;
      page?: number;
    },
  ) {
    const page = Math.max(1, Math.min(100000, Number(filters.page) || 1));
    const where = {
      clientId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
      ...(filters.stage ? { currentStage: filters.stage } : {}),
      ...(filters.riderId ? { riderId: filters.riderId } : {}),
      ...(filters.agreementId ? { agreementId: filters.agreementId } : {}),
      ...(filters.daysPastDue !== undefined &&
      Number.isFinite(Number(filters.daysPastDue))
        ? { daysPastDue: { gte: Math.max(0, Number(filters.daysPastDue)) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.riderCollectionCase.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 50,
        skip: (page - 1) * 50,
      }),
      this.db.riderCollectionCase.count({ where }),
    ]);
    return { items, total, page };
  }
  async promise(
    clientId: string,
    caseId: string,
    actorId: string,
    source: string,
    input: any,
  ) {
    const amount = decimal(
      input?.promisedAmount ?? 0,
      'PROMISE_AMOUNT_INVALID',
    );
    const promiseDate = new Date(`${input?.promiseDate}T00:00:00.000Z`);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2)
      throw new BadRequestException({ code: 'PROMISE_AMOUNT_INVALID' });
    return this.serializable(async (tx) => {
      const collectionCase = await tx.riderCollectionCase.findFirst({
        where: { id: caseId, clientId },
      });
      if (!collectionCase)
        throw new NotFoundException({ code: 'COLLECTION_CASE_NOT_FOUND' });
      await this.lockRider(tx, clientId, collectionCase.riderId);
      if (!collectionCase.activeRiderId)
        fail('COLLECTION_CASE_ALREADY_RESOLVED');
      const policy = await tx.collectionPolicyVersion.findUniqueOrThrow({
        where: { id: collectionCase.policyVersionId },
      });
      if (!policy.promiseToPayEnabled) fail('PROMISE_TO_PAY_NOT_ALLOWED');
      const now = new Date();
      if (
        !Number.isFinite(promiseDate.getTime()) ||
        promiseDate.toISOString().slice(0, 10) <
          localDay(now, policy.timezone) ||
        promiseDate >
          new Date(
            billingDay(now, policy.timezone).getTime() +
              policy.maximumPromiseDays * 86400000,
          )
      )
        throw new BadRequestException({ code: 'PROMISE_DATE_INVALID' });
      const due = await tx.riderInvoice.aggregate({
        where: {
          clientId,
          riderId: collectionCase.riderId,
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: 0 },
          dueDate: { lte: billingDay(now, policy.timezone) },
        },
        _sum: { outstandingAmount: true },
      });
      if (amount.gt(due._sum.outstandingAmount ?? 0))
        fail('PROMISE_AMOUNT_INVALID');
      if (await tx.promiseToPay.findFirst({ where: { activeCaseId: caseId } }))
        fail('ACTIVE_PROMISE_ALREADY_EXISTS');
      const promise = await tx.promiseToPay.create({
        data: {
          clientId,
          riderId: collectionCase.riderId,
          caseId,
          activeCaseId: caseId,
          promisedAmount: amount,
          promiseDate,
          source,
          notes: input.notes,
          createdById: actorId,
        },
      });
      await tx.riderCollectionCase.update({
        where: { id: caseId },
        data: { status: 'PROMISE_TO_PAY' },
      });
      await this.event(tx, clientId, caseId, 'PROMISE_CREATED', actorId, {
        promiseId: promise.id,
        amount: amount.toString(),
      });
      return promise;
    });
  }
  async assign(
    clientId: string,
    caseId: string,
    actorId: string,
    userId: string,
  ) {
    const user = await this.db.user.findFirst({
      where: {
        clientId,
        id: userId,
        role: { in: ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'] },
        isActive: true,
        deletedAt: null,
      },
    });
    if (!user)
      throw new BadRequestException({ code: 'INVALID_COLLECTION_ASSIGNEE' });
    const item = await this.db.riderCollectionCase.updateMany({
      where: { id: caseId, clientId, activeRiderId: { not: null } },
      data: {
        assignedToId: userId,
        assignedAt: new Date(),
        assignedById: actorId,
        status: 'IN_PROGRESS',
      },
    });
    if (!item.count) fail('COLLECTION_CASE_NOT_FOUND');
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'CASE_ASSIGNED',
        actorId,
        details: { userId },
      },
    });
    return this.requireCase(clientId, caseId);
  }
  async note(clientId: string, caseId: string, actorId: string, input: any) {
    if (
      typeof input?.note !== 'string' ||
      !input.note.trim() ||
      input.note.length > 5000 ||
      ![
        'GENERAL',
        'RIDER_CONTACTED',
        'RIDER_UNREACHABLE',
        'PAYMENT_COMMITTED',
        'DISPUTE',
        'VEHICLE_ISSUE',
        'MANUAL_REVIEW',
        'OTHER',
      ].includes(input.noteType ?? 'GENERAL')
    )
      throw new BadRequestException({ code: 'INVALID_NOTE' });
    const item = await this.requireCase(clientId, caseId);
    const note = await this.db.collectionCaseNote.create({
      data: {
        clientId,
        caseId,
        note: input.note,
        noteType: input.noteType ?? 'GENERAL',
        createdById: actorId,
      },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'NOTE_ADDED',
        actorId,
        details: { noteId: note.id },
      },
    });
    return { note, caseStatus: item.status };
  }
  async waiver(clientId: string, caseId: string, actorId: string, input: any) {
    await this.requireCase(clientId, caseId);
    if (
      !['LATE_FEE', 'COLLECTION_FEE', 'RESTRICTION', 'OTHER'].includes(
        input?.waiverType,
      ) ||
      typeof input?.reason !== 'string' ||
      !input.reason.trim()
    )
      throw new BadRequestException({ code: 'WAIVER_NOT_ALLOWED' });
    const amount = input.amount
      ? decimal(input.amount, 'WAIVER_NOT_ALLOWED')
      : null;
    if (amount && (amount.lte(0) || amount.decimalPlaces() > 2))
      throw new BadRequestException({ code: 'WAIVER_NOT_ALLOWED' });
    const waiver = await this.db.collectionWaiver.create({
      data: {
        clientId,
        caseId,
        waiverType: input.waiverType,
        reason: input.reason,
        amount,
        requestedById: actorId,
      },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'WAIVER_REQUESTED',
        actorId,
        details: { waiverId: waiver.id },
      },
    });
    return waiver;
  }
  async approveWaiver(clientId: string, waiverId: string, actorId: string) {
    const waiver = await this.db.collectionWaiver.findFirst({
      where: { clientId, id: waiverId },
    });
    if (!waiver) throw new NotFoundException({ code: 'WAIVER_NOT_FOUND' });
    if (waiver.requestedById === actorId) fail('WAIVER_APPROVAL_REQUIRED');
    if (waiver.status !== 'REQUESTED') fail('WAIVER_NOT_ALLOWED');
    const updated = await this.db.collectionWaiver.update({
      where: { id: waiverId },
      data: {
        status: 'APPROVED',
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId: waiver.caseId,
        eventType: 'WAIVER_APPROVED',
        actorId,
        details: { waiverId },
      },
    });
    return updated;
  }
  async applyWaiver(clientId: string, waiverId: string, actorId: string) {
    const waiver = await this.db.collectionWaiver.findFirst({
      where: { clientId, id: waiverId },
    });
    if (!waiver) throw new NotFoundException({ code: 'WAIVER_NOT_FOUND' });
    if (waiver.status === 'APPLIED') return waiver;
    if (waiver.status !== 'APPROVED') fail('WAIVER_APPROVAL_REQUIRED');
    const collectionCase = await this.db.riderCollectionCase.findFirst({
      where: { clientId, id: waiver.caseId },
    });
    if (!collectionCase)
      throw new NotFoundException({ code: 'COLLECTION_CASE_NOT_FOUND' });
    let creditId: string | null = null;
    if (waiver.waiverType === 'RESTRICTION') {
      await this.db.commercialRestriction.updateMany({
        where: { clientId, caseId: waiver.caseId, status: 'ACTIVE' },
        data: {
          status: 'REMOVED',
          removedAt: new Date(),
          removedById: actorId,
        },
      });
    } else {
      if (!waiver.amount || !waiver.amount.gt(0))
        throw new ConflictException({ code: 'WAIVER_NOT_ALLOWED' });
      const profile = await this.db.riderPaymentProfile.findUnique({
        where: {
          clientId_riderId: { clientId, riderId: collectionCase.riderId },
        },
      });
      const credit = await this.billing.postCredit(
        clientId,
        collectionCase.riderId,
        actorId,
        `waiver:${waiver.id}`,
        {
          creditType: `${waiver.waiverType}_WAIVER`,
          description: `Approved collection waiver ${waiver.id}`,
          amount: waiver.amount.toFixed(2),
          currency: profile?.currency ?? 'INR',
          referenceType: 'COLLECTION_WAIVER',
          referenceId: waiver.id,
        },
      );
      creditId = credit.id;
    }
    const updated = await this.db.collectionWaiver.updateMany({
      where: { id: waiver.id, clientId, status: 'APPROVED' },
      data: { status: 'APPLIED' },
    });
    if (updated.count)
      await this.db.collectionEvent.create({
        data: {
          clientId,
          caseId: waiver.caseId,
          eventType: 'WAIVER_APPLIED',
          actorId,
          details: { waiverId: waiver.id, creditId },
        },
      });
    return this.db.collectionWaiver.findUniqueOrThrow({
      where: { id: waiver.id },
    });
  }
  async dispute(
    clientId: string,
    caseId: string,
    actorId: string,
    reason: string,
  ) {
    const item = await this.requireCase(clientId, caseId);
    if (!item.activeRiderId || !reason?.trim())
      fail('COLLECTION_ACTION_NOT_ALLOWED');
    const dispute = await this.db.collectionDispute.create({
      data: { clientId, caseId, reason, createdById: actorId },
    });
    await this.db.riderCollectionCase.update({
      where: { id: caseId },
      data: { status: 'ON_HOLD' },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'DISPUTE_OPENED',
        actorId,
        details: { disputeId: dispute.id },
      },
    });
    return dispute;
  }
  async restriction(
    clientId: string,
    caseId: string,
    actorId: string,
    code: string,
    apply: boolean,
    reason: string,
  ) {
    if (
      ![
        'BLOCK_NEW_VEHICLE_ALLOCATION',
        'BLOCK_VEHICLE_EXCHANGE',
        'BLOCK_NEW_RENTAL',
        'REQUIRE_PAYMENT_BEFORE_SERVICE',
        'REQUIRE_OPERATIONS_REVIEW',
      ].includes(code) ||
      !reason?.trim() ||
      reason.length > 500
    )
      fail('RESTRICTION_NOT_ALLOWED');
    return this.serializable(async (tx) => {
      const item = await tx.riderCollectionCase.findFirst({
        where: { clientId, id: caseId, activeRiderId: { not: null } },
      });
      if (!item)
        throw new NotFoundException({ code: 'COLLECTION_CASE_NOT_FOUND' });
      await this.lockRider(tx, clientId, item.riderId);
      const policy = await tx.collectionPolicyVersion.findFirst({
        where: { clientId, id: item.policyVersionId },
      });
      if (!policy || !policy.restrictionEnabled)
        throw new ConflictException({ code: 'RESTRICTION_NOT_ALLOWED' });
      if (apply) {
        const stage = await tx.collectionPolicyStage.findFirst({
          where: {
            clientId,
            policyVersionId: policy.id,
            stageCode: item.currentStage ?? '',
            isActive: true,
          },
        });
        if (
          !stage ||
          !Array.isArray(stage.actions) ||
          !stage.actions.includes('COMMERCIAL_RESTRICTION_REVIEW')
        )
          fail('RESTRICTION_NOT_ALLOWED');
        const [current, promise, dispute] = await Promise.all([
          tx.riderInvoice.aggregate({
            where: {
              clientId,
              riderId: item.riderId,
              status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
              outstandingAmount: { gt: 0 },
              dueDate: { lte: billingDay(new Date(), policy.timezone) },
            },
            _sum: { outstandingAmount: true },
          }),
          policy.promiseHoldEnabled
            ? tx.promiseToPay.findFirst({
                where: { clientId, activeCaseId: caseId },
              })
            : Promise.resolve(null),
          tx.collectionDispute.findFirst({
            where: { clientId, caseId, status: 'OPEN' },
          }),
        ]);
        if (!current._sum.outstandingAmount?.gt(0))
          fail('OUTSTANDING_BALANCE_CHANGED');
        if (promise || dispute) fail('COLLECTION_ACTION_NOT_ALLOWED');
      }
      const restriction = await tx.commercialRestriction.upsert({
        where: { caseId_code: { caseId, code } },
        create: {
          clientId,
          riderId: item.riderId,
          caseId,
          sourceType: 'COLLECTION_CASE',
          sourceId: caseId,
          code,
          reason,
          status: apply ? 'ACTIVE' : 'RECOMMENDED',
          appliedById: apply ? actorId : undefined,
          appliedAt: apply ? new Date() : undefined,
        },
        update: {
          reason,
          status: apply ? 'ACTIVE' : 'RECOMMENDED',
          appliedById: apply ? actorId : undefined,
          appliedAt: apply ? new Date() : undefined,
        },
      });
      await this.event(
        tx,
        clientId,
        caseId,
        apply ? 'RESTRICTION_APPLIED' : 'RESTRICTION_RECOMMENDED',
        actorId,
        { code, reason },
      );
      return restriction;
    });
  }
  async removeRestriction(clientId: string, id: string, actorId: string) {
    const item = await this.db.commercialRestriction.findFirst({
      where: { clientId, id, status: 'ACTIVE' },
    });
    if (!item) throw new NotFoundException({ code: 'RESTRICTION_NOT_FOUND' });
    const result = await this.db.commercialRestriction.update({
      where: { id },
      data: { status: 'REMOVED', removedById: actorId, removedAt: new Date() },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId: item.caseId,
        eventType: 'RESTRICTION_REMOVED',
        actorId,
        details: { code: item.code },
      },
    });
    return result;
  }
  async createTask(
    clientId: string,
    caseId: string,
    actorId: string,
    input: any,
  ) {
    const item = await this.requireCase(clientId, caseId);
    if (
      !item.activeRiderId ||
      typeof input?.taskType !== 'string' ||
      !input.taskType.trim() ||
      input.taskType.length > 80
    )
      fail('COLLECTION_ACTION_NOT_ALLOWED');
    if (input.assignedToId) {
      const assignee = await this.db.user.findFirst({
        where: {
          clientId,
          id: input.assignedToId,
          isActive: true,
          deletedAt: null,
          role: { in: ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'] },
        },
      });
      if (!assignee) fail('INVALID_COLLECTION_ASSIGNEE');
    }
    const dueAt = new Date(input.dueAt);
    if (!Number.isFinite(dueAt.getTime()))
      throw new BadRequestException({ code: 'INVALID_TASK_DUE_DATE' });
    const task = await this.db.collectionTask.create({
      data: {
        clientId,
        caseId,
        taskType: input.taskType,
        assignedToId: input.assignedToId ?? item.assignedToId,
        dueAt,
      },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'TASK_CREATED',
        actorId,
        details: { taskId: task.id },
      },
    });
    return task;
  }
  async completeTask(
    clientId: string,
    taskId: string,
    actorId: string,
    result: string,
  ) {
    const task = await this.db.collectionTask.findFirst({
      where: { clientId, id: taskId },
    });
    if (!task)
      throw new NotFoundException({ code: 'COLLECTION_TASK_NOT_FOUND' });
    if (!['OPEN', 'IN_PROGRESS'].includes(task.status))
      fail('COLLECTION_ACTION_ALREADY_EXECUTED');
    const updated = await this.db.collectionTask.update({
      where: { id: taskId },
      data: { status: 'COMPLETED', completedAt: new Date(), result },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId: task.caseId,
        eventType: 'TASK_COMPLETED',
        actorId,
        details: { taskId },
      },
    });
    return updated;
  }
  async resolveDispute(
    clientId: string,
    id: string,
    actorId: string,
    resolution: string,
  ) {
    const dispute = await this.db.collectionDispute.findFirst({
      where: { clientId, id, status: 'OPEN' },
    });
    if (!dispute)
      throw new NotFoundException({ code: 'COLLECTION_DISPUTE_NOT_FOUND' });
    const updated = await this.db.collectionDispute.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId: dispute.caseId,
        eventType: 'DISPUTE_RESOLVED',
        actorId,
        details: { id, resolution },
      },
    });
    const collectionCase = await this.db.riderCollectionCase.findUniqueOrThrow({
      where: { id: dispute.caseId },
    });
    await this.evaluate(clientId, collectionCase.riderId);
    return updated;
  }
  async manualAction(
    clientId: string,
    caseId: string,
    actorId: string,
    actionType: string,
    key: string,
  ) {
    const collectionCase = await this.requireCase(clientId, caseId);
    if (
      !collectionCase.activeRiderId ||
      ![
        'SMS',
        'WHATSAPP',
        'EMAIL',
        'PUSH_NOTIFICATION',
        'AUTOPAY_RETRY',
        'MANUAL_CALL',
        'OPERATIONS_TASK',
        'PROMISE_TO_PAY_REQUEST',
        'FINAL_REMINDER',
        'COMMERCIAL_RESTRICTION_REVIEW',
      ].includes(actionType) ||
      !/^[A-Za-z0-9:_-]{8,120}$/.test(key)
    )
      fail('COLLECTION_ACTION_NOT_ALLOWED');
    const action = await this.db.collectionAction.upsert({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      create: {
        clientId,
        caseId,
        stageCode: 'MANUAL',
        actionType,
        scheduledAt: new Date(),
        idempotencyKey: key,
      },
      update: {},
    });
    if (action.caseId !== caseId || action.actionType !== actionType)
      fail('COLLECTION_ACTION_ALREADY_EXECUTED');
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'MANUAL_ACTION_REQUESTED',
        actorId,
        details: { actionId: action.id, actionType },
      },
    });
    return action;
  }
  async setLateFeePolicy(clientId: string, actorId: string, input: any) {
    if (
      !['NONE', 'FIXED', 'PER_DAY', 'PERCENTAGE', 'TIERED'].includes(
        input?.feeType,
      ) ||
      typeof input?.enabled !== 'boolean' ||
      !number(input?.minimumDaysPastDue, 0, 3650)
    )
      throw new BadRequestException({ code: 'INVALID_LATE_FEE_POLICY' });
    const amount = decimal(input.amount ?? 0, 'INVALID_LATE_FEE_POLICY');
    if (!amount.isFinite() || amount.lt(0) || amount.decimalPlaces() > 2)
      throw new BadRequestException({ code: 'INVALID_LATE_FEE_POLICY' });
    const policy = await this.db.lateFeePolicy.upsert({
      where: { clientId },
      create: {
        clientId,
        enabled: input.enabled,
        feeType: input.feeType,
        amount,
        minimumDaysPastDue: input.minimumDaysPastDue,
      },
      update: {
        enabled: input.enabled,
        feeType: input.feeType,
        amount,
        minimumDaysPastDue: input.minimumDaysPastDue,
      },
    });
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId,
        action: 'LATE_FEE_POLICY_UPDATED',
        entityType: 'LateFeePolicy',
        entityId: policy.id,
        newData: {
          enabled: policy.enabled,
          feeType: policy.feeType,
          amount: policy.amount.toString(),
        },
      },
    });
    return policy;
  }
  async lateFeePolicy(clientId: string) {
    return this.db.lateFeePolicy.findUnique({ where: { clientId } });
  }
  async applyLateFee(
    clientId: string,
    caseId: string,
    actorId: string,
    now = new Date(),
  ) {
    const collectionCase = await this.requireCase(clientId, caseId);
    if (!collectionCase.activeRiderId) fail('COLLECTION_CASE_ALREADY_RESOLVED');
    const [latePolicy, collectionPolicy, profile] = await Promise.all([
      this.db.lateFeePolicy.findUnique({ where: { clientId } }),
      this.db.collectionPolicyVersion.findFirst({
        where: { clientId, id: collectionCase.policyVersionId },
      }),
      this.db.riderPaymentProfile.findUnique({
        where: {
          clientId_riderId: { clientId, riderId: collectionCase.riderId },
        },
      }),
    ]);
    if (!latePolicy || !collectionPolicy)
      throw new ConflictException({ code: 'LATE_FEE_NOT_ALLOWED' });
    if (
      !latePolicy.enabled ||
      !collectionPolicy.lateFeeEnabled ||
      !['FIXED', 'PER_DAY', 'PERCENTAGE'].includes(latePolicy.feeType) ||
      collectionCase.daysPastDue < latePolicy.minimumDaysPastDue
    )
      fail('LATE_FEE_NOT_ALLOWED');
    const due = await this.db.riderInvoice.aggregate({
      where: {
        clientId,
        riderId: collectionCase.riderId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { lt: billingDay(now, collectionPolicy.timezone) },
        outstandingAmount: { gt: 0 },
      },
      _sum: { outstandingAmount: true },
    });
    const overdue = due._sum.outstandingAmount ?? new Prisma.Decimal(0);
    if (overdue.lte(0)) fail('OUTSTANDING_BALANCE_CHANGED');
    const amount =
      latePolicy.feeType === 'PERCENTAGE'
        ? overdue.mul(latePolicy.amount).div(100).toDecimalPlaces(2)
        : latePolicy.amount;
    if (amount.lte(0)) fail('LATE_FEE_NOT_ALLOWED');
    const date = localDay(now, collectionPolicy.timezone);
    const key = `latefee:${caseId}:${latePolicy.feeType === 'PER_DAY' ? date : 'once'}`;
    const previous = await this.db.riderCharge.findUnique({
      where: { clientId_sourceKey: { clientId, sourceKey: key } },
    });
    if (previous) return previous;
    const charge = await this.billing.postCharge(
      clientId,
      collectionCase.riderId,
      actorId,
      key,
      {
        chargeType: 'LATE_FEE',
        description: `Late fee for collection case ${collectionCase.caseNumber}`,
        quantity: '1',
        unitAmount: amount.toFixed(2),
        currency: profile?.currency ?? 'INR',
        effectiveDate: latePolicy.feeType === 'PER_DAY' ? date : undefined,
        referenceType: 'COLLECTION_CASE',
        referenceId: caseId,
      },
      overdue.toFixed(2),
    );
    await this.db.collectionEvent.create({
      data: {
        clientId,
        caseId,
        eventType: 'LATE_FEE_POSTED',
        actorId,
        details: { chargeId: charge.id, amount: amount.toFixed(2) },
      },
    });
    return charge;
  }

  async eligibility(clientId: string, riderId: string, code: string) {
    const restriction = await this.db.commercialRestriction.findFirst({
      where: { clientId, riderId, code, status: 'ACTIVE' },
    });
    return restriction
      ? {
          allowed: false,
          restrictionCode: restriction.code,
          collectionCaseId: restriction.caseId,
          reason: restriction.reason,
        }
      : { allowed: true };
  }
}
