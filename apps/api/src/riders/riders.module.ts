import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
