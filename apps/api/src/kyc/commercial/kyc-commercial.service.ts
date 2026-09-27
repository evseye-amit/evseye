import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { KycVerificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

const featureCode: Partial<Record<KycVerificationType, string>> = {
  PAN_VERIFICATION: 'PAN_VERIFICATION',
  AADHAAR_OTP: 'AADHAAR_VERIFICATION',
  BANK_ACCOUNT_VERIFICATION: 'BANK_VERIFICATION',
  IFSC_VERIFICATION: 'IFSC_VERIFICATION',
};

function billingPeriod(startDate: Date, cycle: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY', now: Date) {
  const anchor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  if (cycle === 'ONCE') return { start: anchor, end: null };
  const step = cycle === 'MONTHLY' ? 1 : cycle === 'QUARTERLY' ? 3 : cycle === 'HALF_YEARLY' ? 6 : 12;
  const addMonths = (months: number) => {
    const index = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
    const year = Math.floor(index / 12); const month = ((index % 12) + 12) % 12;
    const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return new Date(Date.UTC(year, month, day));
  };
  const diff = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  let count = Math.max(0, Math.floor(diff / step));
  if (addMonths(count * step) > now) count = Math.max(0, count - 1);
  return { start: addMonths(count * step), end: addMonths((count + 1) * step) };
}

@Injectable()
export class KycCommercialService {
  constructor(private readonly prisma: PrismaService) {}

  async policy(clientId: string, type: KycVerificationType, now = new Date()) {
    return this.prisma.kycClientPolicy.findFirst({ where: { clientId, verificationType: type, status: 'ACTIVE',
      effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
  }

  async entitlement(clientId: string, type: KycVerificationType, now = new Date()) {
    const policy = await this.policy(clientId, type, now);
    if (policy && !policy.isEnabled) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    const code = featureCode[type];
    if (!code) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    const feature = await this.prisma.feature.findUnique({ where: { code } });
    // IFSC lookup predates package billing. It remains an explicitly free operational lookup
    // until the catalog contains an IFSC feature; a client policy can still disable it.
    if (type === 'IFSC_VERIFICATION' && !feature) return { policy, feature: null, subscription: null, clientFeature: null };
    if (!feature?.isActive) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    const subscription = await this.prisma.clientSubscription.findFirst({ where: { clientId, status: 'ACTIVE',
      startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
    orderBy: { startDate: 'desc' } });
    if (!subscription) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    const clientFeature = await this.prisma.clientFeature.findFirst({ where: { clientId, subscriptionId: subscription.id,
      featureId: feature.id, enabled: true, effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } });
    if (!clientFeature) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    if (clientFeature.source === 'PACKAGE') {
      const packageFeature = await this.prisma.packageFeature.findUnique({ where: {
        packageId_featureId: { packageId: subscription.packageId, featureId: feature.id } } });
      if (!packageFeature?.isIncluded) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    }
    return { policy, feature, subscription, clientFeature };
  }

  /** Called in the same transaction that creates the one business verification. */
  async consume(tx: Prisma.TransactionClient, clientId: string, type: KycVerificationType, verificationId: string,
    resolved: Awaited<ReturnType<KycCommercialService['entitlement']>>) {
    const { policy, feature, subscription, clientFeature } = resolved;
    if (!feature || !subscription || !clientFeature) return;
    if (policy?.usageRecognition && policy.usageRecognition !== 'ON_REQUEST')
      throw new ServiceUnavailableException('KYC_COMMERCIAL_CONFIGURATION_ERROR');
    // Serialize all consumption of one client/feature, including the empty-lot overage case.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${clientId}), hashtext(${feature.id}))::text`);
    const prior = await tx.featureUsageConsumption.findUnique({ where: { verificationId } });
    if (prior) return prior;
    const now = new Date();
    const period = billingPeriod(subscription.startDate, subscription.billingCycle, now);
    const lots = await tx.$queryRaw<Array<{ id: string; sourceType: 'PACKAGE_ALLOWANCE' | 'FEATURE_ADDON' | 'MANUAL_ADJUSTMENT' | 'PROMOTIONAL_CREDIT'; purchaseId: string | null; quantityAvailable: Prisma.Decimal; sourceId: string | null }>>(Prisma.sql`
      SELECT "id", "sourceType", "purchaseId", "quantityAvailable", "sourceId" FROM "FeatureCreditLot"
      WHERE "clientId" = ${clientId} AND "subscriptionId" = ${subscription.id} AND "featureId" = ${feature.id}
        AND "quantityAvailable" >= 1 AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      ORDER BY CASE WHEN "sourceType" = 'PACKAGE_ALLOWANCE' THEN 0 ELSE 1 END,
        "expiresAt" ASC NULLS LAST, "createdAt" ASC FOR UPDATE`);
    const lot = lots[0];
    let source: 'INCLUDED' | 'ADD_ON' | 'UNLIMITED' | 'OVERAGE';
    let pricing: { basePrice: Prisma.Decimal; discount: Prisma.Decimal; effectivePrice: Prisma.Decimal;
      currency: string; pricingReferenceId: string } | null = null;
    if (lot) source = lot.sourceType === 'FEATURE_ADDON' ? 'ADD_ON' : 'INCLUDED';
    else if (clientFeature.unlimitedUsage) source = 'UNLIMITED';
    else if (policy?.overagePolicy === 'ALLOW_AND_CHARGE' || policy?.overagePolicy === 'ALLOW_WITH_WARNING') {
      source = 'OVERAGE';
      const clientPrice = await tx.clientFeaturePricing.findFirst({ where: { clientFeatureId: clientFeature.id,
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
      if (clientPrice) pricing = { basePrice: clientPrice.listUnitPrice,
        discount: Prisma.Decimal.max(0, clientPrice.listUnitPrice.minus(clientPrice.finalUnitPrice)),
        effectivePrice: clientPrice.finalUnitPrice, currency: clientPrice.currency, pricingReferenceId: clientPrice.id };
      else {
        const base = await tx.featurePricing.findFirst({ where: { featureId: feature.id, isActive: true,
          effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
        if (!base) throw new ServiceUnavailableException('KYC_COMMERCIAL_CONFIGURATION_ERROR');
        const adjustments = await tx.clientPricingAdjustment.findMany({ where: { clientId, isActive: true,
          adjustmentScope: 'FEATURE', validFrom: { lte: now },
          AND: [{ OR: [{ validTo: null }, { validTo: { gte: now } }] },
            { OR: [{ subscriptionId: null }, { subscriptionId: subscription.id }] },
            { OR: [{ referenceId: null }, { referenceId: feature.id }] }] },
        orderBy: { createdAt: 'asc' } });
        let effective = new Prisma.Decimal(base.salePrice);
        for (const adjustment of adjustments) effective = adjustment.adjustmentType === 'PERCENTAGE'
          ? effective.minus(effective.mul(adjustment.adjustmentValue).div(100))
          : adjustment.adjustmentType === 'FIXED_AMOUNT' ? effective.minus(adjustment.adjustmentValue)
            : new Prisma.Decimal(adjustment.adjustmentValue);
        effective = Prisma.Decimal.max(0, effective);
        pricing = { basePrice: base.salePrice, discount: Prisma.Decimal.max(0, base.salePrice.minus(effective)), effectivePrice: effective,
          currency: base.currency, pricingReferenceId: base.id };
      }
    } else throw new BadRequestException('KYC_USAGE_LIMIT_EXCEEDED');
    if (lot) {
      await tx.featureCreditLot.update({ where: { id: lot.id }, data: { quantityAvailable: { decrement: 1 } } });
      if (lot.purchaseId) {
        const purchase = await tx.clientFeatureAddOnPurchase.update({ where: { id: lot.purchaseId },
          data: { quantityConsumed: { increment: 1 }, quantityRemaining: { decrement: 1 } } });
        if (purchase.quantityRemaining.lte(0)) await tx.clientFeatureAddOnPurchase.update({ where: { id: lot.purchaseId },
          data: { status: 'CONSUMED', quantityRemaining: 0 } });
      }
      await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: subscription.id, featureId: feature.id,
        creditLotId: lot.id, sourceType: lot.sourceType, sourceId: lot.sourceId, transactionType: 'DEBIT',
        quantity: -1, balanceAfter: lot.quantityAvailable.minus(1), referenceType: 'KYC_VERIFICATION',
        referenceId: verificationId, occurredAt: now } });
    }
    const consumption = await tx.featureUsageConsumption.create({ data: { clientId, subscriptionId: subscription.id,
      featureId: feature.id, verificationId, source, quantity: 1, policyId: policy?.id,
      recognition: policy?.usageRecognition ?? 'ON_REQUEST', occurredAt: now,
      billingPeriodStart: period.start, billingPeriodEnd: period.end,
      basePrice: pricing?.basePrice, discount: pricing?.discount, effectivePrice: pricing?.effectivePrice,
      currency: pricing?.currency, pricingReferenceId: pricing?.pricingReferenceId } });
    await tx.auditLog.create({ data: { clientId, action: 'KYC_USAGE_COMMITTED', entityType: 'FEATURE_USAGE_CONSUMPTION',
      entityId: consumption.id, newData: { verificationId, featureCode: feature.code, source } } });
    if (source === 'OVERAGE' && policy?.overagePolicy === 'ALLOW_WITH_WARNING')
      await tx.auditLog.create({ data: { clientId, action: 'KYC_USAGE_OVERAGE_WARNING',
        entityType: 'FEATURE_USAGE_CONSUMPTION', entityId: consumption.id,
        newData: { verificationId, featureCode: feature.code } } });
    return consumption;
  }

  async reverse(clientId: string, verificationId: string, reason: string) {
    if (reason.trim().length < 8 || reason.length > 500) throw new BadRequestException('KYC_REVERSAL_REASON_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      const usage = await tx.featureUsageConsumption.findUnique({ where: { verificationId } });
      if (!usage || usage.clientId !== clientId) throw new NotFoundException('KYC_USAGE_NOT_FOUND');
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${clientId}), hashtext(${usage.featureId}))::text`);
      const changed = await tx.featureUsageConsumption.updateMany({ where: { id: usage.id, reversedAt: null },
        data: { reversedAt: new Date(), reversalReason: reason.trim() } });
      if (!changed.count) throw new ConflictException('KYC_USAGE_ALREADY_REVERSED');
      const debit = await tx.featureUsageLedger.findFirst({ where: { clientId, featureId: usage.featureId,
        referenceType: 'KYC_VERIFICATION', referenceId: verificationId, transactionType: 'DEBIT' } });
      if (debit?.creditLotId) {
        const lot = await tx.featureCreditLot.update({ where: { id: debit.creditLotId },
          data: { quantityAvailable: { increment: usage.quantity } } });
        if (lot.purchaseId) await tx.clientFeatureAddOnPurchase.update({ where: { id: lot.purchaseId },
          data: { quantityConsumed: { decrement: usage.quantity }, quantityRemaining: { increment: usage.quantity }, status: 'ACTIVE' } });
        await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: usage.subscriptionId,
          featureId: usage.featureId, creditLotId: lot.id, sourceType: debit.sourceType, sourceId: debit.sourceId,
          transactionType: 'ADJUSTMENT', quantity: usage.quantity, balanceAfter: lot.quantityAvailable,
          referenceType: 'KYC_USAGE_REVERSAL', referenceId: verificationId, metadata: { reason: reason.trim() } } });
      } else await tx.featureUsageLedger.create({ data: { clientId, subscriptionId: usage.subscriptionId,
        featureId: usage.featureId, sourceType: 'MANUAL_ADJUSTMENT', transactionType: 'ADJUSTMENT',
        quantity: usage.quantity, referenceType: 'KYC_USAGE_REVERSAL', referenceId: verificationId,
        metadata: { reason: reason.trim(), source: usage.source } } });
      return tx.featureUsageConsumption.findUniqueOrThrow({ where: { id: usage.id } });
    });
  }
}
