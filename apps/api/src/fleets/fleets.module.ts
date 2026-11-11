import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';
import { FleetsService } from './fleets.service.js';
import { FleetsController } from './fleets.controller.js';
import { ComponentsService } from './components.service.js';
import { FleetTransfersController } from './fleet-transfers.controller.js';
import { FleetImportRouterService } from './fleet-import-router.service.js';
import { IotModule } from '../iot/iot.module.js';
import { ImportsModule } from '../imports/imports.module.js';

@Module({
  imports: [AuthModule, AuditModule, IotModule, ImportsModule],
  controllers: [FleetsController, FleetTransfersController],
  providers: [FleetStatusPolicy, FleetsService, ComponentsService, FleetImportRouterService],
  exports: [FleetStatusPolicy, FleetsService, FleetImportRouterService],
})
export class FleetsModule {}
