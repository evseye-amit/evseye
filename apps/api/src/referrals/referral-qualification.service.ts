import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ReferralMilestoneOperator, ReferralMilestoneType, ReferralStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReferralAccessService } from './referral-access.service.js';

const decimal = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);
const complete = (current: Prisma.Decimal, target: Prisma.Decimal, operator: ReferralMilestoneOperator) => {
  if (operator === 'EQ') return current.eq(target);
  if (operator === 'GT') return current.gt(target);
  if (operator === 'LT') return current.lt(target);
  if (operator === 'LTE') return current.lte(target);
  return current.gte(target);
};

@Injectable()
export class ReferralQualificationService {
  private readonly logger = new Logger(ReferralQualificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService, private readonly audit: AuditService) {}

  private async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }); }
      catch (cause) {
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034' && attempt < 2) continue;
        throw cause;
      }
    }
    throw new ConflictException('Concurrent referral update could not complete.');
  }

  async recordEvent(clientId: string, riderId: string, milestoneType: ReferralMilestoneType, sourceEventId: string, quantity: string, occurredAt = new Date()) {
    await this.access.requireFeature(clientId);
    const amount = decimal(quantity);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 4) throw new BadRequestException('Referral activity quantity must be positive with at most four decimal places.');
    const referral = await this.prisma.referral.findFirst({ where: { clientId, refereeRiderId: riderId, registeredAt: { not: null } }, select: { id: true } });
    if (!referral) return { processed: false, reason: 'NO_REFERRAL' };
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referral.id} AND "clientId" = ${clientId} FOR UPDATE`;
      const row = await tx.referral.findFirst({ where: { id: referral.id, clientId }, include: { progress: true } });
      if (!row || !['REGISTERED', 'KYC_VERIFIED', 'ACTIVATED', 'MILESTONE_IN_PROGRESS', 'FRAUD_SUSPECTED'].includes(row.status)) return { processed: false, reason: 'NOT_ELIGIBLE' };
      if (row.qualificationDeadlineAt && occurredAt > row.qualificationDeadlineAt) return { processed: false, reason: 'EXPIRED' };
      const milestone = row.progress.find((item) => item.milestoneType === milestoneType);
      if (!milestone) return { processed: false, reason: 'MILESTONE_NOT_CONFIGURED' };
      const inserted = await tx.referralActivityEvent.createMany({ data: [{ clientId, referralId: row.id, sourceEventId, milestoneType, quantity: amount, occurredAt }], skipDuplicates: true });
      if (!inserted.count) return { processed: false, reason: 'DUPLICATE_EVENT' };
      const currentValue = ['KYC_VERIFIED', 'RIDER_ACTIVATED', 'VEHICLE_ALLOCATED', 'TRAINING_COMPLETED', 'FIRST_PAYMENT'].includes(milestoneType) ? decimal(1) : milestone.currentValue.plus(amount);
      await tx.referralMilestoneProgress.update({ where: { id: milestone.id }, data: { currentValue, completedAt: complete(currentValue, milestone.targetValue, milestone.operator) ? occurredAt : null } });
      const status = milestoneType === 'KYC_VERIFIED' ? ReferralStatus.KYC_VERIFIED : milestoneType === 'RIDER_ACTIVATED' ? ReferralStatus.ACTIVATED : ReferralStatus.MILESTONE_IN_PROGRESS;
      await tx.referral.update({ where: { id: row.id }, data: { status: row.status === 'FRAUD_SUSPECTED' ? row.status : status, ...(milestoneType === 'KYC_VERIFIED' ? { kycVerifiedAt: occurredAt } : {}), ...(milestoneType === 'RIDER_ACTIVATED' ? { activatedAt: occurredAt } : {}) } });
      await tx.referralNotificationOutbox.create({ data: { clientId, referralId: row.id, eventKey: `progress:${clientId}:${sourceEventId}`, eventType: 'REFERRAL_PROGRESS_UPDATED', payload: { milestoneType, currentValue: currentValue.toString(), targetValue: milestone.targetValue.toString() } } });
      const qualified = await this.qualifyInTransaction(tx, clientId, row.id, false);
      return { processed: true, qualified, referralId: row.id, currentValue: currentValue.toString() };
    });
  }

  private async qualifyInTransaction(tx: Prisma.TransactionClient, clientId: string, referralId: string, force: boolean) {
    const row = await tx.referral.findFirst({ where: { id: referralId, clientId }, include: { progress: true, campaign: true } });
    if (!row || !row.refereeRiderId || !row.registeredAt || ['QUALIFIED', 'REWARD_PENDING', 'REWARD_APPROVED', 'PAID', 'EXPIRED', 'REJECTED', 'DISQUALIFIED', 'CANCELLED'].includes(row.status)) return false;
    if (row.qualificationDeadlineAt && row.qualificationDeadlineAt < new Date()) return false;
    if (row.status === ReferralStatus.FRAUD_SUSPECTED) return false;
    if (!force && !row.progress.filter((item) => item.mandatory).every((item) => item.completedAt !== null)) return false;
    // Locking the campaign serializes budget and per-referrer limit checks across all its referrals.
    await tx.$queryRaw`SELECT id FROM "ReferralCampaign" WHERE id = ${row.campaignId} AND "clientId" = ${clientId} FOR UPDATE`;
    const campaign = await tx.referralCampaign.findFirst({ where: { id: row.campaignId, clientId } });
    if (!campaign) return false;
    const snapshot = row.ruleSnapshot as Record<string, unknown>;
    const referrerAmount = decimal(String(snapshot.referrerRewardValue ?? 0));
    const refereeAmount = decimal(String(snapshot.refereeRewardValue ?? 0));
    const reserve = referrerAmount.plus(refereeAmount);
    if (campaign.campaignBudget && campaign.budgetReserved.plus(reserve).gt(campaign.campaignBudget)) throw new ConflictException({ code: 'REFERRAL_BUDGET_EXCEEDED', message: 'Campaign reward budget is exhausted.' });
    if (campaign.maxQualifiedReferralsPerRider !== null) {
      const count = await tx.referral.count({ where: { clientId, campaignId: row.campaignId, referrerRiderId: row.referrerRiderId, qualifiedAt: { not: null } } });
      if (count >= campaign.maxQualifiedReferralsPerRider) throw new ConflictException({ code: 'REFERRAL_LIMIT_EXCEEDED', message: 'Qualified referral limit reached.' });
    }
    if (campaign.maxRewardPerRider !== null) {
      const sum = await tx.referralReward.aggregate({ where: { clientId, campaignId: row.campaignId, beneficiaryRiderId: row.referrerRiderId, beneficiary: 'REFERRER', status: { notIn: ['REJECTED', 'CANCELLED', 'REVERSED'] } }, _sum: { amount: true } });
      if (decimal(sum._sum.amount ?? 0).plus(referrerAmount).gt(campaign.maxRewardPerRider)) throw new ConflictException({ code: 'REFERRAL_LIMIT_EXCEEDED', message: 'Maximum reward per Rider reached.' });
    }
    const changed = await tx.referral.updateMany({ where: { id: row.id, clientId, qualifiedAt: null, status: row.status }, data: { status: ReferralStatus.REWARD_PENDING, qualifiedAt: new Date() } });
    if (changed.count !== 1) return false;
    if (reserve.gt(0)) await tx.referralCampaign.update({ where: { id: campaign.id }, data: { budgetReserved: { increment: reserve } } });
    const rewards = [
      { beneficiary: 'REFERRER' as const, beneficiaryRiderId: row.referrerRiderId, amount: referrerAmount, rewardType: snapshot.referrerRewardType },
      { beneficiary: 'REFEREE' as const, beneficiaryRiderId: row.refereeRiderId, amount: refereeAmount, rewardType: snapshot.refereeRewardType },
    ].filter((item) => item.amount.gt(0) && typeof item.rewardType === 'string');
    for (const reward of rewards) await tx.referralReward.create({ data: { clientId, referralId: row.id, campaignId: row.campaignId, beneficiaryRiderId: reward.beneficiaryRiderId, beneficiary: reward.beneficiary, rewardType: reward.rewardType as never, amount: reward.amount, currency: campaign.currency } });
    await tx.referralNotificationOutbox.create({ data: { clientId, referralId: row.id, eventKey: `qualified:${row.id}`, eventType: 'REFERRAL_QUALIFIED', payload: { referralId: row.id, rewardCount: rewards.length } } });
    return true;
  }

  async manuallyQualify(clientId: string, actorId: string, referralId: string, reason: string) {
    await this.access.requireFeature(clientId);
    const qualified = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referralId} AND "clientId" = ${clientId} FOR UPDATE`;
      return this.qualifyInTransaction(tx, clientId, referralId, true);
    });
    if (!qualified) throw new ConflictException('Referral is not eligible for manual qualification.');
    await this.audit.record({ clientId, actorId, action: 'REFERRAL_MANUALLY_QUALIFIED', entityType: 'Referral', entityId: referralId, newData: { reason: reason.trim() } });
    return { qualified: true };
  }

  async recheck(clientId: string, referralId: string) {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referralId} AND "clientId" = ${clientId} FOR UPDATE`;
      return this.qualifyInTransaction(tx, clientId, referralId, false);
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireAndReconcile() {
    const now = new Date();
    const campaigns = await this.prisma.referralCampaign.findMany({ where: { status: 'SCHEDULED', startAt: { lte: now }, endAt: { gt: now } }, select: { id: true } });
    for (const campaign of campaigns) await this.prisma.referralCampaign.updateMany({ where: { id: campaign.id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } });
    await this.prisma.referralCampaign.updateMany({ where: { status: { in: ['ACTIVE', 'SCHEDULED'] }, endAt: { lte: now } }, data: { status: 'COMPLETED' } });
    const rows = await this.prisma.referral.findMany({ where: { status: { in: ['INVITED', 'REGISTERED', 'KYC_VERIFIED', 'ACTIVATED', 'MILESTONE_IN_PROGRESS'] }, OR: [{ registeredAt: null, expiresAt: { lt: now } }, { qualificationDeadlineAt: { lt: now } }] }, select: { id: true, clientId: true, status: true }, take: 200 });
    for (const row of rows) {
      const changed = await this.prisma.referral.updateMany({ where: { id: row.id, clientId: row.clientId, status: row.status }, data: { status: 'EXPIRED' } });
      if (changed.count) await this.prisma.referralNotificationOutbox.create({ data: { clientId: row.clientId, referralId: row.id, eventKey: `expired:${row.id}`, eventType: 'REFERRAL_EXPIRED', payload: { referralId: row.id } } }).catch((cause: unknown) => this.logger.error('Referral expiry notification enqueue failed', cause));
    }
    // Reconcile facts that already exist in EVsEye; ride/delivery counts require a trusted upstream event source.
    const pending = await this.prisma.referral.findMany({ where: { refereeRiderId: { not: null }, status: { in: ['REGISTERED', 'KYC_VERIFIED', 'ACTIVATED', 'MILESTONE_IN_PROGRESS'] } }, select: { id: true, clientId: true, refereeRiderId: true, progress: { select: { milestoneType: true, completedAt: true } } }, take: 200 });
    for (const row of pending) {
      if (!row.refereeRiderId) continue;
      try {
        const needed = new Set(row.progress.filter((item) => !item.completedAt).map((item) => item.milestoneType));
        if (needed.has('KYC_VERIFIED') && await this.prisma.riderKyc.count({ where: { clientId: row.clientId, riderId: row.refereeRiderId, status: 'VERIFIED' } })) await this.recordEvent(row.clientId, row.refereeRiderId, 'KYC_VERIFIED', `kyc-reconcile:${row.id}`, '1');
        if (needed.has('RIDER_ACTIVATED') && await this.prisma.rider.count({ where: { clientId: row.clientId, id: row.refereeRiderId, status: 'ACTIVE' } })) await this.recordEvent(row.clientId, row.refereeRiderId, 'RIDER_ACTIVATED', `activation-reconcile:${row.id}`, '1');
        if (needed.has('VEHICLE_ALLOCATED') && await this.prisma.allocation.count({ where: { clientId: row.clientId, riderId: row.refereeRiderId, status: 'ACTIVE' } })) await this.recordEvent(row.clientId, row.refereeRiderId, 'VEHICLE_ALLOCATED', `allocation-reconcile:${row.id}`, '1');
        if (!needed.size) await this.recheck(row.clientId, row.id);
      } catch (cause) { this.logger.error(`Referral reconciliation failed for ${row.id}`, cause); }
    }
  }
}
