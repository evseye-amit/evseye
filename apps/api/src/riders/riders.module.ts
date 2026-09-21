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

@Module({
  imports: [AuthModule, AuditModule, MediaModule],
  controllers: [RidersController, RiderAppController, RiderDocumentReviewController],
  providers: [RidersService, RiderOnboardingConfigurationService, RiderAppService, RiderDocumentReviewService],
  exports: [RiderDocumentReviewService],
})
export class RidersModule {}
