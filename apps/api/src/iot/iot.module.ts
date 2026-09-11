import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IotController, IotIngestionController } from './iot.controller.js';
import { IotService } from './iot.service.js';

@Module({
  imports: [AuthModule],
  controllers: [IotController, IotIngestionController],
  providers: [IotService],
  exports: [IotService],
})
export class IotModule {}
