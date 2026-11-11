import { MediaModule } from '../media/media.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';
import { VehicleSubmissionController } from './submission.controller.js';
import { VehicleSubmissionService } from './submission.service.js';
@Module({
  imports: [MediaModule, AuthModule, AllocationsModule, RiderBillingModule],
  controllers: [VehicleSubmissionController],
  providers: [VehicleSubmissionService],
  exports: [VehicleSubmissionService],
})
export class VehicleSubmissionModule {}
