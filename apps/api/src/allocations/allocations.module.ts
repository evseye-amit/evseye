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
  imports: [WalletModule, AuthModule, AuditModule, MediaModule, RidersModule, ReferralModule, CommercialCoreModule],
  controllers: [AllocationTeamLeadController, AllocationsController, MobileDeploymentController, DeploymentCommercialController],
  providers: [AllocationTeamLeadService, AllocationsService, MobileDeploymentService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
