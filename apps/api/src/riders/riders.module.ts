import { RiderReferenceReviewController } from './rider-reference-review.controller.js';
import { RiderReferenceReviewService } from './rider-reference-review.service.js';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import { RiderDocumentReviewController } from './rider-document-review.controller.js';
import { RiderDocumentReviewService } from './rider-document-review.service.js';
import { RiderAppController } from './rider-app.controller.js';
import { RiderAppService } from './rider-app.service.js';
import { ReferralModule } from '../referrals/referral.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({
  imports: [AuthModule, AuditModule, MediaModule, ReferralModule, WorkflowModule],
  controllers: [RiderReferenceReviewController, RidersController, RiderAppController, RiderDocumentReviewController],
  providers: [RiderReferenceReviewService, RidersService, RiderOnboardingConfigurationService, RiderAppService, RiderDocumentReviewService],
  exports: [RiderDocumentReviewService],
})
export class RidersModule {}
