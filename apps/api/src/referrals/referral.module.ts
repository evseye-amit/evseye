import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReferralAccessService } from './referral-access.service.js';
import { ReferralAnalyticsService } from './referral-analytics.service.js';
import { ReferralCampaignService } from './referral-campaign.service.js';
import { ReferralLinkService } from './referral-link.service.js';
import { ReferralOperationsController, ReferralEventController } from './referral-operations.controller.js';
import { PublicReferralController, ReferralRiderController } from './referral-rider.controller.js';
import { ReferralQualificationService } from './referral-qualification.service.js';
import { ReferralRewardService } from './referral-reward.service.js';
import { ReferralService } from './referral.service.js';
import { ReferralFraudService } from './referral-fraud.service.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';

@Module({
  imports: [AuthModule, AuditModule, RiderBillingModule],
  controllers: [ReferralRiderController, PublicReferralController, ReferralOperationsController, ReferralEventController],
  providers: [ReferralAccessService, ReferralAnalyticsService, ReferralCampaignService, ReferralFraudService, ReferralLinkService, ReferralQualificationService, ReferralRewardService, ReferralService],
  exports: [ReferralService, ReferralQualificationService],
})
export class ReferralModule {}
