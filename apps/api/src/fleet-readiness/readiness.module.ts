import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { FleetReadinessController } from './readiness.controller.js';
import { FleetReadinessService } from './readiness.service.js';
import { FleetInstallationController } from './installation.controller.js';
import { FleetInstallationService } from './installation.service.js';
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [FleetReadinessController, FleetInstallationController],
  providers: [FleetReadinessService, FleetInstallationService],
})
export class FleetReadinessModule {}
