import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SmsQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(clientId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId + ':SMS_LOGIN_OTP'}))`;
      const now = new Date();
      const subscription = await tx.clientSubscription.findFirst({
        where: { clientId, status: 'ACTIVE', startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] },
        include: { package: { include: { features: { where: { feature: { code: 'SMS_LOGIN_OTP' }, isIncluded: true } } } } },
      });
      const allowance = subscription?.package.features[0];
      if (!subscription || !allowance) throw new ConflictException('SMS is not included in the active package.');
      if (allowance.isUnlimited) return [];
      if (allowance.includedQuantity && allowance.resetPeriod === 'MONTHLY') {
        const anchor = subscription.startDate;
        const month = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
        const periodDate = (offset: number) => {
          const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1));
          return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchor.getUTCDate(), new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate())));
        };
        const periodStart = periodDate(month) > now ? periodDate(month - 1) : periodDate(month);
        const sourceKey = `allowance:${subscription.id}:${allowance.id}:${periodStart.toISOString().slice(0, 10)}`;
        if (!await tx.featureCreditLot.findUnique({ where: { sourceKey } })) {
          if (!allowance.rolloverAllowed) {
            const old = await tx.featureCreditLot.findMany({ where: { subscriptionId: subscription.id, featureId: allowance.featureId, sourceType: 'PACKAGE_ALLOWANCE', periodStart: { lt: periodStart }, quantityAvailable: { gt: 0 } } });
            for (const lot of old) {
              await tx.featureCreditLot.update({ where: { id: lot.id }, data: { quantityAvailable: 0 } });
              await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: subscription.id, featureId: allowance.featureId, creditLotId: lot.id, sourceType: 'PACKAGE_ALLOWANCE', sourceId: allowance.id, transactionType: 'EXPIRE', quantity: lot.quantityAvailable.negated(), balanceAfter: 0, referenceType: 'ALLOWANCE_RESET', referenceId: sourceKey, occurredAt: now } });
            }
          }
          const lot = await tx.featureCreditLot.create({ data: { clientId, subscriptionId: subscription.id, featureId: allowance.featureId, sourceType: 'PACKAGE_ALLOWANCE', sourceId: allowance.id, sourceKey, quantityOriginal: allowance.includedQuantity, quantityAvailable: allowance.includedQuantity, periodStart } });
          await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: subscription.id, featureId: allowance.featureId, creditLotId: lot.id, sourceType: 'PACKAGE_ALLOWANCE', sourceId: allowance.id, transactionType: 'CREDIT', quantity: allowance.includedQuantity, referenceType: 'PACKAGE_ALLOWANCE_RESET', referenceId: sourceKey, occurredAt: now } });
        }
      }
      const lots = await tx.featureCreditLot.findMany({ where: { clientId, featureId: allowance.featureId, quantityAvailable: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ sourceType: 'PACKAGE_ALLOWANCE', subscriptionId: subscription.id }, { sourceType: 'FEATURE_ADDON', purchase: { status: 'ACTIVE' } }] }] }, orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }] });
      const lot = lots.find((item) => item.sourceType === 'PACKAGE_ALLOWANCE') ?? lots[0];
      if (!lot) throw new ConflictException('SMS quota exhausted. Activate an SMS add-on to continue.');
      await tx.featureCreditLot.update({ where: { id: lot.id }, data: { quantityAvailable: { decrement: 1 } } });
      if (lot.purchaseId) await tx.clientFeatureAddOnPurchase.update({ where: { id: lot.purchaseId }, data: { quantityConsumed: { increment: 1 }, quantityRemaining: { decrement: 1 }, ...(lot.quantityAvailable.lte(1) ? { status: 'CONSUMED' } : {}) } });
      await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: subscription.id, featureId: allowance.featureId, creditLotId: lot.id, sourceType: lot.sourceType, sourceId: lot.sourceId, transactionType: 'DEBIT', quantity: -1, balanceAfter: lot.quantityAvailable.minus(1), referenceType: 'LOGIN_OTP', referenceId: requestId, occurredAt: now } });
      return [lot.id];
    });
  }

  async refund(clientId: string, requestId: string) {
    await this.prisma.$transaction(async (tx) => {
      const debits = await tx.featureUsageLedger.findMany({ where: { clientId, referenceType: 'LOGIN_OTP', referenceId: requestId, transactionType: 'DEBIT' } });
      for (const debit of debits) {
        if (!debit.creditLotId) continue;
        const lot = await tx.featureCreditLot.update({ where: { id: debit.creditLotId }, data: { quantityAvailable: { increment: 1 } } });
        if (lot.purchaseId) await tx.clientFeatureAddOnPurchase.update({ where: { id: lot.purchaseId }, data: { quantityConsumed: { decrement: 1 }, quantityRemaining: { increment: 1 }, status: 'ACTIVE' } });
        await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: debit.subscriptionId, featureId: debit.featureId, creditLotId: lot.id, sourceType: debit.sourceType, sourceId: debit.sourceId, transactionType: 'ADJUSTMENT', quantity: 1, balanceAfter: lot.quantityAvailable, referenceType: 'LOGIN_OTP_REFUND', referenceId: requestId } });
      }
    });
  }
}
