import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RiderBillingAppController, RiderBillingOperationsController } from './rider-billing.controller.js';
import { RiderBillingService } from './rider-billing.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RiderBillingAppController, RiderBillingOperationsController],
  providers: [RiderBillingService],
  exports: [RiderBillingService],
})
export class RiderBillingModule {}
