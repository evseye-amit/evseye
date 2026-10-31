import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
import { ImportsModule } from '../imports/imports.module.js';
@Module({
  imports: [AuthModule, ImportsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
