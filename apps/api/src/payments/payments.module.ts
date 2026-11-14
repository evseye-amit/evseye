import { WalletAutoRechargeService } from './wallet-auto-recharge.service.js';
import { WalletAutoRechargePolicyController, RiderWalletAutoRechargeController } from './wallet-auto-recharge.controller.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { PaymentAlertService } from './payment-alert.service.js';
import { PaymentAlertController } from './payment-alert.controller.js';
import { SettlementIngestionService } from './settlement-ingestion.service.js';
import { PaymentAutomationModule } from './payment-automation.module.js';
import { RazorpayRefundService } from './razorpay/razorpay-refund.service.js';
import { RazorpayRecurringClient } from './razorpay/razorpay-recurring.client.js';
import { PaymentGatewayPolicyModule } from './payment-gateway-policy.module.js';
import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';
import { RazorpayAutoPayProvider } from './razorpay/razorpay-autopay.provider.js';
import { RazorpayAutoPayWorker } from './razorpay/razorpay-autopay.worker.js';
import { AutoPayProviderRouter } from './autopay-provider-router.service.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { CommonPaymentController } from './common-payment.controller.js';
import { CommonPaymentService } from './common-payment.service.js';
import { RazorpayPenaltyModule } from './razorpay/razorpay-penalty.module.js';
import { RazorpayConfigurationService } from './razorpay/razorpay-configuration.service.js';
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
import { DeploymentPaymentProviderRouter } from './deployment-payment-provider-router.service.js';
import { RazorpayDeploymentProviderAdapter } from './razorpay/razorpay-deployment-provider.adapter.js';
import { DEPLOYMENT_PAYMENT_PROVIDER } from './deployment-payment-provider.interface.js';
import { ProviderSettlementController } from './provider-settlement.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
  imports: [NotificationModule, PaymentAutomationModule, PaymentGatewayPolicyModule, AllocationsModule, RazorpayPenaltyModule, AuthModule, RiderBillingModule, RiderRateCardsModule, WalletModule],
  controllers: [WalletAutoRechargePolicyController, RiderWalletAutoRechargeController, PaymentAlertController,
    CommonPaymentController,
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
  providers: [WalletAutoRechargeService, PaymentAlertService,
    RazorpayRecurringClient, RazorpayAutoPayProvider, RazorpayAutoPayWorker, AutoPayProviderRouter, RazorpayConfigurationService,
    CommonPaymentService,
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
    RazorpayRefundService,
    ProviderSettlementService,
    SettlementIngestionService,
    RazorpayDeploymentProviderAdapter,
    {
      provide: DEPLOYMENT_PAYMENT_PROVIDER,
      inject: [PrismaService, ConfigService, RazorpayDeploymentProviderAdapter, PaymentGatewayPolicyService],
      useFactory: (db: PrismaService, config: ConfigService<Environment, true>, razorpay: RazorpayDeploymentProviderAdapter, policy: PaymentGatewayPolicyService) =>
        new DeploymentPaymentProviderRouter(db, config, razorpay, policy),
    },
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
