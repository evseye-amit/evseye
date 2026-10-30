import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';
import { RiderRateCardsModule } from '../rider-rate-cards/rider-rate-cards.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { FinalSettlementService } from './final-settlement.service.js';
import {
  AgreementSettlementController,
  FinalSettlementController,
  RiderFinalSettlementController,
  RiderFinancialStatementController,
  OperationsFinancialStatementController,
  SettlementPolicyController,
} from './final-settlement.controller.js';
@Module({
  imports: [
    AuthModule,
    RiderBillingModule,
    RiderRateCardsModule,
    PaymentsModule,
  ],
  providers: [FinalSettlementService],
  controllers: [
    AgreementSettlementController,
    FinalSettlementController,
    RiderFinalSettlementController,
    RiderFinancialStatementController,
    OperationsFinancialStatementController,
    SettlementPolicyController,
  ],
})
export class FinalSettlementModule {}
