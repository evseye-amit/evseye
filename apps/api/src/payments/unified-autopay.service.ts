import { DeploymentAutoPayPolicyService } from './deployment-autopay-policy.service.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import { ConflictException, Injectable, NotFoundException, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletAutoRechargeService } from './wallet-auto-recharge.service.js';

@Injectable()
export class UnifiedAutoPayService {
  private readonly logger = new Logger(UnifiedAutoPayService.name);
  constructor(private readonly db: PrismaService, private readonly funding: WalletAutoRechargeService, private readonly config: ConfigService, @Optional() private readonly availability?: DeploymentAutoPayPolicyService) {}

  async prepareSetup(clientId: string, userId: string) {
    const state = await this.current(clientId, userId);
    if (!state.actions.canSetup && !['AUTHORIZATION_PENDING', 'ACTIVE', 'WAITING_FOR_ALLOCATION', 'OFF'].includes(state.effectiveStatus)) throw new ConflictException('AUTOPAY_SETUP_UNAVAILABLE');
    const rider = await this.db.rider.findFirstOrThrow({ where: { clientId, userId, deletedAt: null } });
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${rider.id} AND "clientId"=${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE "riderId"=${rider.id} AND "clientId"=${clientId} FOR UPDATE`;
      if (await tx.paymentTransaction.findFirst({ where: { clientId, riderId: rider.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } } })) throw new ConflictException('AUTOPAY_MIGRATION_BLOCKED');
      await tx.riderPaymentProfile.upsert({ where: { clientId_riderId: { clientId, riderId: rider.id } }, create: { clientId, riderId: rider.id, collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true }, update: { collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true } });
      await tx.auditLog.create({ data: { clientId, actorId: userId, action: 'UNIFIED_AUTOPAY_SETUP_STARTED', entityType: 'Rider', entityId: rider.id } });
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverOnboarding() {
    if (this.config.get("UNIFIED_AUTOPAY_ENABLED") !== "true") return;
    const attempts = await this.db.deploymentPaymentAttempt.findMany({ where: { autoPayMandateId: { not: null }, autoPayConsent: { path: ['scope'], equals: 'WALLET_FUNDING' }, autoPayMandate: { status: 'ACTIVE', walletAutoRechargePreferences: { none: {} } } }, take: 100, orderBy: { checkedAt: 'asc' } });
    for (const attempt of attempts) {
      const consent = attempt.autoPayConsent as { actorId?: string; consentRevision?: number; acceptedAt?: string } | null;
      await this.db.deploymentPaymentAttempt.update({ where: { id: attempt.id }, data: { checkedAt: new Date() } });
      if (!consent?.acceptedAt || !Number.isFinite(Date.parse(consent.acceptedAt)) || !consent?.actorId || !consent.consentRevision || !attempt.autoPayMandateId || !unifiedAutoPayEnabled(this.config, attempt.clientId)) continue;
      try { await this.funding.setEnabled(attempt.clientId, consent.actorId, { enabled: true, unified: true, mandateId: attempt.autoPayMandateId, consentRevision: consent.consentRevision, expectedRevision: 0, recoveryConsentAt: new Date(consent.acceptedAt) }); }
      catch { this.logger.warn(`Onboarding funding consent requires review: ${attempt.id}`); }
    }
  }
  async current(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({ where: { clientId, userId, deletedAt: null } });
    if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');
    const funding = await this.funding.current(clientId, userId);
    const [profile, mandate, allocation, pendingLegacy] = await Promise.all([
      this.db.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId: rider.id } } }),
      this.db.paymentMandate.findFirst({ where: { clientId, riderId: rider.id }, orderBy: { createdAt: 'desc' } }),
      this.db.allocation.findFirst({ where: { clientId, riderId: rider.id, status: 'ACTIVE', allocatedAt: { not: null } } }),
      this.db.paymentTransaction.findFirst({ where: { clientId, riderId: rider.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } } }),
    ]);
    const availability = await this.availability?.availability(clientId);
    const rollout = unifiedAutoPayEnabled(this.config, clientId) && (availability?.canEnable ?? true);
    const usable = mandate?.status === 'ACTIVE' && !mandate.providerCancelRequestedAt && mandate.provider === 'RAZORPAY' && mandate.maxAmount.gte(funding.policy.rechargeAmount) && mandate.expiresAt.getTime() > Date.now() + 25 * 3600000 + 300000;
    const status = !rollout || !funding.policy.enabled ? 'PAUSED_BY_CLIENT'
      : pendingLegacy ? 'MIGRATION_BLOCKED'
      : !mandate ? 'SETUP_REQUIRED'
      : ['CREATING', 'CREATED', 'AUTHORIZATION_PENDING', 'UNKNOWN'].includes(mandate.status) ? 'AUTHORIZATION_PENDING'
      : !usable ? 'MANDATE_ACTION_REQUIRED'
      : funding.consentRequired || (funding.enabled && funding.mandateId !== mandate.id) ? 'CONSENT_REQUIRED'
      : funding.actionRequired ? 'ACTION_REQUIRED'
      : !funding.enabled ? 'OFF'
      : !allocation ? 'WAITING_FOR_ALLOCATION' : 'ACTIVE';
    return { contractVersion: 2, ...funding, effectiveStatus: status, collectionMode: profile?.collectionMode ?? 'LEGACY_INVOICE',
      consentVersion: 'unified-autopay-v1',
      setupTerms: availability?.terms ?? null,
      reasonCode: ['ACTIVE', 'OFF'].includes(status) ? null : availability?.reason ?? status,
      mandate: mandate ? { id: mandate.id, status: mandate.status, maxAmount: mandate.maxAmount.toFixed(2), expiresAt: mandate.expiresAt, cancellationPending: !!mandate.providerCancelRequestedAt, authorization: mandate.authorizationUrl && ['CREATED', 'AUTHORIZATION_PENDING'].includes(mandate.status) ? { type: 'HOSTED', url: mandate.authorizationUrl } : null } : null,
      actions: { canEnable: rollout && funding.policy.enabled && !!usable && !pendingLegacy, canDisable: funding.enabled, canSetup: rollout && funding.policy.enabled && (!mandate || ['CANCELLED', 'EXPIRED', 'FAILED'].includes(mandate.status)) },
    };
  }
  async set(clientId: string, userId: string, input: { enabled: boolean; expectedRevision: number; mandateId?: string; consentRevision?: number; consentVersion?: string }) {
    if (input.enabled && input.consentVersion !== 'unified-autopay-v1') throw new ConflictException('AUTOPAY_CONSENT_REQUIRED');
    if (input.enabled && this.availability && !(await this.availability.availability(clientId)).canEnable) throw new ConflictException('AUTOPAY_UNAVAILABLE');
    await this.funding.setEnabled(clientId, userId, { ...input, unified: true });
    return this.current(clientId, userId);
  }
  async recharges(clientId: string, userId: string, page: number) {
    const rider = await this.db.rider.findFirst({ where: { clientId, userId, deletedAt: null } });
    if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');
    const rows = await this.db.walletAutoRecharge.findMany({ where: { clientId, riderId: rider.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 30, take: 31 });
    return { items: rows.slice(0, 30).map(row => this.funding.view(row)), page, hasMore: rows.length > 30 };
  }
}
