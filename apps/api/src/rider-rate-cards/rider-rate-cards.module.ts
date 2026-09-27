import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { VehicleExchangeService } from '../vehicle-exchanges/vehicle-exchange.service.js';
import {
  RiderVehicleExchangeController,
  VehicleExchangeController,
} from '../vehicle-exchanges/vehicle-exchange.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommercialLifecycleService } from './commercial-lifecycle.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
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
import { CommercialOfferService } from './commercial-offer.service.js';
import {
  RiderCommercialOfferController,
  RiderRateCardsController,
} from './rider-rate-cards.controller.js';
import { RiderRateCardsService } from './rider-rate-cards.service.js';

@Module({
  imports: [AuthModule, AuditModule, AllocationsModule],
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
    CommercialOfferService,
    CommercialLifecycleService,
    RiderDepositService,
    VehicleExchangeService,
  ],
  exports: [CommercialOfferService, RiderDepositService],
})
export class RiderRateCardsModule {}
