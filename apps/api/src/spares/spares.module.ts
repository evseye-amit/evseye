import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SparesService } from './spares.service.js';
import {
  ClientSpareController,
  SpareMasterController,
} from './spares.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [SpareMasterController, ClientSpareController],
  providers: [SparesService],
  exports: [SparesService],
})
export class SparesModule {}
