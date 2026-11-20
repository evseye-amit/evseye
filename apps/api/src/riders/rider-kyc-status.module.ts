import { PanVerificationPolicyService } from './pan-verification-policy.service.js';
import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import { RiderKycStatusService } from './rider-kyc-status.service.js';

@Module({
  imports: [WorkflowModule],
  providers: [PanVerificationPolicyService, RiderOnboardingConfigurationService, RiderKycStatusService],
  exports: [PanVerificationPolicyService, RiderOnboardingConfigurationService, RiderKycStatusService],
})
export class RiderKycStatusModule {}
