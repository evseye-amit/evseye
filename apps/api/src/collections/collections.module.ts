import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';
import { CollectionsService } from './collections.service.js';
import {
  CollectionsController,
  RiderCollectionsController,
} from './collections.controller.js';
@Module({
  imports: [AuthModule, RiderBillingModule, PaymentsModule],
  providers: [CollectionsService],
  controllers: [CollectionsController, RiderCollectionsController],
  exports: [CollectionsService],
})
export class CollectionsModule {}
