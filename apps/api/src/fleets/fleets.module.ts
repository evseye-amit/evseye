import { Module } from '@nestjs/common';
import { FleetStatusPolicy } from './fleet-status.policy.js';
import { FleetsService } from './fleets.service.js';

@Module({ providers: [FleetStatusPolicy, FleetsService], exports: [FleetStatusPolicy, FleetsService] })
export class FleetsModule {}
