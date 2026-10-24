import { RazorpayEventRouter } from './razorpay-event-router.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RiderBillingModule } from '../../rider-billing/rider-billing.module.js';
import { WalletModule } from '../../wallet/wallet.module.js';
import { SubmissionPenaltyModule } from '../../submission-penalties/submission-penalty.module.js';
import { RazorpayClient } from './razorpay.client.js';
import { RazorpayPenaltyService } from './razorpay-penalty.service.js';
@Module({
  imports: [
    AuthModule,
    RiderBillingModule,
    WalletModule,
    SubmissionPenaltyModule,
  ],
  providers: [RazorpayClient, RazorpayPenaltyService, RazorpayEventRouter],
  exports: [RazorpayPenaltyService, RazorpayEventRouter],
})
export class RazorpayPenaltyModule {}
