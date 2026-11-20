import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentAutomationService } from './payment-automation.service.js';

@Module({
  imports: [PrismaModule],
  providers: [PaymentAutomationService],
  exports: [PaymentAutomationService],
})
export class PaymentAutomationModule {}
