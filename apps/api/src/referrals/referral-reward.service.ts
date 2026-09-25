import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralRewardStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReferralAccessService } from './referral-access.service.js';
import { ListRewardsDto } from './dto/referral.dto.js';

@Injectable()
export class ReferralRewardService {
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService) {}

  async list(clientId: string, query: ListRewardsDto) {
    await this.access.requireFeature(clientId);
    const where: Prisma.ReferralRewardWhereInput = { clientId, ...(query.status ? { status: query.status } : {}), ...(query.campaignId ? { campaignId: query.campaignId } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.referralReward.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { payout: true, beneficiaryRider: { select: { name: true, riderCode: true } } } }),
      this.prisma.referralReward.count({ where }),
    ]);
    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async transition(clientId: string, actorId: string, rewardId: string, action: 'approve' | 'reject' | 'processing', reason?: string) {
    await this.access.requireFeature(clientId);
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.referralReward.findFirst({ where: { id: rewardId, clientId }, select: { id: true, campaignId: true, referralId: true, status: true, amount: true } });
      if (!reward) throw new NotFoundException('Referral reward not found.');
      const allowed: ReferralRewardStatus[] = action === 'processing' ? [ReferralRewardStatus.APPROVED] : [ReferralRewardStatus.EARNED, ReferralRewardStatus.UNDER_REVIEW];
      if (!allowed.includes(reward.status)) throw new ConflictException({ code: 'REFERRAL_REWARD_ALREADY_PROCESSED', message: 'Reward cannot make this transition.' });
      if (action === 'reject' && !reason?.trim()) throw new ConflictException('A rejection reason is required.');
      const status = action === 'approve' ? ReferralRewardStatus.APPROVED : action === 'processing' ? ReferralRewardStatus.PROCESSING : ReferralRewardStatus.REJECTED;
      const changed = await tx.referralReward.updateMany({ where: { id: rewardId, clientId, status: reward.status }, data: { status, ...(action === 'approve' ? { approvedAt: new Date(), approvedById: actorId } : {}), ...(action === 'reject' ? { rejectedAt: new Date(), rejectionReason: reason!.trim() } : {}) } });
      if (changed.count !== 1) throw new ConflictException('Reward changed concurrently.');
      if (action === 'reject') await tx.referralCampaign.update({ where: { id: reward.campaignId }, data: { budgetReserved: { decrement: reward.amount } } });
      if (action === 'approve' && !await tx.referralReward.count({ where: { referralId: reward.referralId, clientId, status: { in: ['EARNED', 'UNDER_REVIEW'] } } })) await tx.referral.updateMany({ where: { id: reward.referralId, clientId, status: 'REWARD_PENDING' }, data: { status: 'REWARD_APPROVED' } });
      await tx.auditLog.create({ data: { clientId, actorId, action: `REFERRAL_REWARD_${action.toUpperCase()}`, entityType: 'ReferralReward', entityId: rewardId, previousData: { status: reward.status }, newData: { status, ...(reason ? { reason: reason.trim() } : {}) } } });
      await tx.referralNotificationOutbox.create({ data: { clientId, referralId: reward.referralId, eventKey: `${action}:${reward.id}`, eventType: `REFERRAL_REWARD_${action.toUpperCase()}`, payload: { rewardId: reward.id, status } } });
      return tx.referralReward.findUniqueOrThrow({ where: { id: rewardId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async markPaid(clientId: string, actorId: string, rewardId: string, paymentReference: string, paymentMethod: string) {
    await this.access.requireFeature(clientId);
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.referralReward.findFirst({ where: { id: rewardId, clientId }, select: { id: true, status: true, amount: true, currency: true, referralId: true } });
      if (!reward) throw new NotFoundException('Referral reward not found.');
      if (reward.status !== ReferralRewardStatus.PROCESSING) throw new ConflictException({ code: 'REFERRAL_REWARD_ALREADY_PROCESSED', message: 'Only a processing reward can be marked paid.' });
      const changed = await tx.referralReward.updateMany({ where: { id: rewardId, clientId, status: 'PROCESSING' }, data: { status: 'PAID' } });
      if (changed.count !== 1) throw new ConflictException('Reward changed concurrently.');
      const payout = await tx.referralPayout.create({ data: { clientId, rewardId, paymentReference: paymentReference.trim(), paymentMethod: paymentMethod.trim(), amount: reward.amount, currency: reward.currency, markedPaidById: actorId } });
      if (!await tx.referralReward.count({ where: { referralId: reward.referralId, clientId, status: { notIn: ['PAID', 'REJECTED', 'CANCELLED'] } } })) await tx.referral.updateMany({ where: { id: reward.referralId, clientId, status: { in: ['REWARD_PENDING', 'REWARD_APPROVED'] } }, data: { status: 'PAID' } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'REFERRAL_REWARD_PAID', entityType: 'ReferralReward', entityId: rewardId, previousData: { status: reward.status }, newData: { status: 'PAID', paymentReference: paymentReference.trim(), paymentMethod: paymentMethod.trim() } } });
      await tx.referralNotificationOutbox.create({ data: { clientId, referralId: reward.referralId, eventKey: `paid:${reward.id}`, eventType: 'REFERRAL_REWARD_PAID', payload: { rewardId: reward.id } } });
      return { rewardId, payout };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
