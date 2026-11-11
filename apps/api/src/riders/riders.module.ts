import { WalletModule } from '../wallet/wallet.module.js';
import { RiderWalletOperationsController } from './rider-wallet.controller.js';
import { RiderWalletOperationsService } from './rider-wallet.service.js';
import { RiderEarningsController } from './rider-earnings.controller.js';
import { RiderEarningsService } from './rider-earnings.service.js';
import { RiderReferenceReviewController } from './rider-reference-review.controller.js';
import { RiderReferenceReviewService } from './rider-reference-review.service.js';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';
import { RiderDocumentReviewController } from './rider-document-review.controller.js';
import { RiderDocumentReviewService } from './rider-document-review.service.js';
import { RiderAppController } from './rider-app.controller.js';
import { RiderAppService } from './rider-app.service.js';
import { ReferralModule } from '../referrals/referral.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { RiderKycStatusModule } from './rider-kyc-status.module.js';
import { BanksModule } from '../banks/banks.module.js';

@Module({
  imports: [WalletModule, AuthModule, AuditModule, MediaModule, ReferralModule, WorkflowModule, RiderKycStatusModule, BanksModule],
  controllers: [RiderWalletOperationsController, RiderEarningsController, RiderReferenceReviewController, RidersController, RiderAppController, RiderDocumentReviewController],
  providers: [RiderWalletOperationsService, RiderEarningsService, RiderReferenceReviewService, RidersService, RiderAppService, RiderDocumentReviewService],
  exports: [RiderDocumentReviewService],
})
export class RidersModule {}
