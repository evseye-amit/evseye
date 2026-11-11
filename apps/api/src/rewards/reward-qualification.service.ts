import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const D = Prisma.Decimal;
const active = (from: Date, until: Date | null, now: Date) => from <= now && (!until || until > now);

@Injectable()
export class RewardQualificationService {
  constructor(private readonly prisma: PrismaService) {}

  async qualify(clientId: string, riderId: string, triggerType: 'SELF_SUBMISSION_APPROVED' | 'MANUAL', sourceId: string, actorId: string, requestedAmount?: string, reason?: string) {
    if (!sourceId || sourceId.length > 120) throw new BadRequestException('REWARD_SOURCE_REQUIRED');
    const sourceType = triggerType === 'MANUAL' ? 'MANUAL' : 'SELF_SUBMISSION';
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const now = new Date();
          const rider = await tx.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null, status: 'ACTIVE' } });
          if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');
          const prior = await tx.rewardClaim.findUnique({ where: { clientId_sourceType_sourceId: { clientId, sourceType, sourceId } } });
          if (prior) {
            const snapshot = prior.snapshot as Record<string, unknown>;
            if (prior.riderId !== riderId || (requestedAmount && !prior.calculatedAmount.eq(requestedAmount)) || (reason && snapshot.reason !== reason.trim())) throw new ConflictException('REWARD_SOURCE_DUPLICATE');
            return prior;
          }
          const rules = await tx.rewardRule.findMany({ where: { clientId, triggerType, isActive: true, program: { type: triggerType === 'MANUAL' ? 'MANUAL' : 'SELF_SUBMISSION', status: 'ACTIVE' } }, include: { program: true }, orderBy: { createdAt: 'asc' } });
          const rule = rules.find(item => active(item.program.validFrom, item.program.validUntil, now));
          if (!rule) throw new ConflictException('REWARD_RULE_NOT_APPLICABLE');
          if (rule.expiryAt && rule.expiryAt <= now) throw new ConflictException('REWARD_RULE_EXPIRED');
          await tx.$queryRaw`SELECT id FROM "RewardProgram" WHERE id = ${rule.programId} AND "clientId" = ${clientId} FOR UPDATE`;
          const existing = await tx.rewardClaim.findUnique({ where: { clientId_sourceType_sourceId: { clientId, sourceType, sourceId } } });
          if (existing) {
            const snapshot = existing.snapshot as Record<string, unknown>;
            if (existing.riderId !== riderId || existing.ruleId !== rule.id || (requestedAmount && !existing.calculatedAmount.eq(requestedAmount)) || (reason && snapshot.reason !== reason.trim())) throw new ConflictException('REWARD_SOURCE_DUPLICATE');
            return existing;
          }
          const amount = triggerType === 'MANUAL' ? new D(requestedAmount ?? '0') : rule.rewardValue;
          if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2 || amount.gt(rule.rewardValue)) throw new BadRequestException('REWARD_AMOUNT_EXCEEDS_RULE');
          const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const counted = await tx.rewardClaim.findMany({ where: { clientId, riderId, ruleId: rule.id, createdAt: { gte: month }, status: { notIn: ['REJECTED', 'CANCELLED', 'REVERSED'] } }, select: { calculatedAmount: true } });
          if (rule.monthlyCountCap && counted.length >= rule.monthlyCountCap) throw new ConflictException('REWARD_CAP_EXCEEDED');
          if (rule.monthlyAmountCap && counted.reduce((sum, item) => sum.plus(item.calculatedAmount), new D(0)).plus(amount).gt(rule.monthlyAmountCap)) throw new ConflictException('REWARD_CAP_EXCEEDED');
          if (rule.program.totalBudget) {
            const claims = await tx.rewardClaim.findMany({ where: { clientId, programId: rule.programId, status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { status: true, calculatedAmount: true, unrecoveredAmount: true } });
            if (claims.reduce((sum, item) => sum.plus(item.status === 'REVERSED' ? item.unrecoveredAmount : item.calculatedAmount), new D(0)).plus(amount).gt(rule.program.totalBudget)) throw new ConflictException('REWARD_BUDGET_EXHAUSTED');
          }
          const expiresAt = rule.expiryAt ?? (rule.expiryDays ? new Date(now.getTime() + rule.expiryDays * 86400000) : null);
          const status = rule.approvalMode === 'AUTO' ? 'APPROVED' : 'APPROVAL_PENDING';
          const claim = await tx.rewardClaim.create({ data: { clientId, riderId, programId: rule.programId, ruleId: rule.id,
            sourceType, sourceId, status,
            currency: rule.program.currency, calculatedAmount: amount, expiresAt,
            approvedAt: status === 'APPROVED' ? now : null, approvedById: status === 'APPROVED' ? actorId : null,
            snapshot: { programCode: rule.program.code, ruleCode: rule.code, ruleVersion: rule.version, triggerType,
              rewardType: 'FIXED', configuredValue: rule.rewardValue.toFixed(2), calculatedAmount: amount.toFixed(2), currency: rule.program.currency,
              sourceId, ...(reason ? { reason: reason.trim() } : {}), calculatedAt: now.toISOString() } } });
          await tx.rewardEvent.create({ data: { clientId, claimId: claim.id, type: status === 'APPROVED' ? 'REWARD_APPROVED' : 'REWARD_APPROVAL_REQUIRED' } });
          await tx.auditLog.create({ data: { clientId, actorId, action: 'REWARD_CLAIM_CREATED', entityType: 'RewardClaim', entityId: claim.id,
            newData: { riderId, programId: rule.programId, ruleId: rule.id, sourceId, amount: amount.toFixed(2), status } } });
          return claim;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.prisma.rewardClaim.findUnique({ where: { clientId_sourceType_sourceId: { clientId, sourceType, sourceId } } });
          if (existing && existing.riderId === riderId && (!requestedAmount || existing.calculatedAmount.eq(requestedAmount)) && (!reason || (existing.snapshot as Record<string, unknown>).reason === reason.trim())) return existing;
        }
        throw error;
      }
    }
  }

  async referralClaimTx(tx: Prisma.TransactionClient, input: { clientId: string; actorId: string; reward: { id: string; beneficiaryRiderId: string; amount: Prisma.Decimal; currency: string; beneficiary: string; campaignId: string; referralId: string } }) {
    const { clientId, reward } = input;
    const campaign = await tx.referralCampaign.findFirst({ where: { id: reward.campaignId, clientId } });
    if (!campaign) throw new NotFoundException('REFERRAL_CAMPAIGN_NOT_FOUND');
    const referral = await tx.referral.findFirst({ where: { id: reward.referralId, clientId, campaignId: campaign.id }, select: { referrerRiderId: true, refereeRiderId: true, qualifiedAt: true, ruleSnapshot: true } });
    if (!referral?.qualifiedAt || !referral.refereeRiderId || referral.referrerRiderId === referral.refereeRiderId) throw new ConflictException('REFERRAL_NOT_QUALIFIED');
    const program = await tx.rewardProgram.upsert({ where: { clientId_code: { clientId, code: `REFERRAL:${campaign.id}` } }, create: {
      clientId, code: `REFERRAL:${campaign.id}`, name: campaign.name, type: 'REFERRAL', status: 'ACTIVE', currency: campaign.currency,
      validFrom: campaign.startAt, validUntil: campaign.endAt, createdById: input.actorId,
    }, update: {} });
    const rule = await tx.rewardRule.upsert({ where: { clientId_programId_code: { clientId, programId: program.id, code: reward.beneficiary } }, create: {
      clientId, programId: program.id, code: reward.beneficiary, name: `${campaign.name} ${reward.beneficiary.toLowerCase()}`,
      triggerType: 'REFERRED_RIDER_QUALIFIED', rewardValue: reward.amount, approvalMode: 'MANUAL_APPROVAL',
    }, update: {} });
    const existing = await tx.rewardClaim.findUnique({ where: { clientId_sourceType_sourceId: { clientId, sourceType: 'REFERRAL', sourceId: reward.id } } });
    if (existing) return existing;
    const claim = await tx.rewardClaim.create({ data: { clientId, riderId: reward.beneficiaryRiderId, programId: program.id, ruleId: rule.id,
      sourceType: 'REFERRAL', sourceId: reward.id, status: 'APPROVED', calculatedAmount: reward.amount,
      currency: reward.currency, approvedAt: new Date(), approvedById: input.actorId,
      snapshot: { referralId: reward.referralId, campaignId: campaign.id, campaignSnapshot: referral.ruleSnapshot as Prisma.InputJsonValue,
        ruleVersion: rule.version, beneficiary: reward.beneficiary, calculatedAmount: reward.amount.toFixed(2), currency: reward.currency } } });
    await tx.rewardEvent.create({ data: { clientId, claimId: claim.id, type: 'REWARD_APPROVED' } });
    return claim;
  }
}
