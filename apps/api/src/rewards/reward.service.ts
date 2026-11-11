import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { RewardPostingService } from './reward-posting.service.js';

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService, private readonly posting: RewardPostingService) {}

  async approve(clientId: string, claimId: string, actorId: string) {
    const claim = await this.prisma.rewardClaim.findFirst({ where: { id: claimId, clientId } });
    if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, claim.riderId, actorId);
    return this.wallet.locked(wallet.id, async tx => {
      await tx.$queryRaw`SELECT id FROM "RewardClaim" WHERE id = ${claimId} AND "clientId" = ${clientId} FOR UPDATE`;
      const current = await tx.rewardClaim.findFirstOrThrow({ where: { id: claimId, clientId } });
      if (current.status === 'CREDITED') return current;
      if (current.status !== 'APPROVAL_PENDING' && current.status !== 'APPROVED') throw new ConflictException('REWARD_APPROVAL_NOT_ALLOWED');
      if (current.status === 'APPROVAL_PENDING') {
        await tx.rewardClaim.update({ where: { id: claimId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actorId } });
        await tx.rewardEvent.create({ data: { clientId, claimId, type: 'REWARD_APPROVED' } });
        await tx.auditLog.create({ data: { clientId, actorId, action: 'REWARD_APPROVED', entityType: 'RewardClaim', entityId: claimId } });
      }
      return this.posting.postInTransaction(tx, clientId, claimId, actorId);
    });
  }

  async reject(clientId: string, claimId: string, actorId: string, reason: string) {
    if (!reason?.trim() || reason.length > 500) throw new BadRequestException('REWARD_REASON_REQUIRED');
    return this.prisma.$transaction(async tx => {
      const claim = await tx.rewardClaim.findFirst({ where: { id: claimId, clientId } });
      if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
      if (claim.status !== 'APPROVAL_PENDING') throw new ConflictException('REWARD_REJECTION_NOT_ALLOWED');
      const changed = await tx.rewardClaim.updateMany({ where: { id: claimId, clientId, status: 'APPROVAL_PENDING' }, data: { status: 'REJECTED', rejectionReason: reason.trim() } });
      if (!changed.count) throw new ConflictException('REWARD_CHANGED_CONCURRENTLY');
      await tx.rewardEvent.create({ data: { clientId, claimId, type: 'REWARD_REJECTED', payload: { reason: reason.trim() } } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'REWARD_REJECTED', entityType: 'RewardClaim', entityId: claimId, newData: { reason: reason.trim() } } });
      return tx.rewardClaim.findUniqueOrThrow({ where: { id: claimId } });
    });
  }

  async cancel(clientId: string, claimId: string, actorId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('REWARD_REASON_REQUIRED');
    return this.prisma.$transaction(async tx => {
      const claim = await tx.rewardClaim.findFirst({ where: { id: claimId, clientId } });
      if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
      if (!['PENDING', 'APPROVAL_PENDING', 'APPROVED'].includes(claim.status) || claim.walletTransactionId) throw new ConflictException('REWARD_CANCELLATION_NOT_ALLOWED');
      const changed = await tx.rewardClaim.updateMany({ where: { id: claimId, clientId, status: claim.status, walletTransactionId: null }, data: { status: 'CANCELLED', cancelledAt: new Date(), rejectionReason: reason.trim() } });
      if (!changed.count) throw new ConflictException('REWARD_CHANGED_CONCURRENTLY');
      await tx.rewardEvent.create({ data: { clientId, claimId, type: 'REWARD_CANCELLED', payload: { reason: reason.trim() } } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'REWARD_CANCELLED', entityType: 'RewardClaim', entityId: claimId, newData: { reason: reason.trim() } } });
      return tx.rewardClaim.findUniqueOrThrow({ where: { id: claimId } });
    });
  }

  async reverse(clientId: string, claimId: string, actorId: string, reason: string) {
    if (!reason?.trim() || reason.length > 500) throw new BadRequestException('REWARD_REASON_REQUIRED');
    const claim = await this.prisma.rewardClaim.findFirst({ where: { id: claimId, clientId } });
    if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, claim.riderId, actorId);
    return this.wallet.locked(wallet.id, async tx => {
      await tx.$queryRaw`SELECT id FROM "RewardClaim" WHERE id = ${claimId} AND "clientId" = ${clientId} FOR UPDATE`;
      const current = await tx.rewardClaim.findFirstOrThrow({ where: { id: claimId, clientId } });
      if (current.status === 'REVERSED') return current;
      if (current.status !== 'CREDITED') throw new ConflictException('REWARD_REVERSAL_NOT_ALLOWED');
      const lot = await tx.rewardLot.findFirst({ where: { clientId, claimId } });
      if (!lot) throw new ConflictException('REWARD_LOT_NOT_FOUND');
      const balance = await this.wallet.balanceTx(tx, clientId, wallet.id);
      const recoverable = Prisma.Decimal.min(lot.remainingAmount, new Prisma.Decimal(balance.rewards.availableBalance));
      if (recoverable.gt(0)) {
        const accounts = await tx.walletAccount.findMany({ where: { clientId, walletId: wallet.id } });
        const reward = accounts.find(item => item.accountType === 'REWARD')!;
        const clearing = accounts.find(item => item.accountType === 'CLEARING')!;
        await this.wallet.postInTransaction(tx, { clientId, walletId: wallet.id, actorId, type: 'REVERSAL',
          amount: recoverable.toFixed(2), currency: current.currency, description: `Reverse ${current.sourceType} reward: ${reason.trim()}`,
          idempotencyKey: `reward:reverse:${claimId}`, referenceType: 'REWARD_REVERSAL', referenceId: lot.id,
          entries: [{ accountId: reward.id, entryType: 'DEBIT', amount: recoverable.toFixed(2) }, { accountId: clearing.id, entryType: 'CREDIT', amount: recoverable.toFixed(2) }],
        });
      }
      await tx.rewardLot.update({ where: { id: lot.id }, data: { remainingAmount: new Prisma.Decimal(0), status: 'REVERSED' } });
      const unrecovered = current.creditedAmount.minus(recoverable);
      const updated = await tx.rewardClaim.update({ where: { id: claimId }, data: { status: 'REVERSED', reversedAt: new Date(), unrecoveredAmount: unrecovered } });
      await tx.rewardEvent.create({ data: { clientId, claimId, type: 'REWARD_REVERSED', payload: { recovered: recoverable.toFixed(2), unrecovered: unrecovered.toFixed(2), reason: reason.trim() } } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'REWARD_REVERSED', entityType: 'RewardClaim', entityId: claimId, newData: { recovered: recoverable.toFixed(2), unrecovered: unrecovered.toFixed(2), reason: reason.trim() } } });
      return updated;
    });
  }

  async expire(limit = 100, now = new Date()) {
    const lots = await this.prisma.rewardLot.findMany({ where: { status: 'AVAILABLE', expiresAt: { lte: now }, remainingAmount: { gt: 0 } }, orderBy: { expiresAt: 'asc' }, take: limit });
    let expired = 0;
    for (const candidate of lots) {
      try {
        const wallet = await this.wallet.ensure(candidate.clientId, candidate.riderId, 'SYSTEM');
        await this.wallet.locked(wallet.id, async tx => {
          const lot = await tx.rewardLot.findFirst({ where: { id: candidate.id, clientId: candidate.clientId, status: 'AVAILABLE', expiresAt: { lte: now } } });
          if (!lot || lot.remainingAmount.lte(0)) return;
          const balance = await this.wallet.balanceTx(tx, candidate.clientId, wallet.id);
          if (new Prisma.Decimal(balance.rewards.availableBalance).lt(lot.remainingAmount)) throw new ConflictException('REWARD_EXPIRY_BALANCE_MISMATCH');
          const accounts = await tx.walletAccount.findMany({ where: { clientId: candidate.clientId, walletId: wallet.id } });
          const reward = accounts.find(item => item.accountType === 'REWARD')!;
          const clearing = accounts.find(item => item.accountType === 'CLEARING')!;
          const amount = lot.remainingAmount.toFixed(2);
          await this.wallet.postInTransaction(tx, { clientId: candidate.clientId, walletId: wallet.id, actorId: 'SYSTEM', type: 'REWARD', amount,
            currency: wallet.currency, description: `Expired reward ${lot.claimId}`, idempotencyKey: `reward:expire:${lot.id}`,
            referenceType: 'REWARD_EXPIRY', referenceId: lot.id,
            entries: [{ accountId: reward.id, entryType: 'DEBIT', amount }, { accountId: clearing.id, entryType: 'CREDIT', amount }],
          });
          await tx.rewardClaim.updateMany({ where: { id: lot.claimId, clientId: candidate.clientId, status: 'CREDITED' }, data: { status: 'EXPIRED' } });
          await tx.rewardEvent.create({ data: { clientId: candidate.clientId, claimId: lot.claimId, type: 'REWARD_EXPIRED', payload: { amount } } });
          await tx.auditLog.create({ data: { clientId: candidate.clientId, actorId: null, action: 'REWARD_EXPIRED', entityType: 'RewardClaim', entityId: lot.claimId, newData: { amount } } });
          expired++;
        });
      } catch (cause) { this.logger.warn(`Reward expiry pending for lot ${candidate.id}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    return { scanned: lots.length, expired };
  }
  @Cron(CronExpression.EVERY_HOUR)
  async runExpiry() { await this.expire(); }
}
