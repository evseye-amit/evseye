import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';

@Injectable()
export class RewardPostingService {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService) {}

  async post(clientId: string, claimId: string, actorId = 'SYSTEM') {
    const claim = await this.prisma.rewardClaim.findFirst({ where: { id: claimId, clientId } });
    if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, claim.riderId, actorId);
    return this.wallet.locked(wallet.id, tx => this.postInTransaction(tx, clientId, claimId, actorId));
  }

  async postInTransaction(tx: Prisma.TransactionClient, clientId: string, claimId: string, actorId = 'SYSTEM') {
    await tx.$queryRaw`SELECT id FROM "RewardClaim" WHERE id = ${claimId} AND "clientId" = ${clientId} FOR UPDATE`;
    const claim = await tx.rewardClaim.findFirst({ where: { id: claimId, clientId }, include: { program: true, rule: true } });
    if (!claim) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
    if (claim.status === 'CREDITED') return claim;
    if (claim.status !== 'APPROVED') throw new ConflictException('REWARD_NOT_APPROVED');
    if (claim.expiresAt && claim.expiresAt <= new Date()) throw new ConflictException('REWARD_EXPIRED');
    const wallet = await tx.riderWallet.findFirst({ where: { clientId, riderId: claim.riderId, currency: claim.currency } });
    if (!wallet) throw new ConflictException('REWARD_WALLET_NOT_FOUND');
    const accounts = await tx.walletAccount.findMany({ where: { clientId, walletId: wallet.id } });
    const reward = accounts.find(item => item.accountType === 'REWARD' && item.status === 'ACTIVE');
    const clearing = accounts.find(item => item.accountType === 'CLEARING' && item.status === 'ACTIVE');
    if (!reward || !clearing) throw new ConflictException('REWARD_ACCOUNT_NOT_FOUND');
    const amount = claim.calculatedAmount.toFixed(2);
    const transaction = await this.wallet.postInTransaction(tx, { clientId, walletId: wallet.id, actorId,
      type: claim.sourceType === 'REFERRAL' ? 'REFERRAL_REWARD' : claim.sourceType === 'SELF_SUBMISSION' ? 'SELF_SUBMISSION_REWARD' : 'REWARD',
      amount, currency: claim.currency, description: claim.program.name,
      idempotencyKey: `reward:claim:${claim.id}`, referenceType: 'REWARD_CLAIM', referenceId: claim.id,
      entries: [{ accountId: clearing.id, entryType: 'DEBIT', amount }, { accountId: reward.id, entryType: 'CREDIT', amount }],
    });
    await tx.rewardLot.create({ data: { clientId, riderId: claim.riderId, claimId: claim.id,
      originalAmount: claim.calculatedAmount, remainingAmount: claim.calculatedAmount, expiresAt: claim.expiresAt } });
    const updated = await tx.rewardClaim.update({ where: { id: claim.id }, data: {
      status: 'CREDITED', creditedAmount: claim.calculatedAmount, creditedAt: new Date(), walletTransactionId: transaction.id,
    } });
    await tx.rewardEvent.create({ data: { clientId, claimId, type: 'REWARD_CREDITED', payload: { walletTransactionId: transaction.id, amount } } });
    await tx.auditLog.create({ data: { clientId, actorId: actorId === 'SYSTEM' ? null : actorId, action: 'REWARD_CREDITED',
      entityType: 'RewardClaim', entityId: claim.id, newData: { riderId: claim.riderId, programId: claim.programId, ruleId: claim.ruleId, amount, walletTransactionId: transaction.id } } });
    return updated;
  }
}
