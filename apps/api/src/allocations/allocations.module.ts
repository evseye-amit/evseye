import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { AllocationsController } from './allocations.controller.js';
import { AllocationsService } from './allocations.service.js';
import { MobileDeploymentController } from './mobile-deployment.controller.js';
import { MobileDeploymentService } from './mobile-deployment.service.js';

@Module({
  imports: [AuthModule, AuditModule, MediaModule],
  controllers: [AllocationsController, MobileDeploymentController],
  providers: [AllocationsService, MobileDeploymentService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
