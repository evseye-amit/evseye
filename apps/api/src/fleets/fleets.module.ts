import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';
import { FleetsService } from './fleets.service.js';
import { FleetsController } from './fleets.controller.js';
import { ComponentsService } from './components.service.js';

@Module({ imports: [AuthModule], controllers: [FleetsController], providers: [FleetStatusPolicy, FleetsService, ComponentsService], exports: [FleetStatusPolicy, FleetsService] })
export class FleetsModule {}
