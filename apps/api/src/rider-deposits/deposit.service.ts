import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type RiderDeposit,
  type RiderDepositTransactionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  parseSnapshot,
  pricingHash,
} from '../rider-rate-cards/commercial-snapshot.js';
import {
  decimalString,
  depositBalances,
  money,
  positiveMoney,
  reconcileDeposit,
  ZERO,
} from './deposit-money.js';

type Tx = Prisma.TransactionClient;
const request = z
  .object({
    amount: z.string(),
    reason: z.string().min(1).max(500),
    reasonCode: z.string().max(80).optional(),
    referenceType: z.string().max(80).optional(),
    referenceId: z.string().max(120).optional(),
    externalReference: z.string().max(160).optional(),
    paymentMethod: z.string().max(80).optional(),
  })
  .strict();
const transferRequest = request.extend({
  sourceDepositId: z.string().uuid(),
  targetDepositId: z.string().uuid(),
});
const reasonRequest = z.object({ reason: z.string().min(1).max(500) }).strict();
const policyRequest = z.discriminatedUnion('policy', [
  z.object({ policy: z.literal('FULL_REQUIRED') }).strict(),
  z.object({ policy: z.literal('WAIVER_ALLOWED') }).strict(),
  z.object({ policy: z.literal('NOT_REQUIRED_BEFORE_ACTIVATION') }).strict(),
  z
    .object({ policy: z.literal('MINIMUM_AMOUNT'), threshold: z.string() })
    .strict(),
  z
    .object({ policy: z.literal('MINIMUM_PERCENTAGE'), threshold: z.string() })
    .strict(),
]);
const fail = (code: string): never => {
  throw new ConflictException({ code });
};
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
const requiredKey = (key?: string) => {
  if (!key || key.length > 200)
    throw new BadRequestException(
      'Idempotency-Key is required (maximum 200 characters)',
    );
  return key;
};
const lineSchema = z
  .object({
    type: z.string().min(1).max(80),
    code: z.string().min(1).max(80),
    ruleId: z.string().min(1),
    originalRequired: z.string(),
    adjustedRequired: z.string(),
    waiverAmount: z.string(),
    finalRequired: z.string(),
  })
  .passthrough();

@Injectable()
export class RiderDepositService {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
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
  private audit(
    tx: Tx,
    clientId: string,
    actorId: string,
    action: string,
    entityId: string,
    details: Record<string, string>,
  ) {
    return tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action,
        entityType: 'RiderDeposit',
        entityId,
        newData: details,
      },
    });
  }
  async setActivationPolicy(clientId: string, actorId: string, raw: unknown) {
    const input = parse(policyRequest, raw);
    const threshold =
      'threshold' in input ? money(input.threshold, 'threshold') : null;
    if (input.policy === 'MINIMUM_PERCENTAGE' && threshold!.gt(100))
      throw new BadRequestException('Percentage must not exceed 100');
    return this.serializable(async (tx) => {
      const client = await tx.client.update({
        where: { id: clientId },
        data: {
          depositActivationPolicy: input.policy,
          depositActivationThreshold: threshold,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_ACTIVATION_POLICY_CHANGED',
        clientId,
        {
          policy: input.policy,
          threshold: threshold ? decimalString(threshold) : '',
        },
      );
      return {
        policy: client.depositActivationPolicy,
        threshold: client.depositActivationThreshold,
      };
    });
  }
  private async locked(tx: Tx, clientId: string, id: string, riderId?: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "RiderDeposit" WHERE "id" = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
    if (!rows.length)
      throw new NotFoundException({ code: 'DEPOSIT_NOT_FOUND' });
    const deposit = await tx.riderDeposit.findFirst({
      where: { clientId, id, ...(riderId ? { riderId } : {}) },
    });
    if (!deposit) throw new NotFoundException({ code: 'DEPOSIT_NOT_FOUND' });
    return deposit;
  }
  private status(
    deposit: RiderDeposit,
    available: Prisma.Decimal,
    funded: Prisma.Decimal,
    type: RiderDepositTransactionType,
  ) {
    if (type === 'REFUND' && available.eq(0)) return 'REFUNDED' as const;
    if (type === 'FORFEITURE' && available.eq(0)) return 'FORFEITED' as const;
    if (type === 'REFUND') return 'PARTIALLY_REFUNDED' as const;
    if (available.eq(0) && funded.eq(0)) return 'REQUIRED' as const;
    if (funded.lt(deposit.requiredAmount))
      return 'PARTIALLY_COLLECTED' as const;
    return 'HELD' as const;
  }
  private async post(
    tx: Tx,
    deposit: RiderDeposit,
    actorId: string,
    input: z.infer<typeof request>,
    key: string,
    type: RiderDepositTransactionType,
    delta: Prisma.Decimal,
    fundingDelta: Prisma.Decimal,
    extra?: { transferReferenceId?: string; reversalOfTransactionId?: string },
  ) {
    const amount = positiveMoney(input.amount);
    const after = deposit.availableAmount.plus(delta);
    const funded = deposit.fundedAmount.plus(fundingDelta);
    if (after.lt(0) || funded.lt(0))
      fail('DEPOSIT_INSUFFICIENT_AVAILABLE_BALANCE');
    const transaction = await tx.riderDepositTransaction.create({
      data: {
        clientId: deposit.clientId,
        depositId: deposit.id,
        riderId: deposit.riderId,
        agreementId: deposit.agreementId,
        vehicleId: deposit.vehicleId,
        transactionType: type,
        amount,
        balanceDelta: delta,
        fundingDelta,
        balanceBefore: deposit.availableAmount,
        balanceAfter: after,
        currency: deposit.currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: input.reasonCode,
        reason: input.reason,
        externalReference: input.externalReference,
        paymentMethod: input.paymentMethod,
        idempotencyKey: key,
        createdById: actorId,
        ...extra,
      },
    });
    await tx.riderDeposit.update({
      where: { id: deposit.id },
      data: {
        availableAmount: after,
        fundedAmount: funded,
        status: this.status(deposit, after, funded, type),
        updatedById: actorId,
      },
    });
    if (!delta.eq(0))
      await tx.riderLedgerEntry.create({
        data: {
          clientId: deposit.clientId,
          riderId: deposit.riderId,
          agreementId: deposit.agreementId,
          vehicleId: deposit.vehicleId,
          category: 'REFUNDABLE_DEPOSIT_LIABILITY',
          entryType: type === 'REVERSAL' ? 'REVERSAL' : 'ADJUSTMENT',
          sourceType: 'RIDER_DEPOSIT_TRANSACTION',
          sourceId: transaction.id,
          description: `${type}: ${deposit.depositType}`,
          debitAmount: delta.lt(0) ? delta.abs() : ZERO,
          creditAmount: delta.gt(0) ? delta : ZERO,
          currency: deposit.currency,
        },
      });
    await this.audit(
      tx,
      deposit.clientId,
      actorId,
      `DEPOSIT_${type}_RECORDED`,
      deposit.id,
      {
        transactionId: transaction.id,
        amount: decimalString(amount),
        balanceAfter: decimalString(after),
      },
    );
    return transaction;
  }

  async initializeAgreement(
    clientId: string,
    actorId: string,
    agreementId: string,
  ) {
    return this.serializable(async (tx) => {
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { clientId, id: agreementId },
      });
      if (!agreement)
        throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
      return this.initializeInTransaction(tx, agreement, actorId);
    });
  }

  async initializeInTransaction(
    tx: Tx,
    agreement: {
      id: string;
      clientId: string;
      riderId: string;
      vehicleId: string;
      currency: string;
      pricingSnapshot: Prisma.JsonValue;
      pricingSnapshotSchemaVersion: number;
      pricingHash: string;
      termsHash: string;
      termsVersion: string;
    },
    actorId: string,
    amendmentId?: string,
    skipRiderSecurity = false,
  ) {
    const { clientId } = agreement;
    const agreementId = agreement.id;
    const snapshot = parseSnapshot(
      agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    if (
      pricingHash(
        clientId,
        snapshot,
        agreement.termsHash,
        agreement.termsVersion,
      ) !== agreement.pricingHash
    )
      fail('AGREEMENT_DEPOSIT_SNAPSHOT_INVALID');
    const lines = z.array(lineSchema).safeParse(snapshot.deposits);
    if (!lines.success)
      throw new ConflictException({
        code: 'AGREEMENT_DEPOSIT_SNAPSHOT_INVALID',
      });
    const result = [];
    for (const [index, line] of lines.data.entries()) {
      if (skipRiderSecurity && line.type === 'RIDER_SECURITY') continue;
      const original = money(line.originalRequired, 'originalRequired');
      const adjusted = money(line.adjustedRequired, 'adjustedRequired');
      const waiver = money(line.waiverAmount, 'waiverAmount');
      const required = money(line.finalRequired, 'finalRequired');
      if (waiver.gt(adjusted) || !adjusted.minus(waiver).eq(required))
        fail('AGREEMENT_DEPOSIT_SNAPSHOT_INVALID');
      const obligationKey = `${amendmentId ? `${amendmentId}:` : ''}${index}:${line.ruleId}:${line.code}`;
      const existing = await tx.riderDeposit.findUnique({
        where: {
          clientId_agreementId_obligationKey: {
            clientId,
            agreementId,
            obligationKey,
          },
        },
      });
      if (existing) {
        result.push(existing);
        continue;
      }
      const created = await tx.riderDeposit.create({
        data: {
          clientId,
          riderId: agreement.riderId,
          agreementId,
          vehicleId:
            line.type === 'RIDER_SECURITY' ? null : agreement.vehicleId,
          obligationKey,
          depositType: line.type,
          code: line.code,
          currency: agreement.currency,
          originalRequiredAmount: original,
          waiverAmount: waiver,
          requiredAmount: required,
          sourceType: amendmentId ? 'AGREEMENT_AMENDMENT' : 'RENTAL_AGREEMENT',
          sourceId: amendmentId ?? agreementId,
          snapshotLine: line as Prisma.InputJsonValue,
          createdById: actorId,
        },
      });
      if (waiver.gt(0))
        await tx.riderDepositTransaction.create({
          data: {
            clientId,
            depositId: created.id,
            riderId: created.riderId,
            agreementId,
            vehicleId: created.vehicleId,
            transactionType: 'WAIVER',
            amount: waiver,
            balanceDelta: ZERO,
            fundingDelta: ZERO,
            balanceBefore: ZERO,
            balanceAfter: ZERO,
            currency: agreement.currency,
            reason: 'Accepted agreement deposit waiver',
            createdById: actorId,
          },
        });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_INITIALIZED',
        created.id,
        {
          agreementId,
          requiredAmount: decimalString(required),
          waiverAmount: decimalString(waiver),
        },
      );
      result.push(created);
    }
    return result;
  }

  async move(
    clientId: string,
    actorId: string,
    id: string,
    raw: unknown,
    idempotencyKey: string | undefined,
    type:
      | 'COLLECTION'
      | 'DEDUCTION'
      | 'REFUND'
      | 'ADJUSTMENT_CREDIT'
      | 'ADJUSTMENT_DEBIT'
      | 'FORFEITURE',
  ) {
    const input = parse(request, raw);
    const key = requiredKey(idempotencyKey);
    const amount = positiveMoney(input.amount);
    return this.serializable(async (tx) => {
      const deposit = await this.locked(tx, clientId, id);
      const previous = await tx.riderDepositTransaction.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (previous) {
        if (
          previous.depositId !== id ||
          previous.transactionType !== type ||
          !previous.amount.eq(amount) ||
          previous.reason !== input.reason
        )
          fail('DUPLICATE_DEPOSIT_OPERATION');
        return previous;
      }
      if (deposit.status === 'CLOSED') fail('DEPOSIT_ALREADY_CLOSED');
      if (
        type === 'COLLECTION' &&
        amount.gt(
          Prisma.Decimal.max(
            ZERO,
            deposit.depositType === 'RIDER_SECURITY'
              ? deposit.requiredAmount.minus(deposit.availableAmount)
              : deposit.requiredAmount.minus(deposit.fundedAmount),
          ),
        )
      )
        fail('DEPOSIT_COLLECTION_EXCEEDS_OUTSTANDING');
      if (
        type === 'REFUND' ||
        type === 'DEDUCTION' ||
        type === 'ADJUSTMENT_DEBIT' ||
        type === 'FORFEITURE'
      ) {
        const holds = await tx.settlementDepositHold.aggregate({
          where: { clientId, depositId: id, status: 'ACTIVE' },
          _sum: { amount: true },
        });
        const pendingRefunds = await tx.riderDepositRefundRequest.aggregate({
          where: { clientId, depositId: id, status: 'REQUESTED' },
          _sum: { amount: true },
        });
        if (
          amount.gt(
            deposit.availableAmount
              .minus(holds._sum.amount ?? ZERO)
              .minus(pendingRefunds._sum.amount ?? ZERO),
          )
        )
          fail(
            type === 'REFUND'
              ? 'DEPOSIT_REFUND_EXCEEDS_AVAILABLE'
              : 'DEPOSIT_DEDUCTION_EXCEEDS_AVAILABLE',
          );
      }
      if (
        (type === 'DEDUCTION' || type === 'FORFEITURE') &&
        !input.referenceType &&
        !input.referenceId
      )
        fail('DEPOSIT_REFERENCE_REQUIRED');
      const delta = ['COLLECTION', 'ADJUSTMENT_CREDIT'].includes(type)
        ? amount
        : amount.negated();
      const funding =
        type === 'COLLECTION' || type === 'ADJUSTMENT_CREDIT'
          ? amount
          : type === 'REFUND' || type === 'FORFEITURE'
            ? amount.negated()
            : ZERO;
      return this.post(tx, deposit, actorId, input, key, type, delta, funding);
    });
  }

  async confirmProviderCollectionInTransaction(
    tx: Tx,
    clientId: string,
    riderId: string,
    depositId: string,
    amount: Prisma.Decimal,
    providerPaymentId: string,
    collectionId: string,
  ) {
    const deposit = await this.locked(tx, clientId, depositId, riderId);
    if (deposit.status === 'CLOSED' || deposit.currency !== 'INR') return null;
    const outstanding = Prisma.Decimal.max(
      ZERO,
      deposit.depositType === 'RIDER_SECURITY'
        ? deposit.requiredAmount.minus(deposit.availableAmount)
        : deposit.requiredAmount.minus(deposit.fundedAmount),
    );
    if (amount.gt(outstanding)) return null;
    const key = `provider-deposit:${collectionId}`;
    const previous = await tx.riderDepositTransaction.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
    });
    if (previous) return previous;
    return this.post(
      tx,
      deposit,
      'SYSTEM',
      {
        amount: amount.toFixed(2),
        reason: 'Provider deposit collection',
        reasonCode: 'PROVIDER_COLLECTION',
        referenceType: 'PAYMENT_COLLECTION',
        referenceId: collectionId,
        externalReference: providerPaymentId,
        paymentMethod: 'UPI',
      },
      key,
      'COLLECTION',
      amount,
      amount,
    );
  }

  async transfer(
    clientId: string,
    actorId: string,
    raw: unknown,
    idempotencyKey?: string,
  ) {
    const input = parse(transferRequest, raw);
    const key = requiredKey(idempotencyKey);
    if (key.length > 196)
      throw new BadRequestException('Idempotency key is too long for transfer');
    if (input.sourceDepositId === input.targetDepositId)
      fail('DEPOSIT_TRANSFER_SAME_SOURCE_TARGET');
    const amount = positiveMoney(input.amount);
    return this.serializable(async (tx) => {
      const [first, second] = [
        input.sourceDepositId,
        input.targetDepositId,
      ].sort();
      const a = await this.locked(tx, clientId, first);
      const b = await this.locked(tx, clientId, second);
      const source = a.id === input.sourceDepositId ? a : b;
      const target = b.id === input.targetDepositId ? b : a;
      const previous = await tx.riderDepositTransaction.findUnique({
        where: {
          clientId_idempotencyKey: { clientId, idempotencyKey: `${key}:out` },
        },
      });
      if (previous) {
        if (
          previous.depositId !== source.id ||
          !previous.amount.eq(amount) ||
          previous.transactionType !== 'TRANSFER_OUT'
        )
          fail('DUPLICATE_DEPOSIT_OPERATION');
        const paired = await tx.riderDepositTransaction.findUnique({
          where: {
            clientId_idempotencyKey: { clientId, idempotencyKey: `${key}:in` },
          },
        });
        if (
          !paired ||
          paired.depositId !== target.id ||
          paired.transferReferenceId !== previous.transferReferenceId
        )
          fail('DEPOSIT_BALANCE_RECONCILIATION_FAILED');
        return { out: previous, in: paired };
      }
      if (
        source.riderId !== target.riderId ||
        source.currency !== target.currency
      )
        fail('DEPOSIT_TRANSFER_SCOPE_MISMATCH');
      if (source.status === 'CLOSED' || target.status === 'CLOSED')
        fail('DEPOSIT_ALREADY_CLOSED');
      if (amount.gt(source.availableAmount))
        fail('DEPOSIT_TRANSFER_EXCEEDS_AVAILABLE');
      if (
        amount.gt(
          Prisma.Decimal.max(
            ZERO,
            target.requiredAmount.minus(target.fundedAmount),
          ),
        )
      )
        fail('DEPOSIT_TRANSFER_EXCEEDS_TARGET_REQUIREMENT');
      const transferReferenceId = randomUUID();
      const out = await this.post(
        tx,
        source,
        actorId,
        input,
        `${key}:out`,
        'TRANSFER_OUT',
        amount.negated(),
        amount.negated(),
        { transferReferenceId },
      );
      const into = await this.post(
        tx,
        target,
        actorId,
        input,
        `${key}:in`,
        'TRANSFER_IN',
        amount,
        amount,
        { transferReferenceId },
      );
      return { out, in: into };
    });
  }

  async reverse(
    clientId: string,
    actorId: string,
    transactionId: string,
    raw: unknown,
    idempotencyKey?: string,
  ) {
    const input = parse(reasonRequest, raw);
    const key = requiredKey(idempotencyKey);
    return this.serializable(async (tx) => {
      const original = await tx.riderDepositTransaction.findFirst({
        where: { clientId, id: transactionId },
      });
      if (!original)
        throw new NotFoundException({ code: 'DEPOSIT_TRANSACTION_NOT_FOUND' });
      const deposit = await this.locked(tx, clientId, original.depositId);
      const existing = await tx.riderDepositTransaction.findUnique({
        where: { reversalOfTransactionId: transactionId },
      });
      if (existing) {
        if (existing.idempotencyKey === key) return existing;
        fail('DEPOSIT_TRANSACTION_ALREADY_REVERSED');
      }
      if (
        original.transactionType === 'REVERSAL' ||
        original.transactionType === 'WAIVER' ||
        original.transactionType === 'TRANSFER_IN' ||
        original.transactionType === 'TRANSFER_OUT'
      )
        fail('DEPOSIT_TRANSACTION_NOT_REVERSIBLE');
      if (
        deposit.availableAmount.minus(original.balanceDelta).lt(0) ||
        deposit.fundedAmount.minus(original.fundingDelta).lt(0)
      )
        fail('DEPOSIT_REVERSAL_WOULD_OVERDRAW');
      return this.post(
        tx,
        deposit,
        actorId,
        {
          amount: decimalString(original.amount),
          reason: input.reason,
          referenceType: 'DEPOSIT_TRANSACTION',
          referenceId: original.id,
        },
        key,
        'REVERSAL',
        original.balanceDelta.negated(),
        original.fundingDelta.negated(),
        { reversalOfTransactionId: original.id },
      );
    });
  }

  async requestRefund(
    clientId: string,
    actorId: string,
    depositId: string,
    raw: unknown,
    idempotencyKey?: string,
  ) {
    const input = parse(request, raw);
    const key = requiredKey(idempotencyKey);
    const amount = positiveMoney(input.amount);
    return this.serializable(async (tx) => {
      const deposit = await this.locked(tx, clientId, depositId);
      const previous = await tx.riderDepositRefundRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (previous) {
        if (previous.depositId !== depositId || !previous.amount.eq(amount))
          fail('DUPLICATE_DEPOSIT_OPERATION');
        return previous;
      }
      const pending = await tx.riderDepositRefundRequest.aggregate({
        where: { clientId, depositId, status: 'REQUESTED' },
        _sum: { amount: true },
      });
      const holds = await tx.settlementDepositHold.aggregate({
        where: { clientId, depositId, status: 'ACTIVE' },
        _sum: { amount: true },
      });
      if (
        amount
          .plus(pending._sum.amount ?? ZERO)
          .plus(holds._sum.amount ?? ZERO)
          .gt(deposit.availableAmount)
      )
        fail('DEPOSIT_REFUND_EXCEEDS_AVAILABLE');
      const result = await tx.riderDepositRefundRequest.create({
        data: {
          clientId,
          depositId,
          amount,
          reason: input.reason,
          idempotencyKey: key,
          requestedById: actorId,
          externalReference: input.externalReference,
        },
      });
      await tx.riderDeposit.update({
        where: { id: depositId },
        data: { status: 'REFUND_PENDING', updatedById: actorId },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'DEPOSIT_REFUND_REQUESTED',
        depositId,
        { refundRequestId: result.id, amount: decimalString(amount) },
      );
      return result;
    });
  }

  async completeRefund(
    clientId: string,
    actorId: string,
    refundRequestId: string,
    externalReference: string,
  ) {
    if (!externalReference || externalReference.length > 160)
      throw new BadRequestException('Confirmed payout reference is required');
    return this.serializable(async (tx) => {
      const requestRow = await tx.riderDepositRefundRequest.findFirst({
        where: { clientId, id: refundRequestId },
      });
      if (!requestRow)
        throw new NotFoundException({ code: 'DEPOSIT_REFUND_NOT_FOUND' });
      const deposit = await this.locked(tx, clientId, requestRow.depositId);
      if (requestRow.status === 'COMPLETED') {
        if (requestRow.externalReference !== externalReference)
          fail('DUPLICATE_DEPOSIT_OPERATION');
        return tx.riderDepositTransaction.findUniqueOrThrow({
          where: {
            clientId_idempotencyKey: {
              clientId,
              idempotencyKey: `refund:${refundRequestId}`,
            },
          },
        });
      }
      if (requestRow.status !== 'REQUESTED') fail('DEPOSIT_REFUND_NOT_PENDING');
      if (requestRow.amount.gt(deposit.availableAmount))
        fail('DEPOSIT_REFUND_EXCEEDS_AVAILABLE');
      const transaction = await this.post(
        tx,
        deposit,
        actorId,
        {
          amount: decimalString(requestRow.amount),
          reason: requestRow.reason,
          referenceType: 'DEPOSIT_REFUND_REQUEST',
          referenceId: refundRequestId,
          externalReference,
        },
        `refund:${refundRequestId}`,
        'REFUND',
        requestRow.amount.negated(),
        requestRow.amount.negated(),
      );
      await tx.riderDepositRefundRequest.update({
        where: { id: refundRequestId },
        data: {
          status: 'COMPLETED',
          externalReference,
          completedById: actorId,
          completedAt: new Date(),
        },
      });
      return transaction;
    });
  }

  async get(clientId: string, id: string, riderId?: string) {
    const row = await this.prisma.riderDeposit.findFirst({
      where: { clientId, id, ...(riderId ? { riderId } : {}) },
    });
    if (!row) throw new NotFoundException({ code: 'DEPOSIT_NOT_FOUND' });
    return row;
  }
  listForAgreement(clientId: string, agreementId: string, riderId?: string) {
    return this.prisma.riderDeposit.findMany({
      where: { clientId, agreementId, ...(riderId ? { riderId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }
  listForRider(clientId: string, riderId: string) {
    return this.prisma.riderDeposit.findMany({
      where: { clientId, riderId },
      orderBy: { createdAt: 'desc' },
    });
  }
  transactions(clientId: string, depositId: string, riderId?: string) {
    return this.get(clientId, depositId, riderId).then(() =>
      this.prisma.riderDepositTransaction.findMany({
        where: { clientId, depositId },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
  async reconcile(clientId: string, depositId: string) {
    const deposit = await this.get(clientId, depositId);
    const rows = await this.prisma.riderDepositTransaction.findMany({
      where: { clientId, depositId },
    });
    const balances = reconcileDeposit(deposit, rows);
    const movements = rows.filter((row) => !row.balanceDelta.eq(0));
    const ledger = await this.prisma.riderLedgerEntry.findMany({
      where: {
        clientId,
        category: 'REFUNDABLE_DEPOSIT_LIABILITY',
        sourceType: 'RIDER_DEPOSIT_TRANSACTION',
        sourceId: { in: movements.map((row) => row.id) },
      },
    });
    if (
      ledger.length !== movements.length ||
      movements.some((row) => {
        const linked = ledger.find((entry) => entry.sourceId === row.id);
        return (
          !linked ||
          !linked.creditAmount.minus(linked.debitAmount).eq(row.balanceDelta) ||
          linked.currency !== row.currency ||
          linked.riderId !== row.riderId
        );
      })
    )
      fail('DEPOSIT_LEDGER_RECONCILIATION_FAILED');
    return balances;
  }
  async agreementSummary(
    clientId: string,
    agreementId: string,
    riderId?: string,
  ) {
    const agreement = await this.prisma.riderRentalAgreement.findFirst({
      where: { clientId, id: agreementId, ...(riderId ? { riderId } : {}) },
    });
    if (!agreement)
      throw new NotFoundException({ code: 'AGREEMENT_NOT_FOUND' });
    const allDeposits = await this.listForAgreement(
      clientId,
      agreementId,
      riderId,
    );
    const version =
      agreement.currentCommercialVersionNumber > 1
        ? await this.prisma.riderAgreementCommercialVersion.findUnique({
            where: {
              agreementId_versionNumber: {
                agreementId,
                versionNumber: agreement.currentCommercialVersionNumber,
              },
            },
          })
        : null;
    if (agreement.currentCommercialVersionNumber > 1 && !version?.amendmentId)
      fail('AGREEMENT_COMMERCIAL_VERSION_MISSING');
    const deposits = version?.amendmentId
      ? allDeposits.filter(
          (item) =>
            item.sourceId === version.amendmentId ||
            item.depositType === 'RIDER_SECURITY',
        )
      : allDeposits.filter((item) => item.sourceType !== 'AGREEMENT_AMENDMENT');
    const accepted = parseSnapshot(
      version?.pricingSnapshot ?? agreement.pricingSnapshot,
      agreement.pricingSnapshotSchemaVersion,
    );
    const expected = Array.isArray(accepted.deposits)
      ? (accepted.deposits as { type?: string }[]).filter(
          (line) => !version || line.type !== 'RIDER_SECURITY',
        ).length +
        (version
          ? deposits.filter((item) => item.depositType === 'RIDER_SECURITY')
              .length
          : 0)
      : -1;
    if (!Array.isArray(accepted.deposits) || deposits.length !== expected)
      fail('AGREEMENT_DEPOSITS_NOT_INITIALIZED');
    const required = deposits.reduce(
      (sum, item) => sum.plus(item.requiredAmount),
      ZERO,
    );
    const funded = deposits.reduce(
      (sum, item) => sum.plus(item.fundedAmount),
      ZERO,
    );
    const available = deposits.reduce(
      (sum, item) => sum.plus(item.availableAmount),
      ZERO,
    );
    const pending = await this.prisma.riderDepositRefundRequest.aggregate({
      where: {
        clientId,
        depositId: { in: deposits.map((item) => item.id) },
        status: 'REQUESTED',
      },
      _sum: { amount: true },
    });
    return {
      agreementId,
      deposits: deposits.map((item) => ({
        ...item,
        balances: depositBalances(item),
      })),
      historicalDeposits: allDeposits.filter(
        (item) => !deposits.some((active) => active.id === item.id),
      ),
      totalRequired: decimalString(required),
      totalFunded: decimalString(funded),
      totalAvailable: decimalString(available),
      totalOutstanding: decimalString(
        Prisma.Decimal.max(ZERO, required.minus(funded)),
      ),
      pendingRefund: decimalString(pending._sum.amount ?? ZERO),
    };
  }
  async readiness(clientId: string, agreementId: string) {
    const summary = await this.agreementSummary(clientId, agreementId);
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: {
        depositActivationPolicy: true,
        depositActivationThreshold: true,
      },
    });
    const required = new Prisma.Decimal(summary.totalRequired);
    const held = Prisma.Decimal.max(
      ZERO,
      new Prisma.Decimal(summary.totalAvailable).minus(summary.pendingRefund),
    );
    const threshold = client.depositActivationThreshold ?? ZERO;
    const satisfied =
      client.depositActivationPolicy === 'NOT_REQUIRED_BEFORE_ACTIVATION' ||
      (client.depositActivationPolicy === 'MINIMUM_AMOUNT' &&
        held.gte(Prisma.Decimal.min(required, threshold))) ||
      (client.depositActivationPolicy === 'MINIMUM_PERCENTAGE' &&
        held.gte(required.mul(threshold).div(100))) ||
      ((client.depositActivationPolicy === 'FULL_REQUIRED' ||
        client.depositActivationPolicy === 'WAIVER_ALLOWED') &&
        held.gte(required));
    return {
      ...summary,
      policy: client.depositActivationPolicy,
      threshold: decimalString(threshold),
      satisfied,
    };
  }
  async settlement(clientId: string, agreementId: string) {
    const summary = await this.agreementSummary(clientId, agreementId);
    const settlementTransactions =
      await this.prisma.riderDepositTransaction.findMany({
        where: {
          clientId,
          agreementId,
          transactionType: { in: ['DEDUCTION', 'FORFEITURE', 'REVERSAL'] },
        },
        orderBy: { createdAt: 'asc' },
      });
    const reversed = new Set(
      settlementTransactions
        .map((item) => item.reversalOfTransactionId)
        .filter(Boolean),
    );
    const deductions = settlementTransactions.filter(
      (item) =>
        (item.transactionType === 'DEDUCTION' ||
          item.transactionType === 'FORFEITURE') &&
        !reversed.has(item.id),
    );
    const totalDeductions = deductions.reduce(
      (sum, item) => sum.plus(item.amount),
      ZERO,
    );
    return {
      agreementId,
      totalHeld: summary.totalAvailable,
      totalDeductions: decimalString(totalDeductions),
      deductions: deductions.map((item) => ({
        transactionId: item.id,
        depositId: item.depositId,
        amount: decimalString(item.amount),
        reason: item.reason,
        reasonCode: item.reasonCode,
        referenceType: item.referenceType,
        referenceId: item.referenceId,
      })),
      refundDue: summary.totalAvailable,
      pendingRefund: summary.pendingRefund,
      readyToClose:
        new Prisma.Decimal(summary.totalAvailable).eq(0) &&
        new Prisma.Decimal(summary.pendingRefund).eq(0),
      deposits: summary.deposits.map((item) => ({
        depositId: item.id,
        type: item.depositType,
        available: item.balances.available,
      })),
    };
  }
  async close(
    clientId: string,
    actorId: string,
    depositId: string,
    raw: unknown,
  ) {
    const input = parse(reasonRequest, raw);
    return this.serializable(async (tx) => {
      const deposit = await this.locked(tx, clientId, depositId);
      if (deposit.status === 'CLOSED') return deposit;
      if (!deposit.availableAmount.eq(0)) fail('DEPOSIT_SETTLEMENT_INCOMPLETE');
      const pending = await tx.riderDepositRefundRequest.count({
        where: { clientId, depositId, status: 'REQUESTED' },
      });
      if (pending) fail('DEPOSIT_REFUND_PENDING');
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { clientId, id: deposit.agreementId },
      });
      if (
        !agreement ||
        !['TERMINATED', 'COMPLETED', 'CANCELLED'].includes(agreement.status)
      )
        fail('AGREEMENT_NOT_READY_FOR_DEPOSIT_CLOSE');
      const result = await tx.riderDeposit.update({
        where: { id: depositId },
        data: { status: 'CLOSED', updatedById: actorId },
      });
      await this.audit(tx, clientId, actorId, 'DEPOSIT_CLOSED', depositId, {
        reason: input.reason,
      });
      return result;
    });
  }
  async riderCommercialSummary(clientId: string, riderId: string) {
    const deposits = await this.listForRider(clientId, riderId);
    const held = deposits.reduce(
      (sum, item) => sum.plus(item.availableAmount),
      ZERO,
    );
    const outstanding = deposits.reduce(
      (sum, item) =>
        sum.plus(
          Prisma.Decimal.max(
            ZERO,
            item.requiredAmount.minus(item.fundedAmount),
          ),
        ),
      ZERO,
    );
    const ledger = await this.prisma.riderLedgerEntry.findMany({
      where: { clientId, riderId, category: 'CHARGE_BALANCE' },
    });
    const charges = ledger.reduce(
      (sum, item) => sum.plus(item.debitAmount).minus(item.creditAmount),
      ZERO,
    );
    return {
      outstandingCharges: decimalString(Prisma.Decimal.max(ZERO, charges)),
      refundableDepositsHeld: decimalString(held),
      pendingDepositRequirement: decimalString(outstanding),
    };
  }
}
