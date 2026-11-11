import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FleetManagerHomeController } from './home.controller.js';
import { FleetManagerHomeService } from './home.service.js';

@Module({
  imports: [AuthModule],
  controllers: [FleetManagerHomeController],
  providers: [FleetManagerHomeService],
})
export class FleetManagerHomeModule {}
