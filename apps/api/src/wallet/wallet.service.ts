import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WalletAccountType, WalletEntryType, WalletHoldStatus, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { defaultPolicy } from './wallet-policy.service.js';

export const money = (value: string) => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(value) || new Prisma.Decimal(value).lte(0)) throw new BadRequestException('INVALID_AMOUNT');
  return new Prisma.Decimal(value);
};
type Entry = { accountId: string; entryType: WalletEntryType; amount: string };
type PostInput = { clientId: string; walletId: string; actorId: string; type: WalletTransactionType; amount: string; currency: string; description: string; idempotencyKey: string; entries: Entry[]; referenceType?: string; referenceId?: string; parentTransactionId?: string };

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}
  async locked<T>(walletId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id = ${walletId} FOR UPDATE`;
      return action(tx);
    }, { timeout: 15000 });
  }
  async ensure(clientId: string, riderId: string, actorId?: string) {
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null } });
    if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');
    return this.prisma.$transaction(async tx => {
      const wallet = await tx.riderWallet.upsert({ where: { clientId_riderId_currency: { clientId, riderId, currency: 'INR' } }, create: { clientId, riderId, currency: 'INR', createdById: actorId }, update: {} });
      await tx.walletAccount.upsert({ where: { clientId_walletId_accountType: { clientId, walletId: wallet.id, accountType: WalletAccountType.CASH } }, create: { clientId, walletId: wallet.id, accountType: WalletAccountType.CASH, currency: 'INR' }, update: {} });
      await tx.walletAccount.upsert({ where: { clientId_walletId_accountType: { clientId, walletId: wallet.id, accountType: WalletAccountType.CLEARING } }, create: { clientId, walletId: wallet.id, accountType: WalletAccountType.CLEARING, currency: 'INR' }, update: {} });
      await tx.walletAccount.upsert({ where: { clientId_walletId_accountType: { clientId, walletId: wallet.id, accountType: WalletAccountType.PROVIDER_CLEARING } }, create: { clientId, walletId: wallet.id, accountType: WalletAccountType.PROVIDER_CLEARING, currency: 'INR' }, update: {} });
      await tx.walletAccount.upsert({ where: { clientId_walletId_accountType: { clientId, walletId: wallet.id, accountType: WalletAccountType.REWARD } }, create: { clientId, walletId: wallet.id, accountType: WalletAccountType.REWARD, currency: 'INR' }, update: {} });
      return wallet;
    });
  }
  async riderWallet(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null } });
    if (!rider) throw new NotFoundException('WALLET_NOT_FOUND');
    return this.ensure(clientId, rider.id, userId);
  }
  async balanceTx(tx: Prisma.TransactionClient, clientId: string, walletId: string) {
    const wallet = await tx.riderWallet.findFirst({ where: { id: walletId, clientId }, include: { accounts: true } });
    if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
    const policy = await tx.walletPolicy.findFirst({ where: { clientId, effectiveUntil: null }, orderBy: { version: 'desc' } }) ?? defaultPolicy;
    const entries = await tx.walletLedgerEntry.findMany({ where: { clientId, walletId, transaction: { status: { in: [WalletTransactionStatus.POSTED, WalletTransactionStatus.REVERSED] } } }, select: { accountId: true, entryType: true, amount: true } });
    const holds = await tx.walletHold.findMany({ where: { clientId, walletId, status: WalletHoldStatus.ACTIVE }, select: { accountId: true, amount: true, capturedAmount: true } });
    const accounts = wallet.accounts.filter(a => a.accountType !== WalletAccountType.CLEARING && a.accountType !== WalletAccountType.PROVIDER_CLEARING).map(a => {
      const total = entries.filter(e => e.accountId === a.id).reduce((sum, e) => sum.plus(e.entryType === WalletEntryType.CREDIT ? e.amount : e.amount.neg()), new Prisma.Decimal(0));
      const held = holds.filter(h => h.accountId === a.id).reduce((sum, h) => sum.plus(h.amount.minus(h.capturedAmount)), new Prisma.Decimal(0));
      const minimum = a.accountType === WalletAccountType.CASH ? policy.minimumCashBalance : new Prisma.Decimal(0);
      return { accountId: a.id, accountType: a.accountType, totalBalance: total.toFixed(2), heldBalance: held.toFixed(2), availableBalance: total.minus(held).minus(minimum).toFixed(2) };
    });
    const bucket = (type: WalletAccountType) => accounts.find(a => a.accountType === type);
    const cash = bucket(WalletAccountType.CASH), reward = bucket(WalletAccountType.REWARD), deposit = bucket(WalletAccountType.SECURITY_DEPOSIT);
    const zero = { totalBalance: '0.00', heldBalance: '0.00', availableBalance: '0.00' };
    const spendable = [cash, reward].filter((a): a is NonNullable<typeof a> => !!a);
    const total = spendable.reduce((s, a) => s.plus(a.totalBalance), new Prisma.Decimal(0));
    const held = spendable.reduce((s, a) => s.plus(a.heldBalance), new Prisma.Decimal(0));
    return { currency: wallet.currency, totalBalance: total.toFixed(2), heldBalance: held.toFixed(2), availableBalance: spendable.reduce((sum, a) => sum.plus(a.availableBalance), new Prisma.Decimal(0)).toFixed(2), cash: cash ?? zero, rewards: reward ?? zero, securityDepositBucket: deposit ?? zero, accounts };
  }
  balance(clientId: string, walletId: string) { return this.prisma.$transaction(tx => this.balanceTx(tx, clientId, walletId)); }
  async postInTransaction(tx: Prisma.TransactionClient, input: PostInput) {
    const amount = money(input.amount);
    if (!input.idempotencyKey || !input.description || input.entries.length < 2) throw new BadRequestException('INVALID_LEDGER_TRANSACTION');
    const hash = createHash('sha256').update(JSON.stringify({ walletId: input.walletId, type: input.type, amount: amount.toFixed(2), currency: input.currency, description: input.description, entries: input.entries, referenceType: input.referenceType, referenceId: input.referenceId, parentTransactionId: input.parentTransactionId })).digest('hex');
    {
      const existing = await tx.walletTransaction.findUnique({ where: { clientId_idempotencyKey: { clientId: input.clientId, idempotencyKey: input.idempotencyKey } } });
      if (existing) { if (existing.requestHash !== hash) throw new ConflictException('IDEMPOTENCY_CONFLICT'); return existing; }
      const wallet = await tx.riderWallet.findFirst({ where: { id: input.walletId, clientId: input.clientId }, include: { accounts: true } });
      if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
      if (wallet.status !== 'ACTIVE') throw new ConflictException('WALLET_INACTIVE');
      if (wallet.currency !== input.currency) throw new BadRequestException('CURRENCY_MISMATCH');
      let debits = new Prisma.Decimal(0), credits = new Prisma.Decimal(0);
      for (const entry of input.entries) {
        const account = wallet.accounts.find(a => a.id === entry.accountId);
        if (!account || account.status !== 'ACTIVE') throw new BadRequestException('ACCOUNT_NOT_FOUND');
        if (account.currency !== input.currency) throw new BadRequestException('CURRENCY_MISMATCH');
        const value = money(entry.amount);
        if (entry.entryType === WalletEntryType.DEBIT) debits = debits.plus(value);
        else if (entry.entryType === WalletEntryType.CREDIT) credits = credits.plus(value);
        else throw new BadRequestException('INVALID_LEDGER_TRANSACTION');
      }
      if (!debits.eq(credits) || !debits.eq(amount)) throw new BadRequestException('UNBALANCED_LEDGER');
      const policy = await tx.walletPolicy.findFirst({ where: { clientId: input.clientId, effectiveUntil: null }, orderBy: { version: 'desc' } }) ?? defaultPolicy;
      const balance = await this.balanceTx(tx, input.clientId, input.walletId);
      for (const account of balance.accounts) {
        const net = input.entries.filter(e => e.accountId === account.accountId).reduce((s, e) => s.plus(e.entryType === WalletEntryType.CREDIT ? e.amount : new Prisma.Decimal(e.amount).neg()), new Prisma.Decimal(0));
        const limit = account.accountType === 'CASH' && policy.allowNegativeCashBalance ? policy.negativeBalanceLimit : new Prisma.Decimal(0);
        if (new Prisma.Decimal(account.availableBalance).plus(net).lt(new Prisma.Decimal(limit).neg())) throw new ConflictException('INSUFFICIENT_AVAILABLE_BALANCE');
      }
      if (input.parentTransactionId) {
        const original = await tx.walletTransaction.findFirst({ where: { id: input.parentTransactionId, clientId: input.clientId, walletId: input.walletId, status: 'POSTED' } });
        if (!original) throw new ConflictException('TRANSACTION_NOT_REVERSIBLE');
      }
      const id = randomUUID();
      const transaction = await tx.walletTransaction.create({ data: { id, clientId: input.clientId, walletId: input.walletId, transactionNumber: `EVW-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${id.slice(0,8).toUpperCase()}`, transactionType: input.type, status: WalletTransactionStatus.CREATED, amount, currency: input.currency, description: input.description, idempotencyKey: input.idempotencyKey, requestHash: hash, referenceType: input.referenceType, referenceId: input.referenceId, parentTransactionId: input.parentTransactionId, createdById: input.actorId } });
      await tx.walletLedgerEntry.createMany({ data: input.entries.map((e, i) => ({ clientId: input.clientId, walletId: input.walletId, transactionId: id, accountId: e.accountId, entryType: e.entryType, amount: money(e.amount), currency: input.currency, sequence: i + 1, createdById: input.actorId })) });
      const rewardDebit = input.entries.filter(entry => entry.entryType === 'DEBIT' && wallet.accounts.some(account => account.id === entry.accountId && account.accountType === 'REWARD')).reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      if (rewardDebit.gt(0)) {
        const lots = await tx.rewardLot.findMany({ where: { clientId: input.clientId, riderId: wallet.riderId, status: 'AVAILABLE', remainingAmount: { gt: 0 } }, orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }] });
        const now = new Date();
        const targeted = input.referenceType === 'REWARD_EXPIRY' || input.referenceType === 'REWARD_REVERSAL';
        const eligible = lots.filter(lot => targeted ? lot.id === input.referenceId : !lot.expiresAt || lot.expiresAt > now);
        const tracked = lots.reduce((sum, lot) => sum.plus(lot.remainingAmount), new Prisma.Decimal(0));
        const legacy = targeted ? new Prisma.Decimal(0) : Prisma.Decimal.max(new Prisma.Decimal(balance.rewards.availableBalance).minus(tracked), 0);
        if (rewardDebit.gt(eligible.reduce((sum, lot) => sum.plus(lot.remainingAmount), legacy))) throw new ConflictException('REWARD_LOTS_INSUFFICIENT');
        let left = rewardDebit;
        for (const lot of eligible) {
          if (left.lte(0)) break;
          const used = Prisma.Decimal.min(left, lot.remainingAmount);
          if (used.lte(0)) continue;
          await tx.rewardLotConsumption.create({ data: { clientId: input.clientId, lotId: lot.id, transactionId: id, amount: used, kind: input.referenceType === 'REWARD_EXPIRY' ? 'EXPIRY' : input.referenceType === 'REWARD_REVERSAL' ? 'REVERSAL' : 'SPEND' } });
          const remaining = lot.remainingAmount.minus(used);
          await tx.rewardLot.update({ where: { id: lot.id }, data: { remainingAmount: remaining, status: remaining.eq(0) ? input.referenceType === 'REWARD_EXPIRY' ? 'EXPIRED' : input.referenceType === 'REWARD_REVERSAL' ? 'REVERSED' : 'CONSUMED' : 'AVAILABLE' } });
          left = left.minus(used);
        }
      }
      const posted = await tx.walletTransaction.update({ where: { id }, data: { status: WalletTransactionStatus.POSTED, postedAt: new Date() } });
      if (input.parentTransactionId) {
        const original = await tx.walletTransaction.update({ where: { id: input.parentTransactionId }, data: { status: 'REVERSED', reversedAt: new Date() } });
        const restored = await tx.rewardLotConsumption.findMany({ where: { clientId: input.clientId, transactionId: original.id, kind: 'SPEND' } });
        for (const allocation of restored) {
          const lot = await tx.rewardLot.findFirst({ where: { id: allocation.lotId, clientId: input.clientId } });
          if (!lot) throw new ConflictException('REWARD_LOT_NOT_FOUND');
          await tx.rewardLot.update({ where: { id: lot.id }, data: { remainingAmount: lot.remainingAmount.plus(allocation.amount), status: 'AVAILABLE' } });
          await tx.rewardLotConsumption.create({ data: { clientId: input.clientId, lotId: lot.id, transactionId: id, amount: allocation.amount, kind: 'RESTORE' } });
        }
        if (original.referenceType === 'WALLET_SECURITY_DEPOSIT' && original.referenceId) await this.reconcileDepositStateTx(tx, input.clientId, original.referenceId);
      }
      await tx.auditLog.create({ data: { clientId: input.clientId, actorId: input.actorId === 'SYSTEM' ? null : input.actorId, action: 'wallet.transaction.posted', entityType: 'WalletTransaction', entityId: id, newData: { transactionNumber: transaction.transactionNumber, type: input.type } } });
      return posted;
    }
  }
  private async reconcileDepositStateTx(tx: Prisma.TransactionClient, clientId: string, depositId: string) {
    const deposit = await tx.walletSecurityDeposit.findFirst({ where: { clientId, id: depositId } });
    if (!deposit) return;
    const account = await tx.walletAccount.findFirst({ where: { clientId, walletId: deposit.walletId, accountType: 'SECURITY_DEPOSIT' } });
    if (!account) return;
    const entries = await tx.walletLedgerEntry.findMany({ where: { clientId, accountId: account.id, transaction: { status: { in: ['POSTED', 'REVERSED'] }, OR: [{ referenceType: 'WALLET_SECURITY_DEPOSIT', referenceId: depositId }, { parentTransaction: { referenceType: 'WALLET_SECURITY_DEPOSIT', referenceId: depositId } }] } }, include: { transaction: { select: { transactionType: true, parentTransaction: { select: { transactionType: true } } } } } });
    let funded = new Prisma.Decimal(0), deducted = new Prisma.Decimal(0);
    for (const entry of entries) {
      const type = entry.transaction.transactionType === 'REVERSAL' ? entry.transaction.parentTransaction?.transactionType : entry.transaction.transactionType;
      const signed = entry.entryType === 'CREDIT' ? entry.amount : entry.amount.neg();
      if (type === 'SECURITY_DEPOSIT') funded = funded.plus(signed);
      if (type === 'SECURITY_DEPOSIT_DEDUCTION' || type === 'SECURITY_DEPOSIT_FORFEITURE') deducted = deducted.minus(signed);
    }
    const status = funded.lt(deposit.requiredAmount) ? funded.gt(0) ? 'PARTIALLY_PAID' : 'PENDING' : deducted.gt(0) ? 'PARTIALLY_DEDUCTED' : deposit.lockedAt ? 'LOCKED' : 'PAID';
    await tx.walletSecurityDeposit.update({ where: { id: deposit.id }, data: { status } });
  }
  post(input: PostInput) { return this.locked(input.walletId, tx => this.postInTransaction(tx, input)); }
  async adjust(clientId: string, walletId: string, actorId: string, direction: 'CREDIT' | 'DEBIT', amount: string, reason: string, key: string, bucket: 'CASH' | 'REWARD' = 'CASH') {
    const wallet = await this.prisma.riderWallet.findFirst({ where: { clientId, id: walletId }, include: { accounts: true } });
    if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
    const cash = wallet.accounts.find(a => a.accountType === bucket)!, clearing = wallet.accounts.find(a => a.accountType === 'CLEARING')!;
    return this.post({ clientId, walletId, actorId, type: bucket === 'REWARD' && direction === 'CREDIT' ? WalletTransactionType.REWARD : WalletTransactionType.ADJUSTMENT, amount, currency: wallet.currency, description: reason, idempotencyKey: key, entries: [{ accountId: cash.id, entryType: direction, amount }, { accountId: clearing.id, entryType: direction === 'CREDIT' ? 'DEBIT' : 'CREDIT', amount }] });
  }
  async hold(clientId: string, walletId: string, actorId: string, amount: string, reason: string, key: string) {
    const value = money(amount);
    return this.locked(walletId, async tx => {
      const existing = await tx.walletHold.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
      if (existing) { if (existing.walletId !== walletId || !existing.amount.eq(value) || existing.reason !== reason) throw new ConflictException('IDEMPOTENCY_CONFLICT'); return existing; }
      const wallet = await tx.riderWallet.findFirst({ where: { clientId, id: walletId }, include: { accounts: true } });
      if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
      if (wallet.status !== 'ACTIVE') throw new ConflictException('WALLET_INACTIVE');
      const cash = wallet.accounts.find(a => a.accountType === 'CASH');
      if (!cash) throw new NotFoundException('ACCOUNT_NOT_FOUND');
      const balance = await this.balanceTx(tx, clientId, walletId);
      if (new Prisma.Decimal(balance.accounts.find(a => a.accountId === cash.id)!.availableBalance).lt(value)) throw new ConflictException('INSUFFICIENT_AVAILABLE_BALANCE');
      const hold = await tx.walletHold.create({ data: { clientId, walletId, accountId: cash.id, amount: value, currency: wallet.currency, reason, idempotencyKey: key } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'wallet.hold.created', entityType: 'WalletHold', entityId: hold.id } });
      return hold;
    });
  }
  async transitionHold(clientId: string, holdId: string, actorId: string, status: 'RELEASED' | 'EXPIRED' | 'CAPTURED') {
    const found = await this.prisma.walletHold.findFirst({ where: { clientId, id: holdId } });
    if (!found) throw new NotFoundException('HOLD_NOT_FOUND');
    return this.locked(found.walletId, async tx => {
      const hold = await tx.walletHold.findFirst({ where: { clientId, id: holdId } });
      if (!hold) throw new NotFoundException('HOLD_NOT_FOUND');
      if (hold.status === status) return hold;
      if (hold.referenceType === 'WALLET_SECURITY_DEPOSIT') throw new ConflictException('DEPOSIT_HOLD_REQUIRES_DEPOSIT_WORKFLOW');
      if (hold.status !== 'ACTIVE') throw new ConflictException('HOLD_ALREADY_FINALIZED');
      if (status === 'CAPTURED') {
        const wallet = await tx.riderWallet.findFirst({ where: { clientId, id: hold.walletId }, include: { accounts: true } });
        if (!wallet || wallet.status !== 'ACTIVE') throw new ConflictException('WALLET_INACTIVE');
        const clearing = wallet.accounts.find(a => a.accountType === 'CLEARING' && a.status === 'ACTIVE');
        if (!clearing) throw new NotFoundException('ACCOUNT_NOT_FOUND');
        const id = randomUUID();
        await tx.walletTransaction.create({ data: { id, clientId, walletId: hold.walletId, transactionNumber: `EVW-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${id.slice(0,8).toUpperCase()}`, transactionType: 'PAYMENT', status: 'CREATED', currency: hold.currency, amount: hold.amount, description: `Capture hold ${hold.id}`, idempotencyKey: `CAPTURE-${hold.id}`, requestHash: createHash('sha256').update(hold.id).digest('hex'), referenceType: 'WALLET_HOLD', referenceId: hold.id, createdById: actorId } });
        await tx.walletLedgerEntry.createMany({ data: [
          { clientId, walletId: hold.walletId, transactionId: id, accountId: hold.accountId, entryType: 'DEBIT', amount: hold.amount, currency: hold.currency, sequence: 1, createdById: actorId },
          { clientId, walletId: hold.walletId, transactionId: id, accountId: clearing.id, entryType: 'CREDIT', amount: hold.amount, currency: hold.currency, sequence: 2, createdById: actorId },
        ] });
        await tx.walletTransaction.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date() } });
      }
      const updated = await tx.walletHold.update({ where: { id: holdId }, data: { status, capturedAmount: status === 'CAPTURED' ? hold.amount : undefined, releasedAt: status === 'RELEASED' ? new Date() : undefined, capturedAt: status === 'CAPTURED' ? new Date() : undefined } });
      await tx.auditLog.create({ data: { clientId, actorId, action: `wallet.hold.${status.toLowerCase()}`, entityType: 'WalletHold', entityId: holdId } });
      return updated;
    });
  }
  async reverse(clientId: string, transactionId: string, actorId: string, key: string) {
    const original = await this.prisma.walletTransaction.findFirst({ where: { clientId, id: transactionId }, include: { entries: true } });
    if (!original) throw new NotFoundException('TRANSACTION_NOT_FOUND');
    if (original.referenceType === 'REWARD_CLAIM') throw new ConflictException('USE_REWARD_CLAIM_REVERSAL');
    if (await this.prisma.walletInvoiceAllocation.findFirst({ where: { clientId, transactionId } })) throw new ConflictException('INVOICE_SETTLEMENT_REQUIRES_BILLING_REVERSAL');
    if (original.status === 'REVERSED') {
      const previous = await this.prisma.walletTransaction.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
      if (previous?.parentTransactionId === original.id && previous.transactionType === 'REVERSAL') return previous;
      throw new ConflictException('TRANSACTION_ALREADY_REVERSED');
    }
    if (original.status !== 'POSTED' || original.transactionType === 'REVERSAL') throw new ConflictException('TRANSACTION_NOT_REVERSIBLE');
    const reversal = await this.post({ clientId, walletId: original.walletId, actorId, type: WalletTransactionType.REVERSAL, amount: original.amount.toFixed(2), currency: original.currency, description: `Reversal of ${original.transactionNumber}`, idempotencyKey: key, parentTransactionId: original.id, entries: original.entries.map(e => ({ accountId: e.accountId, entryType: e.entryType === 'CREDIT' ? 'DEBIT' : 'CREDIT', amount: e.amount.toFixed(2) })) });
    return reversal;
  }
  transactions(clientId: string, walletId: string, page: number, pageSize: number) { return this.prisma.walletTransaction.findMany({ where: { clientId, walletId }, select: { id: true, transactionNumber: true, transactionType: true, status: true, amount: true, currency: true, description: true, referenceType: true, referenceId: true, createdAt: true, postedAt: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }); }
  transaction(clientId: string, walletId: string, id: string) { return this.prisma.walletTransaction.findFirst({ where: { clientId, walletId, id }, select: { id: true, transactionNumber: true, transactionType: true, status: true, amount: true, currency: true, description: true, referenceType: true, referenceId: true, createdAt: true, postedAt: true } }); }
  async ledger(clientId: string, walletId: string, id: string) { const transaction = await this.prisma.walletTransaction.findFirst({ where: { clientId, walletId, id }, include: { entries: { orderBy: { sequence: 'asc' } } } }); if (!transaction) throw new NotFoundException('TRANSACTION_NOT_FOUND'); return transaction; }
}
