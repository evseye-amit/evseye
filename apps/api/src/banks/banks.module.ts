import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IfscBankController } from './banks.controller.js';
import { IfscBankService } from './banks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [IfscBankController],
  providers: [IfscBankService],
  exports: [IfscBankService],
})
export class BanksModule {}
