import { SparesModule } from '../spares/spares.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RideReturnsController, ReturnPenaltyPriceController, RiderRideReturnsController } from './ride-returns.controller.js';
import { RideReturnsService } from './ride-returns.service.js';

@Module({
  imports: [SparesModule, AuthModule],
  controllers: [RideReturnsController, ReturnPenaltyPriceController, RiderRideReturnsController],
  providers: [RideReturnsService],
})
export class RideReturnsModule {}
