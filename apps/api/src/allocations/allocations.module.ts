import { RazorpayPenaltyModule } from '../payments/razorpay/razorpay-penalty.module.js';
import { RazorpayClient } from '../payments/razorpay/razorpay.client.js';
import { RazorpayDeploymentService } from '../payments/razorpay/razorpay-deployment.service.js';
import { RazorpayDeploymentController, RazorpayWebhookController, RazorpayDeploymentAdminController } from '../payments/razorpay/razorpay-deployment.controller.js';
import { SubmissionPenaltyModule } from '../submission-penalties/submission-penalty.module.js';
import { FleetSearchController } from './fleet-search.controller.js';
import { FleetSearchService } from './fleet-search.service.js';
import { AllocationTeamLeadController } from './allocation-team-lead.controller.js';
import { AllocationTeamLeadService } from './allocation-team-lead.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { RidersModule } from '../riders/riders.module.js';
import { AllocationsController } from './allocations.controller.js';
import { AllocationsService } from './allocations.service.js';
import { MobileDeploymentController } from './mobile-deployment.controller.js';
import { MobileDeploymentService } from './mobile-deployment.service.js';
import { ReferralModule } from '../referrals/referral.module.js';
import { CommercialCoreModule } from '../rider-rate-cards/commercial-core.module.js';
import { DeploymentCommercialController } from './deployment-commercial.controller.js';

@Module({
  imports: [RazorpayPenaltyModule, SubmissionPenaltyModule, WalletModule, AuthModule, AuditModule, MediaModule, RidersModule, ReferralModule, CommercialCoreModule],
  controllers: [RazorpayDeploymentController, RazorpayWebhookController, RazorpayDeploymentAdminController, FleetSearchController, AllocationTeamLeadController, AllocationsController, MobileDeploymentController, DeploymentCommercialController],
  providers: [RazorpayClient, RazorpayDeploymentService, FleetSearchService, AllocationTeamLeadService, AllocationsService, MobileDeploymentService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
