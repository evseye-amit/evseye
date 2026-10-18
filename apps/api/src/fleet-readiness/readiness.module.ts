import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { FleetReadinessController } from './readiness.controller.js';
import { FleetReadinessService } from './readiness.service.js';
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [FleetReadinessController],
  providers: [FleetReadinessService],
})
export class FleetReadinessModule {}
