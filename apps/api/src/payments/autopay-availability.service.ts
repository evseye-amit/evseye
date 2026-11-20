import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const reasons = {
  PLATFORM_DISABLED:
    'Onboarding AutoPay is not available on this platform yet.',
  RAZORPAY_DISABLED: 'Razorpay AutoPay is currently unavailable.',
  MERCHANT_UNAVAILABLE:
    'An active Razorpay merchant with a saved configuration is required. Contact your platform administrator.',
  PACKAGE_UNAVAILABLE:
    'Your active package must include UPI AutoPay. Contact your platform administrator.',
  PACKAGE_TERMS_INVALID:
    'Your package AutoPay terms need to be corrected by your platform administrator.',
};
type Reason = keyof typeof reasons;

@Injectable()
export class AutoPayAvailabilityService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async availability(clientId: string, db: Prisma.TransactionClient = this.db) {
    const environment = (
      this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'TEST'
    ).toUpperCase();
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [funding, merchants, subscription] = await Promise.all([
      db.walletAutoRechargePolicy.findUnique({ where: { clientId } }),
      db.clientPaymentProvider.findMany({
        where: { clientId, environment },
        include: { versions: true },
      }),
      db.clientSubscription.findFirst({
        where: {
          clientId,
          status: 'ACTIVE',
          startDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
          client: { status: 'ACTIVE', isActive: true },
        },
        orderBy: { startDate: 'desc' },
        include: {
          package: {
            include: {
              features: {
                where: {
                  isIncluded: true,
                  feature: { code: 'RIDER_AUTO_PAY', isActive: true },
                },
                include: { feature: true },
              },
            },
          },
        },
      }),
    ]);
    const active = merchants.filter(
      (m) =>
        m.status === 'ACTIVE' &&
        m.validFrom <= now &&
        (!m.validUntil || m.validUntil >= now),
    );
    const merchant =
      active.length === 1 && active[0].provider === 'RAZORPAY'
        ? active[0]
        : null;
    const snapshot = merchant?.versions.find(
      (v) =>
        v.version === merchant.currentVersion &&
        v.clientId === clientId &&
        v.provider === 'RAZORPAY' &&
        v.environment === environment &&
        v.keyId === merchant.keyId &&
        v.secretReference === merchant.secretReference &&
        v.credentialFingerprint,
    );
    const raw = subscription?.package.isActive
      ? subscription.package.features[0]?.feature.configuration
      : null;
    const cfg =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    const included =
      !!cfg &&
      Array.isArray(cfg.paymentMethods) &&
      cfg.paymentMethods.includes('UPI_AUTOPAY');
    let terms: { maxAmount: string; validityDays: number } | null = null;
    const validMoney = (value: unknown) =>
      (typeof value === 'string' || typeof value === 'number') &&
      /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(String(value)) &&
      new Prisma.Decimal(String(value)).gt(0);
    if (
      included &&
      validMoney(cfg.mandateMaxAmount) &&
      typeof cfg.validityDays === 'number' &&
      Number.isSafeInteger(cfg.validityDays) &&
      cfg.validityDays > 0 &&
      (cfg.authorizationAmount == null ||
        (validMoney(cfg.authorizationAmount) &&
          new Prisma.Decimal(String(cfg.authorizationAmount)).lte(
            String(cfg.mandateMaxAmount),
          )))
    ) {
      terms = {
        maxAmount: Prisma.Decimal.min(
          String(cfg.mandateMaxAmount),
          15000,
        ).toFixed(2),
        validityDays: cfg.validityDays,
      };
    }
    let reason: Reason | null = null;
    if (this.config.get('RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED') !== 'true')
      reason = 'PLATFORM_DISABLED';
    else if (
      this.config.get('RAZORPAY_ENABLED') !== 'true' ||
      this.config.get('RAZORPAY_AUTOPAY_ENABLED') !== 'true'
    )
      reason = 'RAZORPAY_DISABLED';
    else if (!snapshot) reason = 'MERCHANT_UNAVAILABLE';
    else if (!included) reason = 'PACKAGE_UNAVAILABLE';
    else if (!terms) reason = 'PACKAGE_TERMS_INVALID';
    const unified = unifiedAutoPayEnabled(this.config, clientId);
    if (!reason && unified && funding && terms && (new Prisma.Decimal(terms.maxAmount).lt(funding.rechargeAmount) || terms.validityDays < 2)) reason = 'PACKAGE_TERMS_INVALID';
    const enabled = funding?.enabled ?? false;
    return {
      enabled,
      revision: funding?.revision ?? 0,
      effectiveEnabled: unified && enabled && !reason,
      canEnable: !reason,
      reason,
      reasonMessage: reason ? reasons[reason] : null,
      provider: merchant ? 'RAZORPAY' : null,
      environment,
      terms,
      updatedAt: funding?.updatedAt ?? null,
      updatedBy: null,
    };
  }

}
