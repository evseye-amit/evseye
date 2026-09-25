import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralCampaignStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CampaignDto, ListCampaignsDto } from './dto/referral.dto.js';
import { ReferralAccessService } from './referral-access.service.js';

const money = (value: string) => new Prisma.Decimal(value);
const invalid = (message: string) => new BadRequestException({ code: 'REFERRAL_CAMPAIGN_INVALID', message });

@Injectable()
export class ReferralCampaignService {
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService, private readonly audit: AuditService) {}

  private validated(dto: CampaignDto) {
    const startAt = new Date(dto.startAt); const endAt = new Date(dto.endAt);
    if (startAt >= endAt) throw invalid('Campaign end must be after its start.');
    const referrer = money(dto.referrerRewardValue); const referee = money(dto.refereeRewardValue);
    if (referrer.isNegative() || referee.isNegative()) throw invalid('Reward values cannot be negative.');
    if ((referrer.gt(0) && !dto.referrerRewardType) || (referee.gt(0) && !dto.refereeRewardType)) throw invalid('A positive reward requires a reward type.');
    if (dto.campaignBudget !== undefined && (money(dto.campaignBudget).isNegative() || money(dto.campaignBudget).lt(referrer.plus(referee)))) throw invalid('Campaign budget must cover at least one qualified referral.');
    if (dto.maxRewardPerRider !== undefined && (money(dto.maxRewardPerRider).isNegative() || money(dto.maxRewardPerRider).lt(referrer))) throw invalid('Maximum reward per Rider is below the referrer reward.');
    if (new Set(dto.milestones.map((item) => item.milestoneType)).size !== dto.milestones.length || new Set(dto.milestones.map((item) => item.sequence)).size !== dto.milestones.length) throw invalid('Milestone types and sequence numbers must be unique.');
    if (!dto.milestones.some((item) => item.mandatory !== false)) throw invalid('At least one mandatory milestone is required.');
    for (const item of dto.milestones) {
      const target = money(item.targetValue);
      if (!target.isFinite() || target.lte(0)) throw invalid('Milestone targets must be positive.');
      if (['KYC_VERIFIED', 'RIDER_ACTIVATED', 'VEHICLE_ALLOCATED', 'TRAINING_COMPLETED', 'FIRST_PAYMENT'].includes(item.milestoneType) && !target.eq(1)) throw invalid(`${item.milestoneType} target must equal 1.`);
    }
    return { startAt, endAt, referrer, referee };
  }

  private fields(dto: CampaignDto) {
    const checked = this.validated(dto);
    return {
      code: dto.code.toUpperCase(), name: dto.name.trim(), description: dto.description?.trim(),
      displayTitle: dto.displayTitle?.trim(), displayDescription: dto.displayDescription?.trim(),
      shareMessageTemplate: dto.shareMessageTemplate?.trim(), termsAndConditions: dto.termsAndConditions.trim(),
      startAt: checked.startAt, endAt: checked.endAt,
      registrationValidityDays: dto.registrationValidityDays, qualificationValidityDays: dto.qualificationValidityDays,
      referrerRewardType: dto.referrerRewardType ?? null, referrerRewardValue: checked.referrer,
      refereeRewardType: dto.refereeRewardType ?? null, refereeRewardValue: checked.referee,
      maxReferralsPerRider: dto.maxReferralsPerRider ?? null,
      referralLimitPeriod: dto.referralLimitPeriod ?? 'LIFETIME',
      maxQualifiedReferralsPerRider: dto.maxQualifiedReferralsPerRider ?? null,
      maxRewardPerRider: dto.maxRewardPerRider === undefined ? null : money(dto.maxRewardPerRider),
      campaignBudget: dto.campaignBudget === undefined ? null : money(dto.campaignBudget),
      currency: dto.currency ?? 'INR',
    };
  }

  async create(clientId: string, actorId: string, dto: CampaignDto) {
    await this.access.requireFeature(clientId);
    let campaign;
    try {
      campaign = await this.prisma.referralCampaign.create({ data: {
        ...this.fields(dto), clientId, createdById: actorId, updatedById: actorId,
        milestones: { create: dto.milestones.map((item) => ({ milestoneType: item.milestoneType, operator: item.operator, targetValue: money(item.targetValue), sequence: item.sequence, mandatory: item.mandatory ?? true })) },
      }, include: { milestones: { orderBy: { sequence: 'asc' } } } });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') throw new ConflictException({ code: 'REFERRAL_CAMPAIGN_DUPLICATE', message: 'Campaign code or milestone is already in use.' });
      throw cause;
    }
    await this.audit.record({ clientId, actorId, action: 'REFERRAL_CAMPAIGN_CREATED', entityType: 'ReferralCampaign', entityId: campaign.id, newData: { code: campaign.code, status: campaign.status } });
    return campaign;
  }

  async updateDraft(clientId: string, actorId: string, id: string, dto: CampaignDto) {
    await this.access.requireFeature(clientId);
    const campaign = await this.get(clientId, id);
    if (campaign.status !== ReferralCampaignStatus.DRAFT) throw new ConflictException('Active campaign rules are immutable. Duplicate the campaign to change them.');
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.referralCampaignMilestone.deleteMany({ where: { campaignId: id } });
        return tx.referralCampaign.update({ where: { id }, data: {
          ...this.fields(dto), updatedById: actorId,
          milestones: { create: dto.milestones.map((item) => ({ milestoneType: item.milestoneType, operator: item.operator, targetValue: money(item.targetValue), sequence: item.sequence, mandatory: item.mandatory ?? true })) },
        }, include: { milestones: { orderBy: { sequence: 'asc' } } } });
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') throw new ConflictException({ code: 'REFERRAL_CAMPAIGN_DUPLICATE', message: 'Campaign code or milestone is already in use.' });
      throw cause;
    }
    await this.audit.record({ clientId, actorId, action: 'REFERRAL_CAMPAIGN_UPDATED', entityType: 'ReferralCampaign', entityId: id, previousData: { code: campaign.code, status: campaign.status }, newData: { code: updated.code, status: updated.status } });
    return updated;
  }

  async get(clientId: string, id: string) {
    await this.access.requireFeature(clientId);
    const campaign = await this.prisma.referralCampaign.findFirst({ where: { id, clientId }, include: { milestones: { orderBy: { sequence: 'asc' } } } });
    if (!campaign) throw new NotFoundException({ code: 'REFERRAL_NOT_FOUND', message: 'Referral campaign not found.' });
    return campaign;
  }

  async list(clientId: string, query: ListCampaignsDto) {
    await this.access.requireFeature(clientId);
    const where: Prisma.ReferralCampaignWhereInput = { clientId, ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.referralCampaign.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { milestones: { orderBy: { sequence: 'asc' } } } }),
      this.prisma.referralCampaign.count({ where }),
    ]);
    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async transition(clientId: string, actorId: string, id: string, action: 'activate' | 'pause' | 'close' | 'cancel') {
    await this.access.requireFeature(clientId);
    const campaign = await this.get(clientId, id);
    const allowed: Record<typeof action, ReferralCampaignStatus[]> = {
      activate: [ReferralCampaignStatus.DRAFT, ReferralCampaignStatus.SCHEDULED, ReferralCampaignStatus.PAUSED],
      pause: [ReferralCampaignStatus.ACTIVE], close: [ReferralCampaignStatus.ACTIVE, ReferralCampaignStatus.PAUSED],
      cancel: [ReferralCampaignStatus.DRAFT, ReferralCampaignStatus.SCHEDULED, ReferralCampaignStatus.PAUSED],
    };
    if (!allowed[action].includes(campaign.status)) throw new ConflictException('This campaign status transition is not allowed.');
    const now = new Date();
    if (action === 'activate' && campaign.endAt <= now) throw new ConflictException('An expired campaign cannot be activated.');
    const status = action === 'activate' ? (campaign.startAt > now ? ReferralCampaignStatus.SCHEDULED : ReferralCampaignStatus.ACTIVE) : action === 'pause' ? ReferralCampaignStatus.PAUSED : action === 'close' ? ReferralCampaignStatus.COMPLETED : ReferralCampaignStatus.CANCELLED;
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      if (action === 'activate') {
        const overlapping = await tx.referralCampaign.findFirst({ where: { clientId, id: { not: id }, status: { in: ['ACTIVE', 'SCHEDULED'] }, startAt: { lt: campaign.endAt }, endAt: { gt: campaign.startAt } }, select: { id: true } });
        if (overlapping) throw new ConflictException('Another referral campaign overlaps this period.');
      }
      return tx.referralCampaign.updateMany({ where: { id, clientId, status: campaign.status }, data: { status, updatedById: actorId, ...(action === 'activate' && !campaign.activatedAt ? { activatedAt: now } : {}) } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (changed.count !== 1) throw new ConflictException('Campaign changed concurrently. Retry the action.');
    await this.audit.record({ clientId, actorId, action: `REFERRAL_CAMPAIGN_${action.toUpperCase()}`, entityType: 'ReferralCampaign', entityId: id, previousData: { status: campaign.status }, newData: { status } });
    return this.get(clientId, id);
  }

  async duplicate(clientId: string, actorId: string, id: string, code: string) {
    const original = await this.get(clientId, id);
    const dto: CampaignDto = {
      code, name: `${original.name} copy`, description: original.description ?? undefined,
      displayTitle: original.displayTitle ?? undefined, displayDescription: original.displayDescription ?? undefined,
      shareMessageTemplate: original.shareMessageTemplate ?? undefined, termsAndConditions: original.termsAndConditions,
      startAt: new Date().toISOString(), endAt: new Date(Math.max(Date.now() + 86400000, original.endAt.getTime() + 86400000)).toISOString(),
      registrationValidityDays: original.registrationValidityDays, qualificationValidityDays: original.qualificationValidityDays,
      referrerRewardType: original.referrerRewardType ?? undefined, referrerRewardValue: original.referrerRewardValue.toString(),
      refereeRewardType: original.refereeRewardType ?? undefined, refereeRewardValue: original.refereeRewardValue.toString(),
      maxReferralsPerRider: original.maxReferralsPerRider ?? undefined, maxQualifiedReferralsPerRider: original.maxQualifiedReferralsPerRider ?? undefined,
      referralLimitPeriod: original.referralLimitPeriod,
      maxRewardPerRider: original.maxRewardPerRider?.toString(), campaignBudget: original.campaignBudget?.toString(), currency: original.currency,
      milestones: original.milestones.map((item) => ({ milestoneType: item.milestoneType, operator: item.operator, targetValue: item.targetValue.toString(), sequence: item.sequence, mandatory: item.mandatory })),
    };
    return this.create(clientId, actorId, dto);
  }
}
