import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { ExchangeHubGuard } from '../vehicle-exchanges/exchange-hub.guard.js';
import { VehicleExchangeService } from '../vehicle-exchanges/vehicle-exchange.service.js';
import {
  RiderVehicleExchangeController,
  VehicleExchangeController,
} from '../vehicle-exchanges/vehicle-exchange.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  RiderDepositsController,
  RiderDepositPolicyController,
  AgreementDepositsController,
  RiderDepositAdminQueriesController,
  RiderDepositsAppController,
} from '../rider-deposits/deposit.controller.js';
import {
  RiderCommercialTermsController,
  RiderCommercialOffersController,
  RiderCommercialOffersAppController,
  RiderRentalAgreementsController,
  RiderRentalAgreementsAppController,
} from './commercial-lifecycle.controller.js';
import {
  RiderCommercialOfferController,
  RiderRateCardsController,
} from './rider-rate-cards.controller.js';
import { RiderRateCardsService } from './rider-rate-cards.service.js';
import { CommercialCoreModule } from './commercial-core.module.js';

@Module({
  imports: [AuthModule, AuditModule, AllocationsModule, CommercialCoreModule],
  controllers: [
    RiderRateCardsController,
    RiderCommercialOfferController,
    RiderCommercialTermsController,
    RiderCommercialOffersController,
    RiderCommercialOffersAppController,
    RiderRentalAgreementsController,
    RiderRentalAgreementsAppController,
    RiderDepositsController,
    RiderDepositPolicyController,
    AgreementDepositsController,
    RiderDepositAdminQueriesController,
    RiderDepositsAppController,
    VehicleExchangeController,
    RiderVehicleExchangeController,
  ],
  providers: [
    RiderRateCardsService,
    VehicleExchangeService,
    ExchangeHubGuard,
  ],
  exports: [CommercialCoreModule],
})
export class RiderRateCardsModule {}
