import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClientOnboardingController } from './client-onboarding.controller.js';
import { ClientOnboardingService } from './client-onboarding.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ClientOnboardingController],
  providers: [ClientOnboardingService],
  exports: [ClientOnboardingService],
})
export class ClientOnboardingModule {}
