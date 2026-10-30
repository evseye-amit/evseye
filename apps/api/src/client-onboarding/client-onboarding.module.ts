import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClientOnboardingController } from './client-onboarding.controller.js';
import { ClientOnboardingService } from './client-onboarding.service.js';
import { ClientOnboardingReadinessService } from './client-onboarding-readiness.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ClientOnboardingController],
  providers: [ClientOnboardingService, ClientOnboardingReadinessService],
  exports: [ClientOnboardingService, ClientOnboardingReadinessService],
})
export class ClientOnboardingModule {}
