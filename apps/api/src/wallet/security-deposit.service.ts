import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WalletDepositStatus,
  WalletTransactionType,
  type WalletSecurityDeposit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { money, WalletService } from './wallet.service.js';
import { WalletPolicyService } from './wallet-policy.service.js';

type Tx = Prisma.TransactionClient;
const zero = new Prisma.Decimal(0);
const nonnegative = (value: string) => (value === '0.00' ? zero : money(value));

export function depositAccounting(
  required: Prisma.Decimal,
  entries: {
    type: string | undefined;
    entryType: 'CREDIT' | 'DEBIT';
    amount: Prisma.Decimal;
  }[],
  held: Prisma.Decimal,
) {
  let funded = zero,
    deducted = zero,
    refunded = zero;
  for (const entry of entries) {
    const signed =
      entry.entryType === 'CREDIT' ? entry.amount : entry.amount.neg();
    if (entry.type === 'SECURITY_DEPOSIT') funded = funded.plus(signed);
    if (
      entry.type === 'SECURITY_DEPOSIT_DEDUCTION' ||
      entry.type === 'SECURITY_DEPOSIT_FORFEITURE'
    )
      deducted = deducted.minus(signed);
    if (entry.type === 'SECURITY_DEPOSIT_REFUND')
      refunded = refunded.minus(signed);
  }
  const balance = funded.minus(deducted).minus(refunded);
  return {
    funded,
    deducted,
    refunded,
    balance,
    held,
    outstanding: Prisma.Decimal.max(required.minus(funded), 0),
    refundable: Prisma.Decimal.max(balance.minus(held), 0),
  };
}

@Injectable()
export class SecurityDepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly policies: WalletPolicyService,
  ) {}
  private async account(tx: Tx, deposit: WalletSecurityDeposit) {
    const accounts = await tx.walletAccount.findMany({
      where: { clientId: deposit.clientId, walletId: deposit.walletId },
    });
    const target = accounts.find((a) => a.accountType === 'SECURITY_DEPOSIT');
    const clearing = accounts.find((a) => a.accountType === 'CLEARING');
    if (!target || !clearing) throw new NotFoundException('ACCOUNT_NOT_FOUND');
    return { target, clearing };
  }
  private async found(tx: Tx, clientId: string, id: string) {
    const deposit = await tx.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return deposit;
  }
  async requirement(
    clientId: string,
    riderId: string,
    actorId: string,
    input: { amount: string; sourceType: string; sourceId: string },
  ) {
    const requiredAmount = nonnegative(input.amount);
    if (
      !input.sourceType ||
      !input.sourceId ||
      input.sourceType.length > 60 ||
      input.sourceId.length > 120
    )
      throw new BadRequestException('INVALID_DEPOSIT_REQUIREMENT');
    const wallet = await this.wallet.ensure(clientId, riderId, actorId);
    return this.wallet.locked(wallet.id, async (tx) => {
      const existing = await tx.walletSecurityDeposit.findUnique({
        where: {
          clientId_riderId_sourceType_sourceId: {
            clientId,
            riderId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          },
        },
      });
      if (existing) {
        if (!existing.requiredAmount.eq(requiredAmount))
          throw new ConflictException('SECURITY_DEPOSIT_ALREADY_EXISTS');
        return existing;
      }
      const policy = await this.policies.effective(clientId);
      await tx.walletAccount.upsert({
        where: {
          clientId_walletId_accountType: {
            clientId,
            walletId: wallet.id,
            accountType: 'SECURITY_DEPOSIT',
          },
        },
        create: {
          clientId,
          walletId: wallet.id,
          accountType: 'SECURITY_DEPOSIT',
          currency: wallet.currency,
        },
        update: {},
      });
      const deposit = await tx.walletSecurityDeposit.create({
        data: {
          clientId,
          riderId,
          walletId: wallet.id,
          currency: wallet.currency,
          requiredAmount,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          policyVersion: policy.version,
          status: requiredAmount.eq(0) ? 'PAID' : 'PENDING',
          createdById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.required',
          entityType: 'WalletSecurityDeposit',
          entityId: deposit.id,
          newData: {
            requiredAmount: requiredAmount.toFixed(2),
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            policyVersion: policy.version,
          },
        },
      });
      return deposit;
    });
  }
  async summaryTx(tx: Tx, deposit: WalletSecurityDeposit) {
    const { target } = await this.account(tx, deposit);
    const entries = await tx.walletLedgerEntry.findMany({
      where: {
        clientId: deposit.clientId,
        walletId: deposit.walletId,
        accountId: target.id,
        transaction: {
          status: { in: ['POSTED', 'REVERSED'] },
          OR: [
            {
              referenceType: 'WALLET_SECURITY_DEPOSIT',
              referenceId: deposit.id,
            },
            {
              parentTransaction: {
                referenceType: 'WALLET_SECURITY_DEPOSIT',
                referenceId: deposit.id,
              },
            },
          ],
        },
      },
      include: {
        transaction: {
          select: {
            transactionType: true,
            parentTransaction: { select: { transactionType: true } },
          },
        },
      },
    });
    const holds = await tx.walletHold.findMany({
      where: {
        clientId: deposit.clientId,
        walletId: deposit.walletId,
        accountId: target.id,
        referenceType: 'WALLET_SECURITY_DEPOSIT',
        referenceId: deposit.id,
        status: 'ACTIVE',
      },
    });
    const held = holds.reduce(
      (sum, h) => sum.plus(h.amount.minus(h.capturedAmount)),
      zero,
    );
    const { funded, deducted, refunded, balance, outstanding, refundable } =
      depositAccounting(
        deposit.requiredAmount,
        entries.map((entry) => ({
          type:
            entry.transaction.transactionType === 'REVERSAL'
              ? entry.transaction.parentTransaction?.transactionType
              : entry.transaction.transactionType,
          entryType: entry.entryType,
          amount: entry.amount,
        })),
        held,
      );
    return {
      id: deposit.id,
      walletId: deposit.walletId,
      riderId: deposit.riderId,
      currency: deposit.currency,
      status: deposit.status,
      requiredAmount: deposit.requiredAmount.toFixed(2),
      fundedAmount: funded.toFixed(2),
      outstandingAmount: outstanding.toFixed(2),
      lockedAmount: [
        'LOCKED',
        'PARTIALLY_DEDUCTED',
        'REFUND_ELIGIBLE',
        'REFUND_REQUESTED',
      ].includes(deposit.status)
        ? balance.toFixed(2)
        : '0.00',
      deductedAmount: deducted.toFixed(2),
      refundedAmount: refunded.toFixed(2),
      heldAmount: held.toFixed(2),
      refundableAmount: refundable.toFixed(2),
      sourceType: deposit.sourceType,
      sourceId: deposit.sourceId,
      policyVersion: deposit.policyVersion,
    };
  }
  async summary(clientId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await this.found(tx, clientId, id);
      const summary = await this.summaryTx(tx, deposit);
      const returns = await tx.walletDepositRefundRequest.findMany({
        where: { clientId, depositId: id },
        select: {
          id: true,
          amount: true,
          status: true,
          destinationType: true,
          requestedAt: true,
          approvedAt: true,
          completedAt: true,
        },
        orderBy: { requestedAt: 'desc' },
        take: 50,
      });
      return {
        ...summary,
        returns: returns.map((row) => ({
          ...row,
          amount: row.amount.toFixed(2),
        })),
      };
    });
  }
  async forWallet(clientId: string, walletId: string) {
    const deposits = await this.prisma.walletSecurityDeposit.findMany({
      where: { clientId, walletId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(deposits.map((d) => this.summary(clientId, d.id)));
  }
  async fund(
    clientId: string,
    id: string,
    actorId: string,
    amount: string,
    key: string,
  ) {
    const value = money(amount);
    const initial = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!initial) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(initial.walletId, async (tx) => {
      const deposit = await this.found(tx, clientId, id);
      const existing = await tx.walletTransaction.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (existing) {
        if (
          existing.referenceId !== id ||
          !existing.amount.eq(value) ||
          existing.transactionType !== 'SECURITY_DEPOSIT'
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return this.summaryTx(tx, deposit);
      }
      if (!['PENDING', 'PARTIALLY_PAID'].includes(deposit.status))
        throw new ConflictException('INVALID_DEPOSIT_STATE_TRANSITION');
      const summary = await this.summaryTx(tx, deposit);
      if (value.gt(summary.outstandingAmount))
        throw new ConflictException('SECURITY_DEPOSIT_OVERPAYMENT');
      const policy = await this.policies.effective(clientId);
      if (
        !policy.allowPartialSecurityDeposit &&
        !value.eq(summary.outstandingAmount)
      )
        throw new ConflictException('PARTIAL_DEPOSIT_NOT_ALLOWED');
      const { target, clearing } = await this.account(tx, deposit);
      const transaction = await this.wallet.postInTransaction(tx, {
        clientId,
        walletId: deposit.walletId,
        actorId,
        type: WalletTransactionType.SECURITY_DEPOSIT,
        amount,
        currency: deposit.currency,
        description: `Security deposit funding ${id}`,
        idempotencyKey: key,
        referenceType: 'WALLET_SECURITY_DEPOSIT',
        referenceId: id,
        entries: [
          { accountId: target.id, entryType: 'CREDIT', amount },
          { accountId: clearing.id, entryType: 'DEBIT', amount },
        ],
      });
      const line = await tx.riderInvoiceLine.findFirst({
        where: {
          clientId,
          sourceId: id,
          chargeType: 'SECURITY_DEPOSIT',
          invoice: { invoiceType: 'SECURITY_DEPOSIT' },
        },
        include: { invoice: true },
      });
      if (line) {
        await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${line.invoiceId} AND "clientId" = ${clientId} FOR UPDATE`;
        const invoice = await tx.riderInvoice.findUniqueOrThrow({
          where: { id: line.invoiceId },
        });
        if (
          !['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'].includes(
            invoice.status,
          ) ||
          value.gt(invoice.outstandingAmount)
        )
          throw new ConflictException('INVOICE_NOT_PAYABLE');
        await tx.walletInvoiceAllocation.create({
          data: {
            clientId,
            invoiceId: invoice.id,
            transactionId: transaction.id,
            sourceType: 'EXTERNAL_RECORD',
            amount: value,
            currency: deposit.currency,
            createdById: actorId,
          },
        });
        const outstanding = invoice.outstandingAmount.minus(value);
        await tx.riderInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: invoice.paidAmount.plus(value),
            outstandingAmount: outstanding,
            status: outstanding.eq(0)
              ? 'PAID'
              : invoice.status === 'OVERDUE'
                ? 'OVERDUE'
                : 'PARTIALLY_PAID',
            paidAt: outstanding.eq(0) ? new Date() : null,
          },
        });
      }
      await tx.walletSecurityDeposit.update({
        where: { id },
        data: {
          status: value.eq(summary.outstandingAmount)
            ? 'PAID'
            : 'PARTIALLY_PAID',
          updatedById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.funded',
          entityType: 'WalletSecurityDeposit',
          entityId: id,
          newData: { amount, transactionKey: key },
        },
      });
      return this.summaryTx(tx, {
        ...deposit,
        status: value.eq(summary.outstandingAmount) ? 'PAID' : 'PARTIALLY_PAID',
      });
    });
  }
  async lock(clientId: string, id: string, actorId: string) {
    const initial = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!initial) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(initial.walletId, async (tx) => {
      const deposit = await this.found(tx, clientId, id);
      if (deposit.status === 'LOCKED') return this.summaryTx(tx, deposit);
      if (deposit.status !== 'PAID')
        throw new ConflictException('INVALID_DEPOSIT_STATE_TRANSITION');
      await tx.walletSecurityDeposit.update({
        where: { id },
        data: { status: 'LOCKED', lockedAt: new Date(), updatedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.locked',
          entityType: 'WalletSecurityDeposit',
          entityId: id,
        },
      });
      return this.summaryTx(tx, { ...deposit, status: 'LOCKED' });
    });
  }
  async hold(
    clientId: string,
    id: string,
    actorId: string,
    amount: string,
    reason: string,
    key: string,
    expiresAt?: string,
  ) {
    const value = money(amount);
    if (
      !reason ||
      reason.length > 300 ||
      (expiresAt &&
        (Number.isNaN(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Date.now()))
    )
      throw new BadRequestException('INVALID_HOLD');
    const initial = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!initial) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(initial.walletId, async (tx) => {
      const deposit = await this.found(tx, clientId, id);
      const existing = await tx.walletHold.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (existing) {
        if (
          existing.referenceId !== id ||
          !existing.amount.eq(value) ||
          existing.reason !== reason
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return existing;
      }
      if (!['LOCKED', 'PARTIALLY_DEDUCTED'].includes(deposit.status))
        throw new ConflictException('SECURITY_DEPOSIT_NOT_LOCKED');
      const summary = await this.summaryTx(tx, deposit);
      if (value.gt(summary.refundableAmount))
        throw new ConflictException('DEPOSIT_HOLD_EXCEEDS_AVAILABLE_AMOUNT');
      const { target } = await this.account(tx, deposit);
      const hold = await tx.walletHold.create({
        data: {
          clientId,
          walletId: deposit.walletId,
          accountId: target.id,
          amount: value,
          currency: deposit.currency,
          idempotencyKey: key,
          reason,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          referenceType: 'WALLET_SECURITY_DEPOSIT',
          referenceId: id,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.hold.created',
          entityType: 'WalletHold',
          entityId: hold.id,
        },
      });
      return hold;
    });
  }
  async expireHold(
    clientId: string,
    id: string,
    holdId: string,
    actorId: string,
  ) {
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(deposit.walletId, async (tx) => {
      const hold = await tx.walletHold.findFirst({
        where: {
          clientId,
          id: holdId,
          referenceType: 'WALLET_SECURITY_DEPOSIT',
          referenceId: id,
        },
      });
      if (!hold) throw new NotFoundException('HOLD_NOT_FOUND');
      if (hold.status === 'EXPIRED') return hold;
      if (
        hold.status !== 'ACTIVE' ||
        !hold.expiresAt ||
        hold.expiresAt > new Date()
      )
        throw new ConflictException('HOLD_NOT_EXPIRABLE');
      const result = await tx.walletHold.update({
        where: { id: holdId },
        data: { status: 'EXPIRED' },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.hold.expired',
          entityType: 'WalletHold',
          entityId: holdId,
        },
      });
      return result;
    });
  }
  async deduct(
    clientId: string,
    id: string,
    actorId: string,
    input: {
      amount: string;
      reasonCode: string;
      description: string;
      referenceType: string;
      referenceId: string;
      holdId?: string;
    },
    key: string,
    forfeiture = false,
  ) {
    const amount = money(input.amount);
    if (
      !input.reasonCode ||
      !input.description ||
      !input.referenceType ||
      !input.referenceId
    )
      throw new BadRequestException('INVALID_DEPOSIT_DEDUCTION');
    const initial = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!initial) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(initial.walletId, async (tx) => {
      const deposit = await this.found(tx, clientId, id);
      const existing = await tx.walletTransaction.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (existing) {
        if (
          existing.referenceId !== id ||
          !existing.amount.eq(amount) ||
          existing.transactionType !==
            (forfeiture
              ? 'SECURITY_DEPOSIT_FORFEITURE'
              : 'SECURITY_DEPOSIT_DEDUCTION')
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return this.summaryTx(tx, deposit);
      }
      if (!['LOCKED', 'PARTIALLY_DEDUCTED'].includes(deposit.status))
        throw new ConflictException('SECURITY_DEPOSIT_NOT_LOCKED');
      const policy = await this.policies.effective(clientId);
      if (
        !policy.allowDepositDeduction ||
        !policy.depositDeductionReasons.includes(input.reasonCode)
      )
        throw new ConflictException('DEPOSIT_DEDUCTION_NOT_ALLOWED');
      const summary = await this.summaryTx(tx, deposit);
      if (
        amount.gt(
          new Prisma.Decimal(summary.refundableAmount).plus(
            input.holdId
              ? await this.remainingHold(tx, clientId, id, input.holdId)
              : zero,
          ),
        )
      )
        throw new ConflictException('SECURITY_DEPOSIT_INSUFFICIENT');
      if (input.holdId) {
        const hold = await tx.walletHold.findFirst({
          where: {
            clientId,
            id: input.holdId,
            referenceType: 'WALLET_SECURITY_DEPOSIT',
            referenceId: id,
            status: 'ACTIVE',
          },
        });
        if (!hold || amount.gt(hold.amount.minus(hold.capturedAmount)))
          throw new ConflictException('SECURITY_DEPOSIT_INSUFFICIENT');
        const captured = hold.capturedAmount.plus(amount);
        await tx.walletHold.update({
          where: { id: hold.id },
          data: {
            capturedAmount: captured,
            status: captured.eq(hold.amount) ? 'CAPTURED' : 'ACTIVE',
            capturedAt: captured.eq(hold.amount) ? new Date() : null,
          },
        });
      }
      const { target, clearing } = await this.account(tx, deposit);
      await this.wallet.postInTransaction(tx, {
        clientId,
        walletId: deposit.walletId,
        actorId,
        type: forfeiture
          ? WalletTransactionType.SECURITY_DEPOSIT_FORFEITURE
          : WalletTransactionType.SECURITY_DEPOSIT_DEDUCTION,
        amount: input.amount,
        currency: deposit.currency,
        description: input.description,
        idempotencyKey: key,
        referenceType: 'WALLET_SECURITY_DEPOSIT',
        referenceId: id,
        entries: [
          { accountId: target.id, entryType: 'DEBIT', amount: input.amount },
          { accountId: clearing.id, entryType: 'CREDIT', amount: input.amount },
        ],
      });
      const nextStatus: WalletDepositStatus =
        forfeiture && amount.eq(new Prisma.Decimal(summary.refundableAmount))
          ? 'FORFEITED'
          : 'PARTIALLY_DEDUCTED';
      await tx.walletSecurityDeposit.update({
        where: { id },
        data: { status: nextStatus, updatedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: forfeiture
            ? 'wallet.deposit.forfeited'
            : 'wallet.deposit.deducted',
          entityType: 'WalletSecurityDeposit',
          entityId: id,
          newData: {
            amount: input.amount,
            reasonCode: input.reasonCode,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
          },
        },
      });
      return this.summaryTx(tx, { ...deposit, status: nextStatus });
    });
  }
  forfeit(
    clientId: string,
    id: string,
    actorId: string,
    input: {
      amount: string;
      reasonCode: string;
      description: string;
      referenceType: string;
      referenceId: string;
    },
    key: string,
  ) {
    return this.deduct(clientId, id, actorId, input, key, true);
  }
  private async remainingHold(
    tx: Tx,
    clientId: string,
    depositId: string,
    holdId: string,
  ) {
    const hold = await tx.walletHold.findFirst({
      where: { clientId, id: holdId, referenceId: depositId, status: 'ACTIVE' },
    });
    return hold ? hold.amount.minus(hold.capturedAmount) : zero;
  }
  async releaseHold(
    clientId: string,
    id: string,
    holdId: string,
    actorId: string,
  ) {
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(deposit.walletId, async (tx) => {
      const hold = await tx.walletHold.findFirst({
        where: {
          clientId,
          id: holdId,
          referenceType: 'WALLET_SECURITY_DEPOSIT',
          referenceId: id,
        },
      });
      if (!hold) throw new NotFoundException('HOLD_NOT_FOUND');
      if (hold.status === 'RELEASED') return hold;
      if (hold.status !== 'ACTIVE')
        throw new ConflictException('HOLD_ALREADY_FINALIZED');
      const result = await tx.walletHold.update({
        where: { id: holdId },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.hold.released',
          entityType: 'WalletHold',
          entityId: holdId,
        },
      });
      return result;
    });
  }
  async eligibility(clientId: string, id: string) {
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    const summary = await this.summary(clientId, id);
    const blockers: { code: string; message: string }[] = [];
    if (
      !['LOCKED', 'PARTIALLY_DEDUCTED', 'REFUND_ELIGIBLE'].includes(
        deposit.status,
      )
    )
      blockers.push({
        code: 'DEPOSIT_NOT_LOCKED',
        message: 'Deposit is not locked',
      });
    if (new Prisma.Decimal(summary.heldAmount).gt(0))
      blockers.push({
        code: 'ACTIVE_DEPOSIT_HOLD',
        message: 'Deposit has an active reservation',
      });
    if (new Prisma.Decimal(summary.refundableAmount).lte(0))
      blockers.push({
        code: 'NO_REFUNDABLE_BALANCE',
        message: 'No deposit balance remains',
      });
    const activeAllocation = await this.prisma.allocation.findFirst({
      where: { clientId, riderId: deposit.riderId, status: 'ACTIVE' },
    });
    if (activeAllocation)
      blockers.push({
        code: 'ACTIVE_VEHICLE_ALLOCATION',
        message: 'Vehicle allocation is still active',
      });
    const activeAgreement = await this.prisma.riderRentalAgreement.findFirst({
      where: {
        clientId,
        riderId: deposit.riderId,
        status: { in: ['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'] },
      },
    });
    if (activeAgreement)
      blockers.push({
        code: 'ACTIVE_RENTAL_AGREEMENT',
        message: 'Rental agreement is still active',
      });
    const unpaidInvoice = await this.prisma.riderInvoice.findFirst({
      where: {
        clientId,
        riderId: deposit.riderId,
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
        outstandingAmount: { gt: 0 },
      },
    });
    if (unpaidInvoice)
      blockers.push({
        code: 'UNPAID_INVOICE',
        message: 'An invoice remains unpaid',
      });
    return {
      eligible: blockers.length === 0,
      refundableAmount: summary.refundableAmount,
      blockers,
    };
  }
  async requestRefund(
    clientId: string,
    id: string,
    actorId: string,
    amount: string,
    reason: string,
    key: string,
    destinationType: 'WALLET_CASH' | 'MANUAL_OFFLINE' = 'WALLET_CASH',
  ) {
    const value = money(amount);
    if (!reason?.trim() || reason.length > 500 || !key || key.length > 160)
      throw new BadRequestException('INVALID_DEPOSIT_RETURN_REQUEST');
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(deposit.walletId, async (tx) => {
      const existing = await tx.walletDepositRefundRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (existing) {
        if (
          existing.depositId !== id ||
          !existing.amount.eq(value) ||
          existing.destinationType !== destinationType
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return existing;
      }
      const policy = await this.policies.effective(clientId);
      if (!policy.allowDepositRefundRequest)
        throw new ConflictException('DEPOSIT_REFUND_REQUEST_NOT_ALLOWED');
      const eligibility = await this.eligibility(clientId, id);
      if (!eligibility.eligible || value.gt(eligibility.refundableAmount))
        throw new ConflictException('SECURITY_DEPOSIT_NOT_REFUNDABLE');
      const request = await tx.walletDepositRefundRequest.create({
        data: {
          clientId,
          depositId: id,
          amount: value,
          reason,
          destinationType,
          idempotencyKey: key,
          requestedById: actorId,
        },
      });
      const { target } = await this.account(tx, deposit);
      await tx.walletHold.create({
        data: {
          clientId,
          walletId: deposit.walletId,
          accountId: target.id,
          amount: value,
          currency: deposit.currency,
          reason: `Refund request ${request.id}`,
          idempotencyKey: `REFUND-${request.id}`,
          referenceType: 'WALLET_SECURITY_DEPOSIT',
          referenceId: id,
        },
      });
      await tx.walletSecurityDeposit.update({
        where: { id },
        data: { status: 'REFUND_REQUESTED' },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.refund.requested',
          entityType: 'WalletDepositRefundRequest',
          entityId: request.id,
        },
      });
      return request;
    });
  }
  async approveRefund(
    clientId: string,
    id: string,
    requestId: string,
    actorId: string,
  ) {
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(deposit.walletId, async (tx) => {
      const request = await tx.walletDepositRefundRequest.findFirst({
        where: { clientId, depositId: id, id: requestId },
      });
      if (!request)
        throw new NotFoundException('SECURITY_DEPOSIT_RETURN_NOT_FOUND');
      if (request.status !== 'REQUESTED') return request;
      if (request.requestedById === actorId)
        throw new ConflictException('MAKER_CANNOT_APPROVE_RETURN');
      const current = await this.found(tx, clientId, id);
      if (current.status !== 'REFUND_REQUESTED')
        throw new ConflictException('SECURITY_DEPOSIT_NOT_RETURNABLE');
      if (
        await tx.allocation.findFirst({
          where: { clientId, riderId: current.riderId, status: 'ACTIVE' },
        })
      )
        throw new ConflictException('ACTIVE_VEHICLE_ALLOCATION');
      if (
        await tx.riderRentalAgreement.findFirst({
          where: {
            clientId,
            riderId: current.riderId,
            status: { in: ['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'] },
          },
        })
      )
        throw new ConflictException('ACTIVE_RENTAL_AGREEMENT');
      if (
        await tx.riderInvoice.findFirst({
          where: {
            clientId,
            riderId: current.riderId,
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
          },
        })
      )
        throw new ConflictException('UNPAID_INVOICE');
      const hold = await tx.walletHold.findUnique({
        where: {
          clientId_idempotencyKey: {
            clientId,
            idempotencyKey: `REFUND-${request.id}`,
          },
        },
      });
      if (!hold || hold.status !== 'ACTIVE')
        throw new ConflictException('RETURN_HOLD_MISSING');
      const summary = await this.summaryTx(tx, current);
      if (
        request.amount.gt(
          new Prisma.Decimal(summary.refundableAmount).plus(
            hold.amount.minus(hold.capturedAmount),
          ),
        )
      )
        throw new ConflictException(
          'SECURITY_DEPOSIT_RETURN_EXCEEDS_AVAILABLE',
        );
      const now = new Date();
      await tx.walletDepositRefundRequest.update({
        where: { id: request.id },
        data: {
          status:
            request.destinationType === 'WALLET_CASH'
              ? 'APPROVED'
              : 'PROCESSING',
          approvedById: actorId,
          approvedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'wallet.deposit.return.approved',
          entityType: 'WalletDepositRefundRequest',
          entityId: request.id,
          newData: {
            destinationType: request.destinationType,
            amount: request.amount.toFixed(2),
          },
        },
      });
      if (request.destinationType === 'WALLET_CASH')
        return this.completeReturnTx(tx, current, request.id, actorId);
      return tx.walletDepositRefundRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
    });
  }
  private async completeReturnTx(
    tx: Tx,
    deposit: WalletSecurityDeposit,
    requestId: string,
    actorId: string,
    externalReference?: string,
  ) {
    const request = await tx.walletDepositRefundRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (request.status === 'RETURNED') return request;
    if (!['APPROVED', 'PROCESSING'].includes(request.status))
      throw new ConflictException('SECURITY_DEPOSIT_RETURN_NOT_APPROVED');
    if (
      request.destinationType === 'MANUAL_OFFLINE' &&
      (!externalReference?.trim() || externalReference.length > 160)
    )
      throw new BadRequestException('EXTERNAL_REFERENCE_REQUIRED');
    const hold = await tx.walletHold.findUniqueOrThrow({
      where: {
        clientId_idempotencyKey: {
          clientId: deposit.clientId,
          idempotencyKey: `REFUND-${request.id}`,
        },
      },
    });
    if (hold.status !== 'ACTIVE')
      throw new ConflictException('RETURN_HOLD_MISSING');
    await tx.walletHold.update({
      where: { id: hold.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    const { target, clearing } = await this.account(tx, deposit);
    const destination =
      request.destinationType === 'WALLET_CASH'
        ? await tx.walletAccount.findUniqueOrThrow({
            where: {
              clientId_walletId_accountType: {
                clientId: deposit.clientId,
                walletId: deposit.walletId,
                accountType: 'CASH',
              },
            },
          })
        : clearing;
    await this.wallet.postInTransaction(tx, {
      clientId: deposit.clientId,
      walletId: deposit.walletId,
      actorId,
      type: WalletTransactionType.SECURITY_DEPOSIT_REFUND,
      amount: request.amount.toFixed(2),
      currency: deposit.currency,
      description: `Security deposit return ${request.id}`,
      idempotencyKey: `deposit-return:${request.id}`,
      referenceType: 'WALLET_SECURITY_DEPOSIT',
      referenceId: deposit.id,
      entries: [
        {
          accountId: target.id,
          entryType: 'DEBIT',
          amount: request.amount.toFixed(2),
        },
        {
          accountId: destination.id,
          entryType: 'CREDIT',
          amount: request.amount.toFixed(2),
        },
      ],
    });
    const remaining = new Prisma.Decimal(
      (await this.summaryTx(tx, deposit)).refundableAmount,
    );
    await tx.walletSecurityDeposit.update({
      where: { id: deposit.id },
      data: {
        status: remaining.eq(0) ? 'REFUNDED' : 'PARTIALLY_DEDUCTED',
        updatedById: actorId,
      },
    });
    const completed = await tx.walletDepositRefundRequest.update({
      where: { id: request.id },
      data: {
        status: 'RETURNED',
        completedAt: new Date(),
        externalReference: externalReference?.trim(),
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: deposit.clientId,
        actorId,
        action: 'wallet.deposit.return.completed',
        entityType: 'WalletDepositRefundRequest',
        entityId: request.id,
        newData: {
          amount: request.amount.toFixed(2),
          destinationType: request.destinationType,
          externalReference,
        },
      },
    });
    return completed;
  }
  async completeManualReturn(
    clientId: string,
    id: string,
    requestId: string,
    actorId: string,
    externalReference: string,
  ) {
    if (!externalReference?.trim() || externalReference.length > 160)
      throw new BadRequestException('EXTERNAL_REFERENCE_REQUIRED');
    const deposit = await this.prisma.walletSecurityDeposit.findFirst({
      where: { clientId, id },
    });
    if (!deposit) throw new NotFoundException('SECURITY_DEPOSIT_NOT_FOUND');
    return this.wallet.locked(deposit.walletId, async (tx) => {
      const request = await tx.walletDepositRefundRequest.findFirst({
        where: { clientId, depositId: id, id: requestId },
      });
      if (!request)
        throw new NotFoundException('SECURITY_DEPOSIT_RETURN_NOT_FOUND');
      if (request.destinationType !== 'MANUAL_OFFLINE')
        throw new ConflictException('RETURN_DESTINATION_MISMATCH');
      if (request.status === 'RETURNED') {
        if (request.externalReference !== externalReference.trim())
          throw new ConflictException('RETURN_REFERENCE_MISMATCH');
        return request;
      }
      return this.completeReturnTx(
        tx,
        deposit,
        requestId,
        actorId,
        externalReference,
      );
    });
  }
}
