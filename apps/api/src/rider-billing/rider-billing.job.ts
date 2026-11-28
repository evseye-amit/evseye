import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RentalBillingRunner } from './rental-billing-runner.service.js';
import { RiderBillingService } from './rider-billing.service.js';

@Injectable()
export class RiderBillingJob {
  private readonly logger = new Logger(RiderBillingJob.name);
  constructor(private readonly runner: RentalBillingRunner, private readonly billing: RiderBillingService) {}
  @Cron(CronExpression.EVERY_MINUTE)
  async generateDuePeriods() {
    try { await this.runner.run(); }
    catch (error) { this.logger.error('BILLING_PERIOD_FAILED', error instanceof Error ? error.stack : String(error)); }
    try { await this.billing.markOverdue(); }
    catch (error) { this.logger.error('BILLING_OVERDUE_FAILED', error instanceof Error ? error.stack : String(error)); }
  }
}
