import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const action = 'DEPLOYMENT_AUTOPAY_POLICY_UPDATED';
const entityType = 'ClientDeploymentAutoPayPolicy';
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
export class DeploymentAutoPayPolicyService {
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
    const [policy, merchants, subscription] = await Promise.all([
      db.clientDeploymentAutoPayPolicy.findUnique({ where: { clientId } }),
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
    const funding = unified ? await db.walletAutoRechargePolicy.findUnique({ where: { clientId } }) : null;
    if (unified && funding && terms && (new Prisma.Decimal(terms.maxAmount).lt(funding.rechargeAmount) || terms.validityDays < 2)) reason = 'PACKAGE_TERMS_INVALID';
    const enabled = unified ? funding?.enabled ?? false : policy?.enabled ?? false;
    return {
      enabled,
      revision: policy?.revision ?? 0,
      effectiveEnabled: enabled && !reason,
      canEnable: !reason,
      reason,
      reasonMessage: reason ? reasons[reason] : null,
      provider: merchant ? 'RAZORPAY' : null,
      environment,
      terms,
      updatedAt: policy?.updatedAt ?? null,
      updatedBy: policy?.updatedBy ?? null,
    };
  }

  async get(clientId: string) {
    const policy = await this.availability(clientId);
    const actor = policy.updatedBy
      ? await this.db.user.findFirst({
          where: { id: policy.updatedBy, clientId },
          select: { name: true },
        })
      : null;
    return { ...policy, updatedByName: actor?.name ?? null };
  }

  async set(
    clientId: string,
    actorId: string,
    input: { enabled: boolean; revision: number },
  ) {
    if (unifiedAutoPayEnabled(this.config, clientId)) throw new ConflictException("Use the unified AutoPay policy settings.");
    await this.db.$transaction(async (tx) => {
      // Serialize policy saves with new combined checkout creation.
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
      const previous = await this.availability(clientId, tx);
      if (previous.revision !== input.revision)
        throw new ConflictException({
          code: 'POLICY_REVISION_CONFLICT',
          message:
            'Settings changed. Reload the latest settings before saving.',
        });
      if (input.enabled && !previous.canEnable)
        throw new BadRequestException({
          code: previous.reason,
          message: previous.reasonMessage,
        });
      if (previous.enabled === input.enabled) return;
      const revision = previous.revision + 1;
      await tx.clientDeploymentAutoPayPolicy.upsert({
        where: { clientId },
        create: {
          clientId,
          enabled: input.enabled,
          revision,
          updatedBy: actorId,
        },
        update: { enabled: input.enabled, revision, updatedBy: actorId },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action,
          entityType,
          entityId: clientId,
          previousData: {
            enabled: previous.enabled,
            revision: previous.revision,
          },
          newData: { enabled: input.enabled, revision },
        },
      });
    });
    return this.get(clientId);
  }

  async history(clientId: string, page: number) {
    const rows = await this.db.auditLog.findMany({
      where: { clientId, action, entityType, entityId: clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 20,
      take: 21,
      select: {
        id: true,
        createdAt: true,
        actor: { select: { name: true } },
        previousData: true,
        newData: true,
      },
    });
    return {
      items: rows
        .slice(0, 20)
        .map(({ id, actor, ...row }) => ({
          ...row,
          id: id.toString(),
          actorName: actor?.name ?? null,
        })),
      page,
      hasMore: rows.length > 20,
    };
  }
}
