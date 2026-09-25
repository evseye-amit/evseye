import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralAttributionSource, ReferralCampaignStatus, ReferralStatus, RiderStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AttributionDto, ListReferralNotificationsDto, ListReferralsDto } from './dto/referral.dto.js';
import { ReferralAccessService } from './referral-access.service.js';
import { ReferralLinkService } from './referral-link.service.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeCandidate = () => `EVS-${Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join('')}`;
const error = (code: string, message: string) => new BadRequestException({ code, message });
const maskMobile = (mobile: string) => mobile.length < 4 ? '****' : `${'*'.repeat(Math.max(0, mobile.length - 4))}${mobile.slice(-4)}`;
const safeRider = (rider: { name: string; mobile: string } | null) => rider ? { firstName: rider.name.trim().split(/\s+/)[0], maskedMobile: maskMobile(rider.mobile) } : null;

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService, private readonly links: ReferralLinkService, private readonly audit: AuditService) {}

  async identity(clientId: string, riderId: string) {
    const existing = await this.prisma.referralIdentity.findUnique({ where: { riderId } });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.prisma.referralIdentity.create({ data: { clientId, riderId, code: codeCandidate() } }); }
      catch (cause) {
        if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== 'P2002') throw cause;
        const concurrentlyCreated = await this.prisma.referralIdentity.findUnique({ where: { riderId } });
        if (concurrentlyCreated) return concurrentlyCreated;
      }
    }
    throw new ConflictException('Unable to allocate a referral code. Retry.');
  }

  async activeCampaign(clientId: string) {
    const now = new Date();
    return this.prisma.referralCampaign.findFirst({
      where: { clientId, status: ReferralCampaignStatus.ACTIVE, startAt: { lte: now }, endAt: { gt: now } },
      orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
      include: { milestones: { where: { isActive: true }, orderBy: { sequence: 'asc' } } },
    });
  }

  private snapshot(campaign: NonNullable<Awaited<ReturnType<ReferralService['activeCampaign']>>>) {
    return {
      campaignCode: campaign.code, title: campaign.displayTitle ?? campaign.name,
      description: campaign.displayDescription ?? campaign.description,
      currency: campaign.currency, referrerRewardType: campaign.referrerRewardType,
      referrerRewardValue: campaign.referrerRewardValue.toString(),
      refereeRewardType: campaign.refereeRewardType, refereeRewardValue: campaign.refereeRewardValue.toString(),
      qualificationValidityDays: campaign.qualificationValidityDays,
      milestones: campaign.milestones.map((item) => ({ id: item.id, type: item.milestoneType, operator: item.operator, target: item.targetValue.toString(), mandatory: item.mandatory, sequence: item.sequence })),
    };
  }

  private async assertLimits(tx: Prisma.TransactionClient, clientId: string, campaign: NonNullable<Awaited<ReturnType<ReferralService['activeCampaign']>>>, referrerRiderId: string) {
    const now = new Date();
    const periodStart = campaign.referralLimitPeriod === 'MONTHLY' ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : null;
    const count = await tx.referral.count({ where: { clientId, campaignId: campaign.id, referrerRiderId, status: { notIn: [ReferralStatus.REJECTED, ReferralStatus.CANCELLED, ReferralStatus.EXPIRED] }, ...(periodStart ? { createdAt: { gte: periodStart } } : {}) } });
    if (campaign.maxReferralsPerRider !== null && count >= campaign.maxReferralsPerRider) throw error('REFERRAL_LIMIT_EXCEEDED', 'The Rider has reached the campaign referral limit.');
  }

  async home(clientId: string, userId: string) {
    await this.access.requireFeature(clientId);
    const rider = await this.access.requireRider(clientId, userId);
    const campaign = await this.activeCampaign(clientId);
    if (!campaign) return { campaign: null, referral: null, rewards: null, summary: await this.summary(clientId, rider.id) };
    const identity = await this.identity(clientId, rider.id);
    const shareLink = await this.links.shareLink(clientId, identity.code);
    const template = campaign.shareMessageTemplate ?? 'Join as a rider using my EVsEye referral. Use code {{referralCode}} or join using {{referralLink}}.';
    return {
      campaign: { code: campaign.code, title: campaign.displayTitle ?? campaign.name, description: campaign.displayDescription ?? campaign.description, terms: campaign.termsAndConditions, startAt: campaign.startAt, endAt: campaign.endAt, milestones: campaign.milestones.map((item) => ({ type: item.milestoneType, operator: item.operator, target: item.targetValue.toString(), sequence: item.sequence })) },
      referral: { code: identity.code, shareLink, qrPayload: shareLink, shareMessage: template.replaceAll('{{referralCode}}', identity.code).replaceAll('{{referralLink}}', shareLink) },
      rewards: { referrerReward: { type: campaign.referrerRewardType, value: campaign.referrerRewardValue.toString() }, refereeReward: { type: campaign.refereeRewardType, value: campaign.refereeRewardValue.toString() }, currency: campaign.currency },
      summary: await this.summary(clientId, rider.id),
    };
  }

  private async summary(clientId: string, riderId: string) {
    const [totalInvited, registered, qualified, rewards] = await Promise.all([
      this.prisma.referral.count({ where: { clientId, referrerRiderId: riderId } }),
      this.prisma.referral.count({ where: { clientId, referrerRiderId: riderId, registeredAt: { not: null } } }),
      this.prisma.referral.count({ where: { clientId, referrerRiderId: riderId, qualifiedAt: { not: null } } }),
      this.prisma.referralReward.groupBy({ by: ['status'], where: { clientId, beneficiaryRiderId: riderId }, _sum: { amount: true } }),
    ]);
    const sum = (statuses: string[]) => rewards.reduce((total, item) => statuses.includes(item.status) ? total.plus(item._sum.amount ?? 0) : total, new Prisma.Decimal(0)).toFixed(2);
    return { totalInvited, registered, qualified, totalEarned: sum(['EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID']), pendingReward: sum(['EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING']), paidReward: sum(['PAID']) };
  }

  async invite(clientId: string, userId: string) {
    await this.access.requireFeature(clientId);
    const rider = await this.access.requireRider(clientId, userId);
    if (rider.status !== RiderStatus.ACTIVE) throw error('REFERRAL_NOT_ELIGIBLE', 'Only an active Rider may invite.');
    const campaign = await this.activeCampaign(clientId);
    if (!campaign) throw error('REFERRAL_CAMPAIGN_INACTIVE', 'No active referral campaign is available.');
    const identity = await this.identity(clientId, rider.id);
    await this.links.shareLink(clientId, identity.code);
    const invitedAt = new Date();
    const expiresAt = new Date(Math.min(campaign.endAt.getTime(), invitedAt.getTime() + campaign.registrationValidityDays * 86400000));
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReferralCampaign" WHERE id = ${campaign.id} AND "clientId" = ${clientId} FOR UPDATE`;
      const stillActive = await tx.referralCampaign.count({ where: { id: campaign.id, clientId, status: 'ACTIVE', startAt: { lte: invitedAt }, endAt: { gt: invitedAt } } });
      if (!stillActive) throw error('REFERRAL_CAMPAIGN_INACTIVE', 'No active referral campaign is available.');
      await this.assertLimits(tx, clientId, campaign, rider.id);
      return tx.referral.create({ data: {
      clientId, campaignId: campaign.id, referrerRiderId: rider.id, referralCode: identity.code,
      inviteToken: randomBytes(24).toString('base64url'), attributionSource: ReferralAttributionSource.MOBILE_INVITE,
      ruleSnapshot: this.snapshot(campaign), termsSnapshot: campaign.termsAndConditions, invitedAt, expiresAt,
      progress: { create: campaign.milestones.map((item) => ({ clientId, milestoneId: item.id, milestoneType: item.milestoneType, operator: item.operator, targetValue: item.targetValue, mandatory: item.mandatory })) },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const shareLink = await this.links.shareLink(clientId, identity.code, row.inviteToken!);
    return { inviteToken: row.inviteToken, referralCode: identity.code, shareLink, qrPayload: shareLink, expiresAt };
  }

  async attribute(clientId: string, userId: string, dto: AttributionDto) {
    await this.access.requireFeature(clientId);
    const code = dto.referralCode.trim().toUpperCase();
    const identity = await this.prisma.referralIdentity.findFirst({ where: { clientId, code }, include: { rider: { select: { userId: true, mobile: true, status: true, deletedAt: true } } } });
    if (!identity || identity.rider.deletedAt || identity.rider.status !== RiderStatus.ACTIVE) throw error('REFERRAL_CODE_INVALID', 'Referral code is invalid.');
    const referee = await this.prisma.user.findFirst({ where: { id: userId, clientId, role: 'RIDER', deletedAt: null }, select: { id: true, mobile: true } });
    if (!referee) throw error('REFERRAL_NOT_ELIGIBLE', 'Rider enrollment is required before attribution.');
    if (identity.rider.userId === userId || identity.rider.mobile === referee.mobile) throw error('REFERRAL_SELF_NOT_ALLOWED', 'A Rider cannot refer themselves.');
    const current = await this.prisma.referral.findFirst({ where: { clientId, refereeUserId: userId }, select: { id: true, referrerRiderId: true } });
    if (current) {
      if (current.referrerRiderId !== identity.riderId) throw new ConflictException({ code: 'REFERRAL_ALREADY_ATTRIBUTED', message: 'This Rider already has a valid referrer.' });
      return { referralId: current.id, attributed: true, alreadyAttributed: true };
    }
    const now = new Date();
    const invite = dto.inviteToken ? await this.prisma.referral.findFirst({ where: { clientId, inviteToken: dto.inviteToken, referralCode: code, referrerRiderId: identity.riderId, refereeUserId: null, status: ReferralStatus.INVITED } }) : null;
    if (dto.inviteToken && !invite) throw error('REFERRAL_CODE_INVALID', 'Referral invitation is invalid.');
    if (invite && invite.expiresAt <= now) throw error('REFERRAL_CODE_EXPIRED', 'Referral invitation has expired.');
    const campaign = invite
      ? await this.prisma.referralCampaign.findFirst({ where: { id: invite.campaignId, clientId, status: 'ACTIVE', startAt: { lte: now }, endAt: { gt: now } }, include: { milestones: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } })
      : await this.activeCampaign(clientId);
    if (!campaign) throw error('REFERRAL_CAMPAIGN_INACTIVE', 'No active referral campaign is available.');
    const source = dto.source ?? ReferralAttributionSource.REFERRAL_CODE;
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ReferralCampaign" WHERE id = ${campaign.id} AND "clientId" = ${clientId} FOR UPDATE`;
        const stillActive = await tx.referralCampaign.count({ where: { id: campaign.id, clientId, status: 'ACTIVE', startAt: { lte: now }, endAt: { gt: now } } });
        if (!stillActive) throw error('REFERRAL_CAMPAIGN_INACTIVE', 'No active referral campaign is available.');
        if (!invite) await this.assertLimits(tx, clientId, campaign, identity.riderId);
        const rider = await tx.rider.findUnique({ where: { userId }, select: { id: true } });
        const deadline = new Date(now.getTime() + campaign.qualificationValidityDays * 86400000);
        if (invite) {
          const changed = await tx.referral.updateMany({ where: { id: invite.id, clientId, refereeUserId: null, status: ReferralStatus.INVITED }, data: { refereeUserId: userId, refereeRiderId: rider?.id, registeredAt: now, qualificationDeadlineAt: deadline, status: ReferralStatus.REGISTERED, attributionSource: source } });
          if (changed.count !== 1) throw new ConflictException({ code: 'REFERRAL_ALREADY_ATTRIBUTED', message: 'Invitation was already used.' });
          const savedInvite = await tx.referral.findUniqueOrThrow({ where: { id: invite.id } });
          await tx.referralNotificationOutbox.create({ data: { clientId, referralId: savedInvite.id, eventKey: `registered:${savedInvite.id}`, eventType: 'REFERRAL_REGISTERED', payload: { referralId: savedInvite.id } } });
          return savedInvite;
        }
        const created = await tx.referral.create({ data: {
          clientId, campaignId: campaign.id, referrerRiderId: identity.riderId, refereeUserId: userId, refereeRiderId: rider?.id,
          referralCode: code, attributionSource: source, status: ReferralStatus.REGISTERED,
          ruleSnapshot: this.snapshot(campaign), termsSnapshot: campaign.termsAndConditions,
          invitedAt: now, expiresAt: new Date(now.getTime() + campaign.registrationValidityDays * 86400000), registeredAt: now, qualificationDeadlineAt: deadline,
          progress: { create: campaign.milestones.map((item) => ({ clientId, milestoneId: item.id, milestoneType: item.milestoneType, operator: item.operator, targetValue: item.targetValue, mandatory: item.mandatory })) },
        } });
        await tx.referralNotificationOutbox.create({ data: { clientId, referralId: created.id, eventKey: `registered:${created.id}`, eventType: 'REFERRAL_REGISTERED', payload: { referralId: created.id } } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { referralId: saved.id, attributed: true, alreadyAttributed: false };
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(cause.code)) throw new ConflictException({ code: 'REFERRAL_ALREADY_ATTRIBUTED', message: 'This Rider already has a valid referrer. Retry if attribution was concurrent.' });
      throw cause;
    }
  }

  async linkRegisteredRider(clientId: string, userId: string, riderId: string) {
    await this.prisma.referral.updateMany({ where: { clientId, refereeUserId: userId, refereeRiderId: null }, data: { refereeRiderId: riderId } });
  }

  async resolvePublic(code: string) {
    const identity = await this.prisma.referralIdentity.findUnique({ where: { code: code.trim().toUpperCase() }, select: { clientId: true } });
    if (!identity) throw new NotFoundException({ code: 'REFERRAL_CODE_INVALID', message: 'Referral code is invalid.' });
    await this.access.requireFeature(identity.clientId);
    const campaign = await this.activeCampaign(identity.clientId);
    if (!campaign) throw new NotFoundException({ code: 'REFERRAL_CAMPAIGN_INACTIVE', message: 'Referral campaign is unavailable.' });
    return { referralCode: code.trim().toUpperCase(), title: campaign.displayTitle ?? campaign.name, description: campaign.displayDescription ?? campaign.description };
  }

  async mine(clientId: string, userId: string, query: ListReferralsDto) {
    await this.access.requireFeature(clientId);
    const rider = await this.access.requireRider(clientId, userId);
    const where: Prisma.ReferralWhereInput = { clientId, referrerRiderId: rider.id, ...(query.status ? { status: query.status } : {}) };
    return this.listSafe(where, query);
  }

  async notifications(clientId: string, userId: string, query: ListReferralNotificationsDto) {
    await this.access.requireFeature(clientId);
    const rider = await this.access.requireRider(clientId, userId);
    const where: Prisma.ReferralNotificationOutboxWhereInput = {
      clientId,
      referral: { clientId, OR: [{ referrerRiderId: rider.id }, { refereeRiderId: rider.id }] },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.referralNotificationOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, referralId: true, eventType: true, payload: true, createdAt: true } }),
      this.prisma.referralNotificationOutbox.count({ where }),
    ]);
    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async listForOperations(clientId: string, query: ListReferralsDto) {
    await this.access.requireFeature(clientId);
    const where: Prisma.ReferralWhereInput = {
      clientId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      ...(query.search ? { OR: [
        { referralCode: { contains: query.search, mode: 'insensitive' } },
        { refereeRider: { name: { contains: query.search, mode: 'insensitive' } } },
        { referrerRider: { name: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
      ...(query.fraudResult ? { fraudChecks: { some: { result: query.fraudResult } } } : {}),
      ...(query.rewardStatus ? { rewards: { some: { status: query.rewardStatus } } } : {}),
    };
    return this.listSafe(where, query);
  }

  private async listSafe(where: Prisma.ReferralWhereInput, query: ListReferralsDto) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.referral.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { refereeRider: { select: { name: true, mobile: true } }, progress: { orderBy: { milestoneType: 'asc' } }, rewards: { select: { beneficiary: true, amount: true, currency: true, status: true } } } }),
      this.prisma.referral.count({ where }),
    ]);
    return { items: rows.map((row) => ({ id: row.id, campaignId: row.campaignId, status: row.status, referee: safeRider(row.refereeRider), invitedAt: row.invitedAt, registeredAt: row.registeredAt, qualifiedAt: row.qualifiedAt, qualificationDeadlineAt: row.qualificationDeadlineAt, milestones: row.progress.map((item) => ({ type: item.milestoneType, current: item.currentValue.toString(), target: item.targetValue.toString(), completedAt: item.completedAt })), rewards: row.rewards })), meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async detail(clientId: string, id: string, userId?: string) {
    await this.access.requireFeature(clientId);
    const rider = userId ? await this.access.requireRider(clientId, userId) : null;
    const row = await this.prisma.referral.findFirst({ where: { id, clientId, ...(rider ? { referrerRiderId: rider.id } : {}) }, include: { refereeRider: { select: { name: true, mobile: true } }, progress: { orderBy: { milestoneType: 'asc' } }, rewards: { select: { beneficiary: true, amount: true, currency: true, status: true, earnedAt: true, approvedAt: true, payout: { select: { paidAt: true } } } }, fraudChecks: { select: { checkType: true, result: true, checkedAt: true } } } });
    if (!row) throw new NotFoundException({ code: 'REFERRAL_NOT_FOUND', message: 'Referral not found.' });
    return { id: row.id, campaignId: row.campaignId, campaign: row.ruleSnapshot, terms: row.termsSnapshot, status: row.status, referee: safeRider(row.refereeRider), invitedAt: row.invitedAt, registeredAt: row.registeredAt, kycVerifiedAt: row.kycVerifiedAt, activatedAt: row.activatedAt, qualifiedAt: row.qualifiedAt, expiresAt: row.expiresAt, qualificationDeadlineAt: row.qualificationDeadlineAt, milestones: row.progress.map((item) => ({ type: item.milestoneType, operator: item.operator, current: item.currentValue.toString(), target: item.targetValue.toString(), mandatory: item.mandatory, completedAt: item.completedAt })), rewards: row.rewards, ...(rider ? {} : { fraudChecks: row.fraudChecks }) };
  }

  async reject(clientId: string, actorId: string, id: string, reason: string) {
    await this.access.requireFeature(clientId);
    const row = await this.prisma.referral.findFirst({ where: { id, clientId }, select: { id: true, status: true } });
    if (!row) throw new NotFoundException({ code: 'REFERRAL_NOT_FOUND', message: 'Referral not found.' });
    if (['QUALIFIED', 'REWARD_PENDING', 'REWARD_APPROVED', 'PAID', 'EXPIRED', 'REJECTED'].includes(row.status)) throw new ConflictException('Referral cannot be rejected in its current state.');
    const changed = await this.prisma.referral.updateMany({ where: { id, clientId, status: row.status }, data: { status: ReferralStatus.REJECTED, rejectedAt: new Date(), rejectionReason: reason.trim() } });
    if (changed.count !== 1) throw new ConflictException('Referral changed concurrently.');
    await this.audit.record({ clientId, actorId, action: 'REFERRAL_REJECTED', entityType: 'Referral', entityId: id, previousData: { status: row.status }, newData: { status: 'REJECTED', reason: reason.trim() } });
    return this.detail(clientId, id);
  }
}
