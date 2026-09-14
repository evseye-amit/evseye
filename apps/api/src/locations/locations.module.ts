import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
@Module({
  imports: [AuthModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
