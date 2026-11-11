import { Module } from '@nestjs/common';
import { CommercialOfferService } from './commercial-offer.service.js';
import { CommercialLifecycleService } from './commercial-lifecycle.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { DeploymentCommercialService } from '../allocations/deployment-commercial.service.js';

@Module({
  providers: [
    CommercialOfferService,
    CommercialLifecycleService,
    RiderDepositService,
    DeploymentCommercialService,
  ],
  exports: [
    CommercialOfferService,
    CommercialLifecycleService,
    RiderDepositService,
    DeploymentCommercialService,
  ],
})
export class CommercialCoreModule {}
