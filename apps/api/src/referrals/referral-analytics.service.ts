import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReferralAccessService } from './referral-access.service.js';

@Injectable()
export class ReferralAnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService) {}

  async campaign(clientId: string, campaignId: string) {
    await this.access.requireFeature(clientId);
    const campaign = await this.prisma.referralCampaign.findFirst({ where: { id: campaignId, clientId }, select: { id: true, code: true, name: true, currency: true, campaignBudget: true, budgetReserved: true } });
    if (!campaign) throw new NotFoundException('Referral campaign not found.');
    const base = { clientId, campaignId };
    const [invites, registrations, kyc, activated, qualified, expired, rejected, rewards] = await Promise.all([
      this.prisma.referral.count({ where: base }),
      this.prisma.referral.count({ where: { ...base, registeredAt: { not: null } } }),
      this.prisma.referral.count({ where: { ...base, kycVerifiedAt: { not: null } } }),
      this.prisma.referral.count({ where: { ...base, activatedAt: { not: null } } }),
      this.prisma.referral.count({ where: { ...base, qualifiedAt: { not: null } } }),
      this.prisma.referral.count({ where: { ...base, status: 'EXPIRED' } }),
      this.prisma.referral.count({ where: { ...base, status: 'REJECTED' } }),
      this.prisma.referralReward.groupBy({ by: ['status'], where: base, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const sum = (statuses: string[]) => rewards.reduce((value, item) => statuses.includes(item.status) ? value.plus(item._sum.amount ?? 0) : value, new Prisma.Decimal(0));
    const paid = sum(['PAID']); const liability = sum(['EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING']);
    const rate = (numerator: number, denominator: number) => denominator ? Number((numerator / denominator * 100).toFixed(2)) : 0;
    return {
      campaign, funnel: { invited: invites, registered: registrations, kycVerified: kyc, activated, qualified, paid: await this.prisma.referral.count({ where: { ...base, status: 'PAID' } }) },
      outcomes: { expired, rejected },
      conversion: { registrationPercent: rate(registrations, invites), activationPercent: rate(activated, registrations), qualificationPercent: rate(qualified, registrations) },
      rewards: { earnedAmount: sum(['EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID']).toFixed(2), approvedAmount: sum(['APPROVED', 'PROCESSING', 'PAID']).toFixed(2), paidAmount: paid.toFixed(2), liabilityAmount: liability.toFixed(2), averagePerQualified: qualified ? sum(['EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID']).div(qualified).toFixed(2) : '0.00', currency: campaign.currency },
      acquisitionCost: { perActivatedRider: activated ? paid.div(activated).toFixed(2) : null, perQualifiedRider: qualified ? paid.div(qualified).toFixed(2) : null, denominator: 'Paid referral rewards divided by activated or qualified Rider count.' },
    };
  }
}
