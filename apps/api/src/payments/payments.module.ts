import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { CashfreeHttpClient } from './cashfree/cashfree-http.client.js';
import { CashfreePaymentProvider } from './cashfree/cashfree-payment.provider.js';
import { DisabledPaymentProvider } from './disabled-payment.provider.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { PAYMENT_PROVIDER } from './payment-provider.interface.js';
import { AuthModule } from '../auth/auth.module.js';
import { MandateService } from './mandate.service.js';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';
import {
  InvoiceCollectionController,
  RiderPaymentCollectionController,
} from './payment-collection.controller.js';
import { RiderBillingModule } from '../rider-billing/rider-billing.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { CheckoutCollectionService } from './checkout-collection.service.js';
import {
  RiderCheckoutController,
  CheckoutWebhookController,
} from './checkout-collection.controller.js';
import { AutoCollectionService } from './auto-collection.service.js';
import { PaymentCollectionPolicyController } from './payment-policy.controller.js';
import {
  PaymentReconciliationController,
  PlatformPaymentReconciliationController,
} from './payment-reconciliation.controller.js';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';
import { RiderPaymentHomeController } from './payment-home.controller.js';
import { RiderRateCardsModule } from '../rider-rate-cards/rider-rate-cards.module.js';
import { PaymentRefundService } from './payment-refund.service.js';
import { ProviderSettlementService } from './provider-settlement.service.js';
import { ProviderSettlementController } from './provider-settlement.controller.js';
import { AutoPayOperationsController } from './autopay-operations.controller.js';
import {
  PaymentRefundAdminController,
  RiderPaymentRefundController,
  CashfreeRefundWebhookController,
} from './payment-refund.controller.js';
import {
  PaymentWebhookController,
  RiderMandateController,
} from './mandate.controller.js';

@Module({
  imports: [AuthModule, RiderBillingModule, RiderRateCardsModule, WalletModule],
  controllers: [
    RiderMandateController,
    AutoPayOperationsController,
    PaymentWebhookController,
    InvoiceCollectionController,
    RiderPaymentCollectionController,
    RiderCheckoutController,
    CheckoutWebhookController,
    PaymentCollectionPolicyController,
    PaymentReconciliationController,
    PlatformPaymentReconciliationController,
    RiderPaymentHomeController,
    PaymentRefundAdminController,
    RiderPaymentRefundController,
    CashfreeRefundWebhookController,
    ProviderSettlementController,
  ],
  providers: [
    CashfreeHttpClient,
    CashfreePaymentProvider,
    MockPaymentProvider,
    DisabledPaymentProvider,
    MandateService,
    PaymentOrchestratorService,
    CheckoutCollectionService,
    AutoCollectionService,
    PaymentReconciliationService,
    PaymentRefundService,
    ProviderSettlementService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [
        ConfigService,
        CashfreePaymentProvider,
        MockPaymentProvider,
        DisabledPaymentProvider,
      ],
      useFactory: (
        config: ConfigService<Environment, true>,
        cashfree: CashfreePaymentProvider,
        mock: MockPaymentProvider,
        disabled: DisabledPaymentProvider,
      ) => {
        const selected = config.getOrThrow('PAYMENT_PROVIDER');
        return selected === 'cashfree'
          ? cashfree
          : selected === 'mock'
            ? mock
            : disabled;
      },
    },
  ],
  exports: [
    PAYMENT_PROVIDER,
    MandateService,
    PaymentOrchestratorService,
    CheckoutCollectionService,
    PaymentRefundService,
  ],
})
export class PaymentsModule {}
