import { Module } from '@nestjs/common';
import { FleetStatusPolicy } from './fleet-status.policy.js';
import { FleetsService } from './fleets.service.js';
import { FleetsController } from './fleets.controller.js';

@Module({ controllers: [FleetsController], providers: [FleetStatusPolicy, FleetsService], exports: [FleetStatusPolicy, FleetsService] })
export class FleetsModule {}
