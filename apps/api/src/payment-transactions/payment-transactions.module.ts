import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { CommercialCoreModule } from '../rider-rate-cards/commercial-core.module.js';
import { ClientPaymentTransactionsController, RiderPaymentTransactionsController } from './payment-transactions.controller.js';
import { PaymentTransactionsService } from './payment-transactions.service.js';
@Module({ imports: [AuthModule, MediaModule, CommercialCoreModule], controllers: [ClientPaymentTransactionsController, RiderPaymentTransactionsController], providers: [PaymentTransactionsService] })
export class PaymentTransactionsModule {}
