import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RidersController],
  providers: [RidersService, RiderOnboardingConfigurationService],
})
export class RidersModule {}
