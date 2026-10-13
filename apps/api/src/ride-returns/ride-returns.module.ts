import { Module } from '@nestjs/common';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';
import { RideReturnsController, ReturnPenaltyPriceController, RiderRideReturnsController } from './ride-returns.controller.js';
import { RideReturnsService } from './ride-returns.service.js';

@Module({
  imports: [AuthModule, AllocationsModule, RiderBillingModule],
  controllers: [RideReturnsController, ReturnPenaltyPriceController, RiderRideReturnsController],
  providers: [RideReturnsService],
  exports: [RideReturnsService],
})
export class RideReturnsModule {}
