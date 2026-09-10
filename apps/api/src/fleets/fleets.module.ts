import { Module } from '@nestjs/common';
import { FleetStatusPolicy } from './fleet-status.policy.js';

@Module({ providers: [FleetStatusPolicy], exports: [FleetStatusPolicy] })
export class FleetsModule {}
