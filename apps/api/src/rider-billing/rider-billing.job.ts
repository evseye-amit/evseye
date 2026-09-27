import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RiderBillingEngineService } from './rider-billing-engine.service.js';
import { RiderBillingService } from './rider-billing.service.js';

@Injectable()
export class RiderBillingJob {
  private readonly logger = new Logger(RiderBillingJob.name);
  constructor(private readonly engine: RiderBillingEngineService, private readonly billing: RiderBillingService) {}
  @Cron(CronExpression.EVERY_HOUR)
  async generateDuePeriods() {
    try { await this.engine.generateDue(); await this.billing.markOverdue(); }
    catch (error) { this.logger.error('BILLING_PERIOD_FAILED', error instanceof Error ? error.stack : String(error)); }
  }
}
