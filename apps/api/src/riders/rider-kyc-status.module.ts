import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import { RiderKycStatusService } from './rider-kyc-status.service.js';

@Module({
  imports: [WorkflowModule],
  providers: [RiderOnboardingConfigurationService, RiderKycStatusService],
  exports: [RiderOnboardingConfigurationService, RiderKycStatusService],
})
export class RiderKycStatusModule {}
