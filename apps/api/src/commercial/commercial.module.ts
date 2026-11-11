import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommercialController } from './commercial.controller.js';
import { CommercialMaintenanceService } from './commercial-maintenance.service.js';
import { CommercialService } from './commercial.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommercialController],
  providers: [CommercialService, CommercialMaintenanceService],
  exports: [CommercialService, CommercialMaintenanceService],
})
export class CommercialModule {}
