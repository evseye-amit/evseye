import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RiderBillingModule } from '../../rider-billing/rider-billing.module.js';
import { WalletModule } from '../../wallet/wallet.module.js';
import { SubmissionPenaltyModule } from '../../submission-penalties/submission-penalty.module.js';
import { RazorpayClient } from './razorpay.client.js';
import { RazorpayPenaltyService } from './razorpay-penalty.service.js';
import { RazorpayPenaltyController } from './razorpay-penalty.controller.js';
@Module({
  imports: [
    AuthModule,
    RiderBillingModule,
    WalletModule,
    SubmissionPenaltyModule,
  ],
  controllers: [RazorpayPenaltyController],
  providers: [RazorpayClient, RazorpayPenaltyService],
  exports: [RazorpayPenaltyService],
})
export class RazorpayPenaltyModule {}
