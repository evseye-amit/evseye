import { Module } from '@nestjs/common';
import { IotController, IotIngestionController } from './iot.controller.js';
import { IotService } from './iot.service.js';

@Module({
  controllers: [IotController, IotIngestionController],
  providers: [IotService],
  exports: [IotService],
})
export class IotModule {}
