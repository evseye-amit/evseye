import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type DeploymentPaymentAttempt } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MandateService } from './mandate.service.js';
import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';
import { RazorpayRecurringClient } from './razorpay/razorpay-recurring.client.js';
import {
  DeploymentAutoPayBridge,
  type DeploymentAutoPayHandler,
} from './razorpay/deployment-autopay-bridge.js';
import type { RazorpayCredentials } from './razorpay/razorpay-configuration.service.js';
import type { DeploymentCheckoutOptions } from './deployment-payment-provider.interface.js';

@Injectable()
export class DeploymentAutoPayService
  implements OnModuleInit, DeploymentAutoPayHandler
{
  private readonly logger = new Logger(DeploymentAutoPayService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly mandates: MandateService,
    private readonly gateway: RazorpayRecurringClient,
    private readonly policy: PaymentGatewayPolicyService,
    private readonly config: ConfigService,
    private readonly bridge: DeploymentAutoPayBridge,
  ) {}
  onModuleInit() {
    this.bridge.register(this);
  }

  async prepare(
    clientId: string,
    userId: string,
    merchant: RazorpayCredentials,
    amount: Prisma.Decimal,
    currency: string,
    options: DeploymentCheckoutOptions,
    tx?: Prisma.TransactionClient,
  ) {
    if (
      this.config.get('RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED') !== 'true' ||
      this.config.get('RAZORPAY_AUTOPAY_ENABLED') !== 'true'
    )
      throw new ServiceUnavailableException({
        code: 'AUTOPAY_UNAVAILABLE',
        message: 'Combined AutoPay checkout is disabled.',
      });
    if (tx) await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
    const availability = await this.policy.deploymentAutoPay(clientId, tx);
    if (!availability.effectiveEnabled) throw new ServiceUnavailableException({
      code: 'AUTOPAY_UNAVAILABLE',
      message: availability.reasonMessage ?? 'Onboarding AutoPay is disabled for this client.',
    });
    const unified = unifiedAutoPayEnabled(this.config, clientId);
    const funding = unified ? await (tx ?? this.db).walletAutoRechargePolicy.findUnique({ where: { clientId } }) : null;
    if (unified && (!funding?.enabled || (options.autoPayConsent && funding.revision !== options.autoPayConsent.consentRevision))) throw new ConflictException('AUTOPAY_CONSENT_CHANGED');
    if (
      !options.email ||
      (options.autoPayConsent && (options.autoPayConsent.accepted !== true ||
      options.autoPayConsent.version !== (unified ? 'unified-autopay-v1' : 'deployment-autopay-v1')))
    )
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Email and valid checkout terms are required.',
      });
    const context = await this.mandates.deploymentContext(clientId, userId);
    await this.policy.resolve(clientId, 'UPI_AUTOPAY', 'RAZORPAY');
    const recurring = await this.gateway.configurationFor(clientId);
    if (
      !merchant.configurationVersionId ||
      recurring.configurationVersionId !== merchant.configurationVersionId ||
      recurring.keyId !== merchant.keyId ||
      recurring.environment !== merchant.environment
    )
      throw new ServiceUnavailableException({
        code: 'AUTOPAY_UNAVAILABLE',
        message: 'Payment and AutoPay must use the same merchant version.',
      });
    const maxAmount = Prisma.Decimal.min(
      context.maxAmount,
      new Prisma.Decimal(15000),
    );
    if (
      options.autoPayConsent && (!maxAmount.eq(options.autoPayConsent.maxAmount) ||
      options.autoPayConsent.validityDays !== context.validityDays)
    )
      throw new ConflictException({
        code: 'AUTOPAY_TERMS_CHANGED',
        message: 'AutoPay terms changed. Review and accept the current terms.',
      });
    if (currency !== 'INR' || amount.gt(maxAmount) || amount.lt(1))
      throw new BadRequestException({
        code: 'AUTOPAY_LIMIT_EXCEEDED',
        message:
          'The onboarding amount is outside the supported AutoPay limit.',
      });
    if (tx)
      await this.mandates.assertNoOpenMandate(tx, clientId, context.rider.id);
    else
      await this.db.$transaction((tx) =>
        this.mandates.assertNoOpenMandate(tx, clientId, context.rider.id),
      );
    const expiresAt = new Date(
      Math.floor((Date.now() + context.validityDays * 86400000) / 1000) * 1000,
    );
    return {
      maxAmount,
      expiresAt,
      consent: {
        version: unified ? 'unified-autopay-v1' : 'deployment-autopay-v1',
        // Checkout creation is not authorization. Provider confirmation is recorded later.
        authorizationSource: 'PROVIDER_CHECKOUT',
        termsCreatedAt: new Date().toISOString(),
        actorId: userId,
        riderId: context.rider.id,
        riderName: context.rider.name,
        mobile: context.rider.mobile,
        email: options.email,
        maxAmount: maxAmount.toFixed(2),
        currency: 'INR',
        validityDays: context.validityDays,
        frequency: 'as_presented',
        expiresAt: expiresAt.toISOString(),
        scope: unified ? 'WALLET_FUNDING' : 'INVOICE_AUTO_DEBIT',
        ...(funding ? { consentRevision: funding.revision, threshold: funding.threshold.toFixed(2), rechargeAmount: funding.rechargeAmount.toFixed(2) } : {}),
      } satisfies Prisma.InputJsonObject,
    };
  }

  async createOrder(attempt: DeploymentPaymentAttempt) {
    let saved = await this.db.deploymentPaymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (!saved.autoPayOrderClaimedAt) {
      const consent = saved.autoPayConsent as Record<string, string>;
      if (!saved.autoPayCustomerId) {
        // Exact customer details are immutable; fail_existing=0 makes a timeout retry safe.
        const customer = await this.gateway.createCustomer(
          {
            name: consent.riderName!,
            contact: consent.mobile!,
            email: saved.autoPayEmail!,
          },
          saved.clientId,
          saved.configurationVersionId,
        );
        await this.db.deploymentPaymentAttempt.updateMany({
          where: { id: saved.id, autoPayCustomerId: null },
          data: { autoPayCustomerId: customer.id },
        });
        saved = await this.db.deploymentPaymentAttempt.findUniqueOrThrow({
          where: { id: saved.id },
        });
      }
      const claim = await this.db.deploymentPaymentAttempt.updateMany({
        where: { id: saved.id, autoPayOrderClaimedAt: null },
        data: { autoPayOrderClaimedAt: new Date() },
      });
      if (claim.count)
        return this.gateway.createAuthorizationOrder(
          {
            amount: Number(saved.amountPaise),
            currency: 'INR',
            receipt: saved.id,
            customer_id: saved.autoPayCustomerId,
            method: 'upi',
            payment_capture: true,
            notes: {
              deploymentPaymentId: saved.deploymentPaymentId,
              purpose: 'DEPLOYMENT_WITH_AUTOPAY',
            },
            token: {
              max_amount: saved.autoPayMaxAmount!.mul(100).toNumber(),
              expire_at: Math.floor(saved.autoPayExpiresAt!.getTime() / 1000),
              frequency: 'as_presented',
            },
          },
          saved.clientId,
          saved.configurationVersionId,
        );
    }
    const matches = await this.gateway.findOrders(
      saved.id,
      saved.clientId,
      saved.configurationVersionId,
    );
    if (matches.length !== 1)
      throw new ConflictException({
        code: 'RAZORPAY_ORDER_UNKNOWN',
        message:
          'The original payment order is being recovered. Do not start another payment.',
      });
    return matches[0]!;
  }

  /** Called after financial settlement and on every deployment reconciliation. */
  async recover(attemptId: string, paymentId?: string) {
    try {
      await this.recoverStored(attemptId, paymentId);
    } catch {
      // A provider/setup failure must never turn a settled onboarding payment into a failed payment.
      this.logger.warn(
        `AutoPay setup recovery pending for deployment attempt ${attemptId}`,
      );
      await this.db.deploymentPaymentAttempt.updateMany({
        where: {
          id: attemptId,
          autoPayMandateId: null,
          autoPayStatus: { notIn: ['FAILED', 'CANCELLED', 'EXPIRED'] },
          OR: [
            { autoPayFailureCode: null },
            { autoPayFailureCode: 'AUTOPAY_RECOVERY_PENDING' },
          ],
        },
        data: {
          autoPayStatus: 'UNKNOWN',
          autoPayFailureCode: 'AUTOPAY_RECOVERY_PENDING',
        },
      });
    }
  }

  private async recoverStored(attemptId: string, paymentId?: string) {
    const a = await this.db.deploymentPaymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { captures: true, payment: { include: { workflow: true } } },
    });
    if (!a.autoPayRequested || !a.providerOrderId) return;
    // Never bind a token from a refunded, duplicate, cancelled or otherwise unaccepted capture.
    const capture = a.captures.find(
      (c) =>
        c.status === 'SETTLED' &&
        a.payment.status === 'PAID' &&
        a.payment.providerReference === c.providerPaymentId,
    );
    const candidate = paymentId
      ? a.captures.find((c) => c.providerPaymentId === paymentId)
      : (capture ?? a.captures[0]);
    if (!candidate) return;
    const bound = a.autoPayMandateId
      ? await this.db.paymentMandate.findUniqueOrThrow({
          where: { id: a.autoPayMandateId },
        })
      : null;
    if (bound?.providerAuthorizationPaymentId === candidate.providerPaymentId) {
      await this.mandates.reconcileStored(bound.id);
      return;
    }
    if (candidate.autoPayCleanupStatus === 'DONE') return;
    const payment = await this.gateway.recurringPayment(
      candidate.providerPaymentId,
      a.clientId,
      a.configurationVersionId,
    );
    if (
      payment.id !== candidate.providerPaymentId ||
      payment.order_id !== a.providerOrderId ||
      payment.customer_id !== a.autoPayCustomerId ||
      payment.method !== 'upi' ||
      payment.currency !== a.currency ||
      BigInt(payment.amount) !== a.amountPaise ||
      !payment.captured ||
      !['captured', 'refunded'].includes(payment.status)
    )
      throw new ConflictException('AutoPay authorization payment mismatch.');
    if (bound?.providerTokenId && bound.providerTokenId === payment.token_id) {
      // Duplicate capture using the accepted token: never revoke it.
      await this.db.deploymentPaymentCapture.update({
        where: { id: candidate.id },
        data: {
          autoPayTokenId: payment.token_id,
          autoPayCleanupStatus: 'DONE',
          autoPayCleanupReason: 'AUTOPAY_SHARED_TOKEN',
        },
      });
      return;
    }
    if (
      candidate.autoPayTokenId &&
      candidate.autoPayTokenId !== payment.token_id
    )
      throw new ConflictException('AutoPay capture token changed.');
    if (!payment.token_id)
      throw new ConflictException('AutoPay token is not available yet.');
    const token = await this.gateway.fetchToken(
      a.autoPayCustomerId!,
      payment.token_id,
      a.clientId,
      a.configurationVersionId,
    );
    if (
      token.id !== payment.token_id ||
      token.method !== 'upi' ||
      (!token.recurring &&
        !['rejected', 'cancelled', 'expired'].includes(
          token.recurring_details.status,
        )) ||
      (!['rejected', 'cancelled', 'expired'].includes(
        token.recurring_details.status,
      ) &&
        token.max_amount !== a.autoPayMaxAmount!.mul(100).toNumber())
    )
      throw new ConflictException('AutoPay token terms mismatch.');
    await this.db.deploymentPaymentCapture.update({
      where: { id: candidate.id },
      data: { autoPayTokenId: token.id },
    });
    if (
      capture &&
      capture.id !== candidate.id &&
      !bound &&
      a.autoPayStatus !== 'FAILED'
    ) {
      // The primary payment may use the same token. Resolve it before revoking any duplicate authorization.
      await this.db.deploymentPaymentCapture.update({
        where: { id: candidate.id },
        data: { autoPayCleanupStatus: 'PENDING' },
      });
      return;
    }
    if (!capture || capture.id === candidate.id)
      await this.db.deploymentPaymentAttempt.updateMany({
        where: { id: a.id, autoPayMandateId: null },
        data: {
          autoPayTokenId: token.id,
          autoPayAuthorizationPaymentId: payment.id,
        },
      });
    if (payment.amount_refunded > 0 && !bound) {
      await this.cancelUnbound(
        a,
        candidate.id,
        token.id,
        'AUTOPAY_CAPTURE_NOT_ACCEPTED',
        !capture || capture.id === candidate.id,
      );
      return;
    }
    if (
      bound ||
      capture?.id !== candidate.id ||
      candidate.autoPayCleanupReason ||
      a.autoPayFailureCode === 'AUTOPAY_MANDATE_EXISTS' ||
      a.autoPayFailureCode === 'AUTOPAY_CAPTURE_NOT_ACCEPTED' ||
      a.autoPayFailureCode === 'AUTOPAY_SUPERSEDED'
    ) {
      await this.cancelUnbound(
        a,
        candidate.id,
        token.id,
        candidate.autoPayCleanupReason ??
          (bound || capture?.id !== candidate.id
            ? 'AUTOPAY_CAPTURE_NOT_ACCEPTED'
            : (a.autoPayFailureCode ?? 'AUTOPAY_CAPTURE_NOT_ACCEPTED')),
        !capture || capture.id === candidate.id,
      );
      return;
    }
    // Allocation is authoritative for the payer; workflow carries its allocation relation.
    const allocation = await this.db.allocation.findFirstOrThrow({
      where: { id: a.payment.workflow.allocationId, clientId: a.clientId },
      select: { riderId: true, status: true },
    });
    const consentingRider = (a.autoPayConsent as { riderId?: string } | null)
      ?.riderId;
    if (
      consentingRider !== allocation.riderId ||
      ['CANCELLED', 'COMPLETED'].includes(allocation.status)
    ) {
      await this.cancelUnbound(
        a,
        candidate.id,
        token.id,
        'AUTOPAY_CAPTURE_NOT_ACCEPTED',
      );
      return;
    }
    let mandateId: string;
    try {
      mandateId = await this.db.$transaction(async (tx) => {
        // Same lock order as deployment settlement: allocation, then rider.
        await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${a.payment.workflow.allocationId} AND "clientId" = ${a.clientId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${allocation.riderId} AND "clientId" = ${a.clientId} FOR UPDATE`;
        const current = await tx.deploymentPaymentAttempt.findUniqueOrThrow({
          where: { id: a.id },
        });
        if (current.autoPayMandateId) return current.autoPayMandateId;
        const accepted = await tx.deploymentPaymentCapture.findFirst({
          where: {
            attemptId: a.id,
            providerPaymentId: payment.id,
            status: 'SETTLED',
          },
        });
        const payable = await tx.allocation.findFirst({
          where: {
            id: a.payment.workflow.allocationId,
            clientId: a.clientId,
            riderId: allocation.riderId,
            status: { notIn: ['CANCELLED', 'COMPLETED'] },
          },
        });
        if (!accepted || !payable)
          throw new ConflictException({ code: 'AUTOPAY_CAPTURE_NOT_ACCEPTED' });
        await this.mandates.assertNoOpenMandate(
          tx,
          a.clientId,
          allocation.riderId,
        );
        if ((a.autoPayConsent as { scope?: string } | null)?.scope === 'WALLET_FUNDING') {
          await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE "clientId"=${a.clientId} AND "riderId"=${allocation.riderId} FOR UPDATE`;
          if (await tx.paymentTransaction.findFirst({ where: { clientId: a.clientId, riderId: allocation.riderId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } } })) throw new ConflictException('AUTOPAY_MIGRATION_BLOCKED');
          await tx.riderPaymentProfile.upsert({ where: { clientId_riderId: { clientId: a.clientId, riderId: allocation.riderId } },
            create: { clientId: a.clientId, riderId: allocation.riderId, collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true },
            update: { collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true } });
        }
        const mandate = await tx.paymentMandate.create({
          data: {
            clientId: a.clientId,
            riderId: allocation.riderId,
            requestKey: `deployment:${a.id}`,
            provider: 'RAZORPAY',
            method: 'UPI_AUTOPAY',
            mode: 'ON_DEMAND',
            providerMandateId: `EVSEYE_${randomUUID()}`,
            mandateNumber: `EVM-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 12).toUpperCase()}`,
            status: 'AUTHORIZATION_PENDING',
            providerKeyId: a.providerKeyReference,
            configurationVersionId: a.configurationVersionId,
            providerEnvironment: a.providerEnvironment,
            providerCustomerId: a.autoPayCustomerId,
            providerCustomerEmail: a.autoPayEmail,
            providerTokenId: token.id,
            providerAuthorizationOrderId: a.providerOrderId,
            providerAuthorizationPaymentId: payment.id,
            providerFrequency: 'as_presented',
            providerTermsSnapshot: {
              flow: 'DEPLOYMENT_CHECKOUT',
              deploymentAttemptId: a.id,
              consent: a.autoPayConsent,
            },
            maxAmount: a.autoPayMaxAmount!,
            authorizationAmount: new Prisma.Decimal(
              a.amountPaise.toString(),
            ).div(100),
            currency: a.currency,
            expiresAt: new Date(
              Math.min(
                a.autoPayExpiresAt!.getTime(),
                token.expired_at ? token.expired_at * 1000 : Infinity,
              ),
            ),
            events: {
              create: {
                clientId: a.clientId,
                toStatus: 'AUTHORIZATION_PENDING',
                source: 'DEPLOYMENT_CHECKOUT',
              },
            },
          },
        });
        await tx.deploymentPaymentAttempt.update({
          where: { id: a.id },
          data: {
            autoPayMandateId: mandate.id,
            autoPayStatus: 'AUTHORIZATION_PENDING',
            autoPayFailureCode: null,
          },
        });
        return mandate.id;
      });
    } catch (error) {
      const code =
        error instanceof ConflictException
          ? (error.getResponse() as { code?: string }).code
          : undefined;
      if (
        code === 'AUTOPAY_MANDATE_EXISTS' ||
        code === 'AUTOPAY_CAPTURE_NOT_ACCEPTED'
      ) {
        await this.cancelUnbound(a, candidate.id, token.id, code);
        return;
      }
      throw error;
    }
    await this.mandates.reconcileStored(mandateId);
  }

  private async cancelUnbound(
    a: DeploymentPaymentAttempt,
    captureId: string,
    tokenId: string,
    reason: string,
    affectsSetup = true,
  ) {
    await this.db.deploymentPaymentCapture.update({
      where: { id: captureId },
      data: {
        autoPayTokenId: tokenId,
        autoPayCleanupReason: reason,
        autoPayCleanupStatus: 'PENDING',
      },
    });
    if (affectsSetup)
      await this.db.deploymentPaymentAttempt.updateMany({
        where: { id: a.id, autoPayMandateId: null },
        data: { autoPayStatus: 'UNKNOWN', autoPayFailureCode: reason },
      });
    const owned = await this.db.paymentMandate.findFirst({
      where: {
        clientId: a.clientId,
        provider: 'RAZORPAY',
        providerTokenId: tokenId,
      },
    });
    if (owned)
      throw new ConflictException(
        'Token is already managed by another mandate; manual review required.',
      );
    const token = await this.gateway.fetchToken(
      a.autoPayCustomerId!,
      tokenId,
      a.clientId,
      a.configurationVersionId,
    );
    if (
      !['cancelled', 'rejected', 'expired'].includes(
        token.recurring_details.status,
      )
    ) {
      await this.gateway.cancelToken(
        a.autoPayCustomerId!,
        tokenId,
        a.clientId,
        a.configurationVersionId,
      );
      const confirmed = await this.gateway.fetchToken(
        a.autoPayCustomerId!,
        tokenId,
        a.clientId,
        a.configurationVersionId,
      );
      if (
        !['cancelled', 'rejected', 'expired'].includes(
          confirmed.recurring_details.status,
        )
      )
        return;
    }
    await this.db.deploymentPaymentCapture.update({
      where: { id: captureId },
      data: { autoPayCleanupStatus: 'DONE' },
    });
    if (affectsSetup)
      await this.db.deploymentPaymentAttempt.updateMany({
        where: { id: a.id, autoPayMandateId: null },
        data: { autoPayStatus: 'FAILED', autoPayFailureCode: reason },
      });
  }
}
