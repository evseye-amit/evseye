import { Module } from '@nestjs/common';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';

@Module({
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
