import { RentalBillingOperations } from './rental-billing-operations.service.js';
import { RentalBillingOperationsController } from './rental-billing-operations.controller.js';
import { RentalBillingRunner } from './rental-billing-runner.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  RiderBillingAppController,
  RiderBillingOperationsController,
} from './rider-billing.controller.js';
import { RiderBillingService } from './rider-billing.service.js';
import { RiderBillingEngineService } from './rider-billing-engine.service.js';
import { RiderPaymentsService } from './rider-payments.service.js';
import {
  RiderBillingPhase6Controller,
  RiderBillingPaymentsAppController,
} from './rider-billing-phase6.controller.js';
import { RiderBillingJob } from './rider-billing.job.js';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [
    RentalBillingOperationsController,
    RiderBillingAppController,
    RiderBillingOperationsController,
    RiderBillingPhase6Controller,
    RiderBillingPaymentsAppController,
  ],
  providers: [
    RentalBillingOperations,
    RiderBillingService,
    RiderBillingEngineService,
    RiderPaymentsService,
    RiderBillingJob,
    RentalBillingRunner,
  ],
  exports: [
    RiderBillingService,
    RiderBillingEngineService,
    RiderPaymentsService,
  ],
})
export class RiderBillingModule {}
