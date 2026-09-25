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
import {
  PaymentWebhookController,
  RiderMandateController,
} from './mandate.controller.js';

@Module({
  imports: [AuthModule, RiderBillingModule],
  controllers: [
    RiderMandateController,
    PaymentWebhookController,
    InvoiceCollectionController,
    RiderPaymentCollectionController,
  ],
  providers: [
    CashfreeHttpClient,
    CashfreePaymentProvider,
    MockPaymentProvider,
    DisabledPaymentProvider,
    MandateService,
    PaymentOrchestratorService,
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
  exports: [PAYMENT_PROVIDER, MandateService, PaymentOrchestratorService],
})
export class PaymentsModule {}
