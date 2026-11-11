import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AllowanceResetPeriod,
  FeatureAddOnPurchaseStatus,
  FeatureCreditSourceType,
  FeatureUsageTransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

type ResettablePackageFeature = {
  id: string;
  featureId: string;
  includedQuantity: Prisma.Decimal | null;
  resetPeriod: AllowanceResetPeriod | null;
  rolloverAllowed: boolean;
};

@Injectable()
export class CommercialMaintenanceService {
  private readonly logger = new Logger(CommercialMaintenanceService.name);
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'commercial-credit-maintenance',
    timeZone: 'Asia/Kolkata',
  })
  async runDailyMaintenance() {
    try {
      const result = await this.run();
      this.logger.log(`Commercial maintenance completed: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error('Commercial maintenance failed.', error instanceof Error ? error.stack : undefined);
    }
  }

  /**
   * Safe to invoke repeatedly from a deployment scheduler. Unique allowance
   * source keys and conditional lot updates make each run idempotent.
   */
  async run(now = new Date()) {
    const expiredCreditLots = await this.expireCredits(now);
    const expiredPurchases = await this.expirePurchases(now);
    const grantedAllowances = await this.refreshPackageAllowances(now);
    return { ranAt: now, expiredCreditLots, expiredPurchases, grantedAllowances };
  }

  private async expireCredits(now: Date) {
    const lots = await this.prisma.featureCreditLot.findMany({
      where: { quantityAvailable: { gt: 0 }, expiresAt: { lte: now } },
    });
    let expired = 0;
    for (const lot of lots) {
      const didExpire = await this.prisma.$transaction(async (tx) => {
        const current = await tx.featureCreditLot.findUnique({ where: { id: lot.id } });
        if (!current || current.quantityAvailable.lte(0) || !current.expiresAt || current.expiresAt > now) return false;
        const remaining = current.quantityAvailable;
        await tx.featureCreditLot.update({ where: { id: current.id }, data: { quantityAvailable: 0 } });
        await tx.featureUsageLedger.create({
          data: {
            clientId: current.clientId,
            subscriptionId: current.subscriptionId,
            featureId: current.featureId,
            creditLotId: current.id,
            sourceType: current.sourceType,
            sourceId: current.sourceId,
            transactionType: FeatureUsageTransactionType.EXPIRE,
            quantity: remaining.negated(),
            balanceAfter: 0,
            referenceType: 'CREDIT_EXPIRY',
            referenceId: current.id,
            occurredAt: now,
            expiresAt: current.expiresAt,
          },
        });
        return true;
      });
      if (didExpire) expired += 1;
    }
    return expired;
  }

  private async expirePurchases(now: Date) {
    const result = await this.prisma.clientFeatureAddOnPurchase.updateMany({
      where: {
        status: FeatureAddOnPurchaseStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      data: { status: FeatureAddOnPurchaseStatus.EXPIRED, quantityRemaining: 0 },
    });
    return result.count;
  }

  private async refreshPackageAllowances(now: Date) {
    const subscriptions = await this.prisma.clientSubscription.findMany({
      where: { status: 'ACTIVE', startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
      include: {
        package: {
          include: {
            features: {
              where: {
                isIncluded: true,
                isUnlimited: false,
                includedQuantity: { gt: 0 },
                resetPeriod: { not: AllowanceResetPeriod.NONE },
              },
            },
          },
        },
      },
    });
    let granted = 0;
    for (const subscription of subscriptions) {
      for (const packageFeature of subscription.package.features as ResettablePackageFeature[]) {
        const resetPeriod = packageFeature.resetPeriod;
        if (!resetPeriod || resetPeriod === AllowanceResetPeriod.NONE) continue;
        const periodStart = this.currentPeriodStart(subscription.startDate, resetPeriod, now);
        if (!periodStart) continue;
        const didGrant = await this.grantAllowance(
          subscription.id,
          subscription.clientId,
          packageFeature,
          periodStart,
          now,
        );
        if (didGrant) granted += 1;
      }
    }
    return granted;
  }

  private async grantAllowance(
    subscriptionId: string,
    clientId: string,
    packageFeature: ResettablePackageFeature,
    periodStart: Date,
    now: Date,
  ) {
    const sourceKey = `allowance:${subscriptionId}:${packageFeature.id}:${this.dateKey(periodStart)}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.featureCreditLot.findUnique({ where: { sourceKey } });
        if (existing) return false;

        if (!packageFeature.rolloverAllowed) {
          const priorLots = await tx.featureCreditLot.findMany({
            where: {
              subscriptionId,
              featureId: packageFeature.featureId,
              sourceType: FeatureCreditSourceType.PACKAGE_ALLOWANCE,
              sourceId: packageFeature.id,
              quantityAvailable: { gt: 0 },
              periodStart: { lt: periodStart },
            },
          });
          for (const priorLot of priorLots) {
            await tx.featureCreditLot.update({ where: { id: priorLot.id }, data: { quantityAvailable: 0 } });
            await tx.featureUsageLedger.create({
              data: {
                clientId,
                subscriptionId,
                featureId: priorLot.featureId,
                creditLotId: priorLot.id,
                sourceType: FeatureCreditSourceType.PACKAGE_ALLOWANCE,
                sourceId: packageFeature.id,
                transactionType: FeatureUsageTransactionType.EXPIRE,
                quantity: priorLot.quantityAvailable.negated(),
                balanceAfter: 0,
                referenceType: 'ALLOWANCE_RESET',
                referenceId: sourceKey,
                occurredAt: now,
              },
            });
          }
        }

        const quantity = decimal(packageFeature.includedQuantity!);
        const lot = await tx.featureCreditLot.create({
          data: {
            clientId,
            subscriptionId,
            featureId: packageFeature.featureId,
            sourceType: FeatureCreditSourceType.PACKAGE_ALLOWANCE,
            sourceId: packageFeature.id,
            sourceKey,
            quantityOriginal: quantity,
            quantityAvailable: quantity,
            periodStart,
          },
        });
        await tx.featureUsageLedger.create({
          data: {
            clientId,
            subscriptionId,
            featureId: packageFeature.featureId,
            creditLotId: lot.id,
            sourceType: FeatureCreditSourceType.PACKAGE_ALLOWANCE,
            sourceId: packageFeature.id,
            transactionType: FeatureUsageTransactionType.CREDIT,
            quantity,
            referenceType: 'PACKAGE_ALLOWANCE_RESET',
            referenceId: sourceKey,
            occurredAt: now,
          },
        });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  private currentPeriodStart(startDate: Date, period: AllowanceResetPeriod, now: Date) {
    const start = this.startOfDay(startDate);
    const today = this.startOfDay(now);
    if (today < start) return null;
    const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
    if (period === AllowanceResetPeriod.DAILY) return this.addDays(start, days);
    if (period === AllowanceResetPeriod.WEEKLY) return this.addDays(start, Math.floor(days / 7) * 7);
    const monthStep = period === AllowanceResetPeriod.MONTHLY ? 1 : period === AllowanceResetPeriod.QUARTERLY ? 3 : 12;
    let periods = Math.floor((this.monthIndex(today) - this.monthIndex(start)) / monthStep);
    let candidate = this.addMonthsOnAnchor(start, periods * monthStep);
    if (candidate > today) candidate = this.addMonthsOnAnchor(start, Math.max(0, (periods - 1) * monthStep));
    return candidate;
  }

  private startOfDay(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }
  private addDays(value: Date, days: number) { return new Date(value.getTime() + days * 86_400_000); }
  private monthIndex(value: Date) { return value.getUTCFullYear() * 12 + value.getUTCMonth(); }
  private addMonthsOnAnchor(start: Date, months: number) {
    const index = start.getUTCFullYear() * 12 + start.getUTCMonth() + months;
    const year = Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12;
    const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return new Date(Date.UTC(year, month, day));
  }
  private dateKey(value: Date) { return value.toISOString().slice(0, 10); }
}
