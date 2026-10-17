import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FleetManagerMaintenanceController } from './maintenance.controller.js';
import { FleetManagerMaintenanceService } from './maintenance.service.js';

@Module({
  imports: [AuthModule],
  controllers: [FleetManagerMaintenanceController],
  providers: [FleetManagerMaintenanceService],
})
export class FleetManagerMaintenanceModule {}
