import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type WalletAutoRecharge } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService, money } from '../wallet/wallet.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { RazorpayRecurringClient } from './razorpay/razorpay-recurring.client.js';
import { RazorpayAutoPayProvider } from './razorpay/razorpay-autopay.provider.js';
import { RazorpayProviderError } from './razorpay/razorpay.client.js';
import { RazorpayEventRouter } from './razorpay/razorpay-event-router.service.js';
import { PaymentAutomationService } from './payment-automation.service.js';

type Tx = Prisma.TransactionClient;
const HOUR = 3600000;
export const OPEN_RECHARGE_STATUSES = [
  'CREATING',
  'PENDING',
  'UNKNOWN',
  'REVIEW_REQUIRED',
];
export const RECHARGE_DEFAULTS = {
  enabled: false,
  threshold: '550.00',
  rechargeAmount: '750.00',
  revision: 0,
};
export function rechargeNeeded(balance: string, threshold: string) {
  return new Prisma.Decimal(balance).lt(threshold);
}

@Injectable()
export class WalletAutoRechargeService implements OnModuleInit {
  private readonly logger = new Logger(WalletAutoRechargeService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly wallet: WalletService,
    private readonly gateway: RazorpayRecurringClient,
    private readonly mandates: RazorpayAutoPayProvider,
    private readonly config: ConfigService,
    private readonly automation: PaymentAutomationService,
    private readonly notifications: NotificationService,
    private readonly events: RazorpayEventRouter,
  ) {}

  onModuleInit() {
    this.wallet.onCommittedBalanceChange((walletId) => this.evaluate(walletId));
    this.events.register(async (event) => {
      if (
        !event.clientId ||
        ![
          'payment.captured',
          'payment.authorized',
          'payment.failed',
          'order.paid',
        ].includes(event.eventType)
      )
        return false;
      const payload = event.deploymentPayload as { orderId?: string } | null;
      if (!payload?.orderId) return false;
      const item = await this.db.walletAutoRecharge.findFirst({
        where: { clientId: event.clientId, providerOrderId: payload.orderId },
      });
      if (!item) return false; // Lost order responses are recovered by receipt in the periodic worker.
      await this.reconcile(item.id);
      return true;
    });
  }
  private enabled() {
    return (
      this.config.get('RAZORPAY_AUTOPAY_ENABLED') === 'true' &&
      this.gateway.enabled
    );
  }
  async list(clientId: string, page = 1) {
    const rows = await this.db.walletAutoRecharge.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 50,
      take: 51,
    });
    return {
      items: rows
        .slice(0, 50)
        .map((item) => ({ ...this.view(item), riderId: item.riderId })),
      page,
      hasMore: rows.length > 50,
    };
  }
  async verifyForClient(clientId: string, id: string) {
    const item = await this.db.walletAutoRecharge.findFirst({
      where: { id, clientId },
    });
    if (!item) throw new NotFoundException('Wallet recharge not found.');
    await this.reconcile(item.id);
    return this.view(
      await this.db.walletAutoRecharge.findUniqueOrThrow({ where: { id } }),
    );
  }
  async policy(clientId: string) {
    const row = await this.db.walletAutoRechargePolicy.findUnique({
      where: { clientId },
    });
    return row
      ? {
          enabled: row.enabled,
          threshold: row.threshold.toFixed(2),
          rechargeAmount: row.rechargeAmount.toFixed(2),
          revision: row.revision,
        }
      : RECHARGE_DEFAULTS;
  }
  async setPolicy(
    clientId: string,
    actorId: string,
    input: {
      enabled: boolean;
      threshold: string;
      rechargeAmount: string;
      revision: number;
    },
  ) {
    const threshold = money(input.threshold),
      amount = money(input.rechargeAmount);
    if (threshold.gt(5000) || amount.lt(500) || amount.gt(5000))
      throw new BadRequestException(
        'Use a threshold from INR 0.01 to 5000 and a recharge amount from INR 500 to 5000.',
      );
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
      const previous = await tx.walletAutoRechargePolicy.findUnique({
        where: { clientId },
      });
      if ((previous?.revision ?? 0) !== input.revision)
        throw new ConflictException('Policy changed. Reload before saving.');
      // Money changes require new rider consent. Disabling/re-enabling alone preserves agreed terms.
      const revision = previous
        ? previous.revision +
          (previous.threshold.eq(threshold) &&
          previous.rechargeAmount.eq(amount)
            ? 0
            : 1)
        : 1;
      const row = await tx.walletAutoRechargePolicy.upsert({
        where: { clientId },
        create: {
          clientId,
          enabled: input.enabled,
          threshold,
          rechargeAmount: amount,
          revision,
        },
        update: {
          enabled: input.enabled,
          threshold,
          rechargeAmount: amount,
          revision,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'WALLET_AUTOPAY_POLICY_UPDATED',
          entityType: 'WalletAutoRechargePolicy',
          entityId: clientId,
          newData: { ...input, revision },
        },
      });
      return {
        enabled: row.enabled,
        threshold: row.threshold.toFixed(2),
        rechargeAmount: row.rechargeAmount.toFixed(2),
        revision,
      };
    });
  }
  private async rider(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
    });
    if (!rider) throw new NotFoundException('Rider not found.');
    return rider;
  }
  async current(clientId: string, userId: string) {
    const rider = await this.rider(clientId, userId);
    const [policy, preference, requests] = await Promise.all([
      this.policy(clientId),
      this.db.walletAutoRechargePreference.findUnique({
        where: { clientId_riderId: { clientId, riderId: rider.id } },
      }),
      this.db.walletAutoRecharge.findMany({
        where: { clientId, riderId: rider.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    return {
      policy,
      balanceBasis: 'AVAILABLE_CASH',
      minimumLeadHours: 25,
      cooldownHours: 24,
      enabled: preference?.enabled ?? false,
      actionRequired: preference?.actionRequired ?? false,
      consentRequired:
        !!preference && preference.consentRevision !== policy.revision,
      mandateId: preference?.mandateId ?? null,
      requests: requests.map((item) => this.view(item)),
    };
  }
  view(item: WalletAutoRecharge) {
    return {
      id: item.id,
      status: item.status,
      amount: item.amount.toFixed(2),
      currency: item.currency,
      balanceAtTrigger: item.balanceAtTrigger.toFixed(2),
      scheduledAt: item.scheduledAt,
      completedAt: item.completedAt,
      failureCode: item.failureCode,
      createdAt: item.createdAt,
    };
  }
  async setEnabled(
    clientId: string,
    userId: string,
    input: { enabled: boolean; mandateId?: string; consentRevision?: number },
  ) {
    const rider = await this.rider(clientId, userId);
    const wallet = await this.wallet.ensure(clientId, rider.id, userId);
    if (input.enabled) {
      if (!this.enabled())
        throw new ConflictException('Razorpay AutoPay is unavailable.');
      const mandate = await this.db.paymentMandate.findFirst({
        where: {
          id: input.mandateId ?? '',
          clientId,
          riderId: rider.id,
          provider: 'RAZORPAY',
        },
      });
      if (
        !mandate ||
        (await this.mandates.fetchMandate(mandate.providerMandateId)).status !==
          'ACTIVE'
      )
        throw new ConflictException(
          'Verify an active Razorpay UPI mandate first.',
        );
    }
    await this.wallet.locked(wallet.id, async (tx) => {
      if (input.enabled) {
        const policy = await tx.walletAutoRechargePolicy.findUnique({
          where: { clientId },
        });
        if (!policy?.enabled || policy.revision !== input.consentRevision)
          throw new ConflictException(
            'Review and accept the current wallet AutoPay terms.',
          );
        const mandate = await tx.paymentMandate.findFirst({
          where: {
            id: input.mandateId,
            clientId,
            riderId: rider.id,
            provider: 'RAZORPAY',
            status: 'ACTIVE',
            autoDebitEnabled: true,
            providerCancelRequestedAt: null,
            currency: 'INR',
            maxAmount: { gte: policy.rechargeAmount },
            expiresAt: { gt: new Date(Date.now() + 25 * HOUR + 5 * 60000) },
          },
        });
        if (!mandate)
          throw new ConflictException(
            'The mandate cannot cover this wallet recharge.',
          );
        if (
          await tx.paymentTransaction.findFirst({
            where: {
              clientId,
              riderId: rider.id,
              status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
            },
          })
        )
          throw new ConflictException(
            'Resolve the pending invoice AutoPay debit before enabling wallet AutoPay.',
          );
        await tx.walletAutoRechargePreference.upsert({
          where: { walletId: wallet.id },
          create: {
            clientId,
            riderId: rider.id,
            walletId: wallet.id,
            mandateId: mandate.id,
            enabled: true,
            consentRevision: policy.revision,
          },
          update: {
            enabled: true,
            mandateId: mandate.id,
            consentRevision: policy.revision,
            consentedAt: new Date(),
            actionRequired: false,
          },
        });
      } else {
        await tx.walletAutoRechargePreference.updateMany({
          where: { walletId: wallet.id, clientId },
          data: { enabled: false },
        });
      }
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: userId,
          action: input.enabled
            ? 'WALLET_AUTOPAY_ENABLED'
            : 'WALLET_AUTOPAY_DISABLED',
          entityType: 'RiderWallet',
          entityId: wallet.id,
          newData: {
            enabled: input.enabled,
            consentRevision: input.consentRevision ?? null,
          },
        },
      });
    });
    return this.current(clientId, userId);
  }
  private async eligible(
    tx: Tx,
    walletId: string,
    amount?: Prisma.Decimal,
    revision?: number,
  ) {
    const preference = await tx.walletAutoRechargePreference.findUnique({
      where: { walletId },
    });
    if (!preference?.enabled || preference.actionRequired) return null;
    const { clientId, riderId } = preference;
    const policy = await tx.walletAutoRechargePolicy.findUnique({
      where: { clientId },
    });
    if (
      !policy?.enabled ||
      preference.consentRevision !== policy.revision ||
      (revision !== undefined && revision !== policy.revision)
    )
      return null;
    const wallet = await tx.riderWallet.findFirst({
      where: {
        id: walletId,
        clientId,
        riderId,
        status: 'ACTIVE',
        currency: 'INR',
        rider: { deletedAt: null, status: 'ACTIVE' },
        client: { isActive: true, status: 'ACTIVE' },
      },
    });
    if (!wallet) return null;
    const allocation = await tx.allocation.findFirst({
      where: {
        clientId,
        riderId,
        status: 'ACTIVE',
        allocatedAt: { not: null },
      },
      orderBy: { allocatedAt: 'desc' },
    });
    if (!allocation) return null;
    const mandate = await tx.paymentMandate.findFirst({
      where: {
        id: preference.mandateId,
        clientId,
        riderId,
        provider: 'RAZORPAY',
        status: 'ACTIVE',
        autoDebitEnabled: true,
        providerCancelRequestedAt: null,
        currency: 'INR',
        expiresAt: { gt: new Date(Date.now() + 25 * HOUR) },
        maxAmount: { gte: amount ?? policy.rechargeAmount },
      },
    });
    if (!mandate) return null;
    const profile = await tx.riderPaymentProfile.findUnique({
      where: { clientId_riderId: { clientId, riderId } },
    });
    if (!profile?.autoPayEnabled) return null;
    const balance = await this.wallet.balanceTx(tx, clientId, walletId);
    if (
      !rechargeNeeded(
        balance.cash.availableBalance,
        policy.threshold.toFixed(2),
      )
    )
      return null;
    return {
      preference,
      policy,
      mandate,
      allocation,
      balance: balance.cash.availableBalance,
    };
  }
  async evaluate(walletId: string) {
    if (!this.enabled()) return;
    // Use the DB directly to avoid invoking the wallet's post-commit callback recursively.
    const reserved = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${walletId} FOR UPDATE`;
        await tx.walletAutoRechargePreference.updateMany({
          where: { walletId },
          data: { checkedAt: new Date() },
        });
        if (
          await tx.walletAutoRecharge.findFirst({
            where: { walletId, status: { in: OPEN_RECHARGE_STATUSES } },
          })
        )
          return null;
        const e = await this.eligible(tx, walletId);
        if (!e || e.preference.nextEligibleAt > new Date()) return null;
        if (
          await tx.paymentTransaction.findFirst({
            where: {
              clientId: e.preference.clientId,
              riderId: e.preference.riderId,
              status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
            },
          })
        )
          return null;
        const created = await tx.walletAutoRecharge.create({
          data: {
            clientId: e.preference.clientId,
            riderId: e.preference.riderId,
            walletId,
            mandateId: e.mandate.id,
            allocationId: e.allocation.id,
            policyRevision: e.policy.revision,
            threshold: e.policy.threshold,
            balanceAtTrigger: e.balance,
            amount: e.policy.rechargeAmount,
            configurationVersionId: e.mandate.configurationVersionId,
            providerKeyId: e.mandate.providerKeyId,
            scheduledAt: new Date(Date.now() + 25 * HOUR + 5 * 60000),
          },
        });
        await tx.auditLog.create({
          data: {
            clientId: created.clientId,
            actorId: null,
            action: 'WALLET_AUTOPAY_REQUESTED',
            entityType: 'WalletAutoRecharge',
            entityId: created.id,
            newData: {
              amount: created.amount.toFixed(2),
              threshold: created.threshold.toFixed(2),
              balance: created.balanceAtTrigger.toFixed(2),
              policyRevision: created.policyRevision,
            },
          },
        });
        return created;
      },
      { timeout: 15000 },
    );
    if (reserved) await this.reconcile(reserved.id);
  }
  async reconcile(id: string) {
    // Cross-process lease; provider claims below additionally make expired-lease recovery safe.
    await this.automation.run(
      `wallet-recharge:${id}`,
      async () => {
        try {
          await this.process(id);
        } catch {
          this.logger.warn(`Wallet recharge recovery pending: ${id}`);
          await this.db.walletAutoRecharge.updateMany({
            where: { id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
            data: {
              status: 'UNKNOWN',
              failureCode: 'PROVIDER_CONFIRMATION_PENDING',
            },
          });
        }
        const item = await this.db.walletAutoRecharge.findUniqueOrThrow({
          where: { id },
        });
        if (
          item.status === 'FAILED' ||
          item.status === 'REVIEW_REQUIRED' ||
          [
            'EXTERNAL_REFUND',
            'MULTIPLE_CAPTURES',
            'PAYMENT_IDENTITY_MISMATCH',
          ].includes(item.failureCode ?? '') ||
          (OPEN_RECHARGE_STATUSES.includes(item.status) &&
            Date.now() - item.createdAt.getTime() >= 36 * HOUR)
        )
          await this.alert(item);
        return true;
      },
      30,
    );
  }
  private async process(id: string) {
    let item = await this.db.walletAutoRecharge.update({
      where: { id },
      data: { checkedAt: new Date() },
    });
    if (['CANCELLED', 'FAILED'].includes(item.status) && !item.debitClaimedAt)
      return;
    const mandate = await this.db.paymentMandate.findFirstOrThrow({
      where: {
        id: item.mandateId,
        clientId: item.clientId,
        riderId: item.riderId,
      },
    });
    if (
      mandate.configurationVersionId !== item.configurationVersionId ||
      mandate.providerKeyId !== item.providerKeyId
    )
      throw new ConflictException(
        'Recharge merchant differs from the saved mandate.',
      );
    await this.gateway.assertConfigured(
      item.clientId,
      item.providerKeyId ?? undefined,
      item.configurationVersionId,
    );
    if (!item.providerOrderId) {
      if (!item.orderClaimedAt) {
        if (!this.enabled()) return;
        const remote = await this.mandates.fetchMandate(
          mandate.providerMandateId,
        );
        if (remote.status !== 'ACTIVE')
          return this.cancel(item, 'MANDATE_NOT_ACTIVE');
        const claimed = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${item.walletId} FOR UPDATE`;
          const e = await this.eligible(
            tx,
            item.walletId,
            item.amount,
            item.policyRevision,
          );
          if (
            !e ||
            e.mandate.id !== item.mandateId ||
            e.allocation.id !== item.allocationId
          )
            return false;
          const result = await tx.walletAutoRecharge.updateMany({
            where: {
              id,
              orderClaimedAt: null,
              status: { in: ['CREATING', 'UNKNOWN'] },
            },
            data: {
              orderClaimedAt: new Date(),
              scheduledAt: new Date(Date.now() + 25 * HOUR + 5 * 60000),
            },
          });
          return result.count > 0;
        });
        if (!claimed) return this.cancel(item, 'ELIGIBILITY_CHANGED');
        item = await this.db.walletAutoRecharge.findUniqueOrThrow({
          where: { id },
        });
        try {
          const order = await this.gateway.createDebitOrder(
            item.amount.mul(100).toNumber(),
            item.id,
            mandate.providerTokenId!,
            item.scheduledAt,
            item.clientId,
            item.configurationVersionId,
          );
          item = await this.bindOrder(item, order);
        } catch (error) {
          if (error instanceof RazorpayProviderError && error.definitive)
            return this.fail(item, 'ORDER_REJECTED');
          throw error;
        }
      } else {
        const orders = await this.gateway.findOrders(
          item.id,
          item.clientId,
          item.configurationVersionId,
        );
        if (orders.length !== 1)
          throw new ConflictException(
            'Order creation uncertain; do not repeat.',
          );
        item = await this.bindOrder(item, orders[0]);
      }
    }
    const payments = await this.gateway.recurringOrderPayments(
      item.providerOrderId!,
      item.clientId,
      item.configurationVersionId,
    );
    if (
      item.providerPaymentId &&
      !payments.some((p) => p.id === item.providerPaymentId)
    )
      payments.push(
        await this.gateway.recurringPayment(
          item.providerPaymentId,
          item.clientId,
          item.configurationVersionId,
        ),
      );
    for (const p of payments) {
      if (
        p.order_id !== item.providerOrderId ||
        p.amount !== item.amount.mul(100).toNumber() ||
        p.currency !== item.currency ||
        (p.customer_id != null &&
          p.customer_id !== mandate.providerCustomerId) ||
        (p.token_id != null && p.token_id !== mandate.providerTokenId) ||
        (p.method != null && p.method !== 'upi') ||
        (p.captured &&
          (p.customer_id !== mandate.providerCustomerId ||
            p.token_id !== mandate.providerTokenId ||
            p.method !== 'upi'))
      )
        return this.review(item, 'PAYMENT_IDENTITY_MISMATCH');
    }
    const captured = payments.filter(
      (p) => p.captured && ['captured', 'refunded'].includes(p.status),
    );
    if (captured.length > 1 || captured.some((p) => p.amount_refunded > 0))
      return this.review(
        item,
        captured.length > 1 ? 'MULTIPLE_CAPTURES' : 'EXTERNAL_REFUND',
      );
    if (captured.length === 1) return this.settle(item, captured[0].id);
    if (item.status === 'SUCCESS' || item.status === 'REVIEW_REQUIRED') return;
    if (payments.some((p) => ['created', 'authorized'].includes(p.status))) {
      await this.db.walletAutoRecharge.update({
        where: { id },
        data: { status: 'PENDING' },
      });
      return;
    }
    if (payments.length) return this.fail(item, 'PAYMENT_FAILED');
    if (item.debitClaimedAt)
      throw new ConflictException('Debit outcome uncertain; do not repeat.');
    if (['CANCELLED', 'FAILED'].includes(item.status) || !this.enabled())
      return;
    if (
      (await this.mandates.fetchMandate(mandate.providerMandateId)).status !==
      'ACTIVE'
    )
      return this.cancel(item, 'MANDATE_NOT_ACTIVE');
    const rider = await this.db.rider.findFirstOrThrow({
      where: { id: item.riderId, clientId: item.clientId },
    });
    if (
      !mandate.providerCustomerId ||
      !mandate.providerTokenId ||
      !mandate.providerCustomerEmail
    )
      return this.cancel(item, 'MANDATE_DETAILS_MISSING');
    // Recheck local consent, scooter possession and balance after order/PDN creation, before debit submission.
    const claimed = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${item.walletId} FOR UPDATE`;
      const e = await this.eligible(
        tx,
        item.walletId,
        item.amount,
        item.policyRevision,
      );
      if (
        !e ||
        e.mandate.id !== item.mandateId ||
        e.allocation.id !== item.allocationId ||
        item.scheduledAt.getTime() < Date.now() + 25 * HOUR
      )
        return false;
      return (
        (
          await tx.walletAutoRecharge.updateMany({
            where: {
              id,
              debitClaimedAt: null,
              status: { in: ['CREATING', 'UNKNOWN'] },
            },
            data: { debitClaimedAt: new Date(), status: 'PENDING' },
          })
        ).count > 0
      );
    });
    if (!claimed) return this.cancel(item, 'ELIGIBILITY_OR_SCHEDULE_CHANGED');
    try {
      const result = await this.gateway.createRecurringPayment({
        customerId: mandate.providerCustomerId,
        tokenId: mandate.providerTokenId,
        orderId: item.providerOrderId!,
        amount: item.amount.mul(100).toNumber(),
        email: mandate.providerCustomerEmail,
        contact: rider.mobile,
        clientId: item.clientId,
        configurationVersionId: item.configurationVersionId,
        description: 'EVsEye automatic wallet recharge',
      });
      await this.db.walletAutoRecharge.update({
        where: { id },
        data: {
          providerPaymentId: result.razorpay_payment_id,
          status: 'PENDING',
          failureCode: null,
        },
      });
    } catch (error) {
      if (error instanceof RazorpayProviderError && error.definitive)
        return this.fail(item, 'DEBIT_REJECTED');
      throw error;
    }
  }
  private async bindOrder(
    item: WalletAutoRecharge,
    order: {
      id: string;
      receipt: string | null;
      amount: number;
      currency: string;
    },
  ) {
    if (
      order.receipt !== item.id ||
      order.amount !== item.amount.mul(100).toNumber() ||
      order.currency !== item.currency ||
      (item.providerOrderId && item.providerOrderId !== order.id)
    )
      throw new ConflictException('Recurring wallet order mismatch.');
    return this.db.walletAutoRecharge.update({
      where: { id: item.id },
      data: { providerOrderId: order.id },
    });
  }
  private async cancel(item: WalletAutoRecharge, reason: string) {
    await this.db.walletAutoRecharge.updateMany({
      where: {
        id: item.id,
        debitClaimedAt: null,
        status: { in: ['CREATING', 'UNKNOWN'] },
      },
      data: { status: 'CANCELLED', failureCode: reason },
    });
  }
  private async fail(item: WalletAutoRecharge, reason: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${item.walletId} FOR UPDATE`;
      const changed = await tx.walletAutoRecharge.updateMany({
        where: {
          id: item.id,
          status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
        },
        data: { status: 'FAILED', failureCode: reason },
      });
      if (changed.count)
        await tx.walletAutoRechargePreference.updateMany({
          where: { walletId: item.walletId },
          data: { actionRequired: true },
        });
    });
  }
  private async review(item: WalletAutoRecharge, reason: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${item.walletId} FOR UPDATE`;
      const other = await tx.walletAutoRecharge.findFirst({
        where: {
          walletId: item.walletId,
          id: { not: item.id },
          status: { in: OPEN_RECHARGE_STATUSES },
        },
      });
      await tx.walletAutoRecharge.update({
        where: { id: item.id },
        data: {
          ...(other ? {} : { status: 'REVIEW_REQUIRED' }),
          failureCode: reason,
        },
      });
      if (other)
        await tx.walletAutoRecharge.update({
          where: { id: other.id },
          data: {
            status: 'REVIEW_REQUIRED',
            failureCode: 'RELATED_RECHARGE_REQUIRES_REVIEW',
          },
        });
      await tx.walletAutoRechargePreference.updateMany({
        where: { walletId: item.walletId },
        data: { actionRequired: true },
      });
      await tx.paymentOperationalAlert.upsert({
        where: {
          clientId_kind_referenceId: {
            clientId: item.clientId,
            kind: 'WALLET_AUTOPAY_REVIEW',
            referenceId: item.id,
          },
        },
        create: {
          clientId: item.clientId,
          kind: 'WALLET_AUTOPAY_REVIEW',
          referenceId: item.id,
        },
        update: {},
      });
    });
  }
  private async settle(item: WalletAutoRecharge, paymentId: string) {
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${item.walletId} FOR UPDATE`;
        const current = await tx.walletAutoRecharge.findUniqueOrThrow({
          where: { id: item.id },
        });
        if (current.completedAt) return; // Captures observed after disable/return still belong to the rider.
        if (current.status === 'REVIEW_REQUIRED') return;
        const accounts = await tx.walletAccount.findMany({
          where: { clientId: item.clientId, walletId: item.walletId },
        });
        const cash = accounts.find((a) => a.accountType === 'CASH'),
          clearing = accounts.find(
            (a) => a.accountType === 'PROVIDER_CLEARING',
          );
        if (!cash || !clearing)
          throw new ConflictException('Wallet accounts missing.');
        const amount = item.amount.toFixed(2);
        await this.wallet.postInTransaction(tx, {
          clientId: item.clientId,
          walletId: item.walletId,
          actorId: 'SYSTEM',
          type: 'TOP_UP',
          amount,
          currency: item.currency,
          description: 'Automatic wallet recharge',
          idempotencyKey: `autotopup:${item.id}`,
          referenceType: 'WALLET_AUTO_RECHARGE',
          referenceId: item.id,
          entries: [
            { accountId: clearing.id, entryType: 'DEBIT', amount },
            { accountId: cash.id, entryType: 'CREDIT', amount },
          ],
        });
        await tx.walletAutoRecharge.update({
          where: { id: item.id },
          data: {
            status: 'SUCCESS',
            providerPaymentId: paymentId,
            completedAt: new Date(),
            failureCode: null,
          },
        });
        await tx.walletAutoRechargePreference.updateMany({
          where: { walletId: item.walletId },
          data: { nextEligibleAt: new Date(Date.now() + 24 * HOUR) },
        });
      },
      { timeout: 15000 },
    );
  }
  private async alert(item: WalletAutoRecharge) {
    if (item.notifiedAt) return;
    const rider = await this.db.rider.findFirst({
      where: {
        clientId: item.clientId,
        id: item.riderId,
        user: { isActive: true, deletedAt: null },
      },
    });
    if (!rider?.userId) return;
    await this.notifications.sendToUsers(
      item.clientId,
      [rider.userId],
      {
        title: 'Wallet AutoPay needs attention',
        body: 'Your automatic wallet recharge has failed or is still unconfirmed. Check your wallet and bank payment status. Manual recharge is available; a pending automatic debit may still complete.',
        data: { screen: 'wallet', rechargeId: item.id },
      },
      `wallet-autopay:attention:${item.id}`,
      'WALLET_AUTOPAY',
    );
    await this.db.walletAutoRecharge.update({
      where: { id: item.id },
      data: { notifiedAt: new Date() },
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    await this.automation.run(
      'worker:wallet-autopay',
      async () => {
        // Reserve separate budgets for pending and historical requests.
        const [pending, historical] = await Promise.all([
          this.db.walletAutoRecharge.findMany({
            where: { status: { in: OPEN_RECHARGE_STATUSES } },
            orderBy: { checkedAt: 'asc' },
            take: 50,
          }),
          this.db.walletAutoRecharge.findMany({
            where: {
              status: { notIn: OPEN_RECHARGE_STATUSES },
              OR: [
                { debitClaimedAt: { not: null } },
                { status: 'FAILED', notifiedAt: null },
              ],
            },
            orderBy: { checkedAt: 'asc' },
            take: 10,
          }),
        ]);
        const requests = [...pending, ...historical];
        for (const item of requests) {
          try {
            await this.reconcile(item.id);
          } catch {
            this.logger.warn(
              `Wallet recharge reconciliation failed: ${item.id}`,
            );
          }
        }
        if (this.enabled()) {
          const preferences =
            await this.db.walletAutoRechargePreference.findMany({
              where: { enabled: true },
              orderBy: { checkedAt: 'asc' },
              take: 100,
            });
          for (const pref of preferences) {
            try {
              await this.evaluate(pref.walletId);
            } catch {
              this.logger.warn(
                `Wallet recharge eligibility failed: ${pref.walletId}`,
              );
            }
          }
        }
        return true;
      },
      30,
    );
  }
}
