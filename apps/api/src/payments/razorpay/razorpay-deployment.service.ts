import { PaymentAutomationService } from '../payment-automation.service.js';
import { resolveWebhookMerchant } from './razorpay-webhook-merchant.js';
import { Optional } from '@nestjs/common';
import { PaymentGatewayPolicyService } from '../payment-gateway-policy.service.js';
import { RazorpayEventRouter } from './razorpay-event-router.service.js';
import { RazorpayPenaltyService } from './razorpay-penalty.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type DeploymentPaymentAttempt } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeploymentCommercialService } from '../../allocations/deployment-commercial.service.js';
import { allocationPaymentView } from '../../allocations/allocation-payment-view.js';
import {
  RazorpayClient,
  razorpayPaymentMethod,
  RazorpayProviderError,
  type RazorpayPayment,
} from './razorpay.client.js';

type Tx = Prisma.TransactionClient;
export function toPaise(amount: Prisma.Decimal) {
  const paise = amount.mul(100);
  if (!paise.isInteger() || paise.lt(100) || paise.gt(Number.MAX_SAFE_INTEGER))
    throw new BadRequestException(
      'Online payment amount must be at least INR 1 and fit the supported precision.',
    );
  return paise.toNumber();
}
const callback = z
  .object({
    razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
    razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
    razorpaySignature: z.string().regex(/^[a-fA-F0-9]{64}$/),
  })
  .strict();
const hook = z.object({
  event: z.string().max(100),
  payload: z
    .object({
      order: z.object({ entity: z.object({ id: z.string() }) }).optional(),
      token: z.object({ entity: z.object({ id: z.string() }) }).optional(),
      payment: z
        .object({
          entity: z.object({
            id: z.string(),
            order_id: z.string().nullable().optional(),
          }),
        })
        .optional(),
      refund: z
        .object({
          entity: z.object({
            id: z.string(),
            payment_id: z.string().nullable().optional(),
          }),
        })
        .optional(),
    })
    .passthrough(),
});

@Injectable()
export class RazorpayDeploymentService {
  private readonly logger = new Logger(RazorpayDeploymentService.name);
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: RazorpayClient,
    private readonly commercial: DeploymentCommercialService,
    private readonly penalties?: RazorpayPenaltyService,
    private readonly eventRouter?: RazorpayEventRouter,
    @Optional() private readonly policy?: PaymentGatewayPolicyService,
    @Optional() private readonly automation?: PaymentAutomationService,
  ) {}

  private async allocation(
    tx: Tx,
    clientId: string,
    allocationId: string,
    userId?: string,
  ) {
    const a = await tx.allocation.findFirst({
      where: {
        id: allocationId,
        clientId,
        ...(userId ? { rider: { clientId, userId, deletedAt: null } } : {}),
      },
      include: {
        rider: { select: { userId: true } },
        mobileDeployment: { include: { payment: true } },
      },
    });
    if (!a?.mobileDeployment?.payment)
      throw new NotFoundException('Allocation payment not found.');
    return a;
  }
  private async lock(tx: Tx, clientId: string, allocationId: string) {
    await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
  }
  async createOrder(clientId: string, userId: string, allocationId: string) {
    await this.policy?.resolve(clientId, 'DEPLOYMENT', 'RAZORPAY');
    await this.gateway.assertConfigured(clientId);
    const merchant = await this.gateway.configurationFor(clientId);
    const { keyId, configurationVersionId } = merchant;
    const environment = merchant.environment;
    const { attempt, fresh } = await this.db.$transaction(async (tx) => {
      await this.lock(tx, clientId, allocationId);
      const a = await this.allocation(tx, clientId, allocationId, userId);
      const p = a.mobileDeployment!.payment!;
      if (
        !['PENDING', 'REJECTED'].includes(p.status) ||
        a.mobileDeployment!.status !== 'PAYMENT_PENDING' ||
        ['CANCELLED', 'COMPLETED'].includes(a.status)
      )
        throw new ConflictException(
          'This allocation payment is not eligible for online checkout.',
        );
      const unresolvedCapture = await tx.deploymentPaymentCapture.findFirst({
        where: {
          attempt: { deploymentPaymentId: p.id },
          status: { not: 'REFUNDED' },
        },
        select: { id: true },
      });
      if (unresolvedCapture)
        throw new ConflictException({
          code: 'RAZORPAY_PAYMENT_UNDER_REVIEW',
          message:
            'A payment was already received and is being reconciled. Do not pay again; contact support.',
        });
      await this.commercial.assertPaymentQuote(tx, clientId, a);
      if (p.currency !== 'INR')
        throw new BadRequestException(
          'Razorpay handover payments currently support INR only.',
        );
      const amount = toPaise(p.amount);
      const unresolved = await tx.deploymentPaymentAttempt.findFirst({
        where: {
          deploymentPaymentId: p.id,
          providerOrderId: null,
          status: 'CREATING',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (unresolved) return { attempt: unresolved, fresh: false };
      const existing = await tx.deploymentPaymentAttempt.findFirst({
        where: {
          deploymentPaymentId: p.id,
          amountPaise: BigInt(amount),
          currency: p.currency,
          status: 'OPEN',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { attempt: existing, fresh: false };
      await tx.deploymentPaymentAttempt.updateMany({
        where: { deploymentPaymentId: p.id, status: 'OPEN' },
        data: { status: 'SUPERSEDED' },
      });
      return {
        attempt: await tx.deploymentPaymentAttempt.create({
          data: {
            clientId,
            deploymentPaymentId: p.id,
            provider: 'RAZORPAY',
            providerKeyReference: keyId,
            configurationVersionId,
            providerEnvironment: environment,
            amountPaise: BigInt(amount),
            currency: p.currency,
          },
        }),
        fresh: true,
      };
    });
    let order = attempt;
    if (!order.providerOrderId) {
      await this.gateway.assertConfigured(clientId, order.providerKeyReference!, order.configurationVersionId);
      if (!fresh && Date.now() - order.createdAt.getTime() < 30000)
        throw new ConflictException({
          code: 'RAZORPAY_ORDER_PROCESSING',
          message: 'Your payment order is being prepared. Retry shortly.',
        });
      let remote;
      try {
        remote = fresh
          ? await this.gateway.createOrder(
              Number(order.amountPaise),
              order.currency,
              order.id,
              {
                deploymentPaymentId: order.deploymentPaymentId,
                allocationId,
                clientId,
                attemptId: order.id,
              },
              clientId, order.configurationVersionId,
            )
          : (await this.gateway.findOrders(order.id, clientId, order.configurationVersionId))[0];
      } catch (error) {
        if (fresh && error instanceof RazorpayProviderError && error.definitive)
          await this.db.deploymentPaymentAttempt.update({
            where: { id: order.id },
            data: { status: 'FAILED' },
          });
        throw error;
      }
      if (!remote)
        throw new ConflictException({
          code: 'RAZORPAY_ORDER_UNKNOWN',
          message:
            'The previous order needs reconciliation. Do not start another payment; retry shortly or contact support.',
        });
      order = await this.bindOrder(order, remote);
    }
    // Recover an app callback/webhook that may already have completed the order.
    await this.reconcileOrder(order);
    const current = await this.allocation(
      this.db,
      clientId,
      allocationId,
      userId,
    );
    if (current.mobileDeployment!.payment!.status === 'PAID')
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_PAID',
        message: 'Payment is already complete. Refresh the payment screen.',
      });
    if (
      order.amountPaise !==
      BigInt(toPaise(current.mobileDeployment!.payment!.amount))
    )
      throw new ConflictException(
        'Payment amount changed. Refresh the payment request.',
      );
    await this.gateway.assertConfigured(clientId, order.providerKeyReference!, order.configurationVersionId);
    return {
      provider: 'RAZORPAY',
      providerKeyReference: order.providerKeyReference,
      orderId: order.providerOrderId!,
      amount: Number(order.amountPaise),
      currency: order.currency,
    };
  }
  private async bindOrder(
    order: DeploymentPaymentAttempt,
    remote: {
      id: string;
      receipt: string | null;
      amount: number;
      currency: string;
    },
  ) {
    if (
      remote.receipt !== order.id ||
      BigInt(remote.amount) !== order.amountPaise ||
      remote.currency !== order.currency
    )
      throw new ConflictException(
        'Gateway order does not match the saved payment request.',
      );
    return this.db.deploymentPaymentAttempt.update({
      where: { id: order.id },
      data: { providerOrderId: remote.id, status: 'OPEN' },
    });
  }
  async verify(
    clientId: string,
    userId: string,
    allocationId: string,
    raw: unknown,
  ) {
    const parsed = callback.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        'A valid Razorpay order, payment ID and signature are required.',
      );
    const input = parsed.data;
    const a = await this.allocation(this.db, clientId, allocationId, userId);
    const order = await this.db.deploymentPaymentAttempt.findFirst({
      where: {
        deploymentPaymentId: a.mobileDeployment!.payment!.id,
        clientId,
        providerOrderId: input.razorpayOrderId,
      },
    });
    if (!order)
      throw new BadRequestException(
        'This Razorpay order does not belong to the allocation payment.',
      );
    await this.gateway.assertConfigured(clientId, order.providerKeyReference!, order.configurationVersionId);
    await this.gateway.verifyCheckout(
      order.providerOrderId!,
      input.razorpayPaymentId,
      input.razorpaySignature,
      clientId, order.configurationVersionId,
    );
    const remote = await this.gateway.fetchPayment(input.razorpayPaymentId, clientId, order.configurationVersionId);
    this.assertPayment(order, remote);
    if (['captured', 'refunded'].includes(remote.status))
      await this.settle(order, remote);
    const current = await this.allocation(
      this.db,
      clientId,
      allocationId,
      userId,
    );
    const payment = current.mobileDeployment!.payment!;
    if (
      payment.status === 'PAID' &&
      (payment.provider !== 'RAZORPAY' ||
        payment.providerReference !== remote.id)
    )
      throw new ConflictException(
        'This allocation was already paid with a different payment. The additional payment is tracked for refund.',
      );
    const capture = await this.db.deploymentPaymentCapture.findUnique({
      where: { providerPaymentId: remote.id },
    });
    const receipts = await this.db.photo.findMany({
      where: {
        clientId,
        workFlowType: 'PAYMENT',
        subjectType: 'OTHER',
        entityId: payment.id,
        status: 'COMPLETE',
      },
      select: { id: true, mimeType: true, sizeBytes: true, uploadedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...allocationPaymentView(payment, current.mobileDeployment!.status),
      receipts,
      gateway: {
        provider: 'RAZORPAY',
        orderId: order.providerOrderId,
        paymentId: remote.id,
        status: capture?.status ?? remote.status.toUpperCase(),
        reason: capture?.reason ?? null,
      },
      ...(payment.status !== 'PAID'
        ? {
            nextAction: capture
              ? 'CONTACT_SUPPORT'
              : remote.status === 'authorized'
                ? 'AWAITING_GATEWAY_CONFIRMATION'
                : 'RETRY_ONLINE_PAYMENT',
          }
        : {}),
    };
  }
  private assertPayment(
    order: DeploymentPaymentAttempt,
    payment: RazorpayPayment,
  ) {
    if (
      payment.order_id !== order.providerOrderId ||
      BigInt(payment.amount) !== order.amountPaise ||
      payment.currency !== order.currency
    )
      throw new BadRequestException(
        'Razorpay payment order, amount or currency does not match.',
      );
    if (['captured', 'refunded'].includes(payment.status) && !payment.captured)
      throw new BadRequestException(
        'Razorpay payment capture is not confirmed.',
      );
  }
  private async settle(
    order: DeploymentPaymentAttempt,
    remote: RazorpayPayment,
  ) {
    await this.gateway.assertConfigured(order.clientId, order.providerKeyReference!, order.configurationVersionId);
    this.assertPayment(order, remote);
    if (!['captured', 'refunded'].includes(remote.status) || !remote.captured)
      return;
    const workflow = await this.db.deploymentPayment.findUniqueOrThrow({
      where: { id: order.deploymentPaymentId },
      select: { workflow: { select: { allocationId: true } } },
    });
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, order.clientId, workflow.workflow.allocationId);
      const a = await this.allocation(
        tx,
        order.clientId,
        workflow.workflow.allocationId,
      );
      const w = a.mobileDeployment!,
        p = w.payment!;
      const existing = await tx.deploymentPaymentCapture.findUnique({
        where: { providerPaymentId: remote.id },
      });
      if (existing) {
        if (existing.attemptId !== order.id)
          throw new ConflictException('Gateway payment has already been used.');
        if (!existing.paymentMethod || existing.paymentMethod === 'UNKNOWN')
          await tx.deploymentPaymentCapture.update({ where: { id: existing.id },
            data: { paymentMethod: razorpayPaymentMethod(remote) } });
        if (existing.status === 'SETTLED' && remote.amount_refunded > 0)
          await tx.deploymentPaymentCapture.update({
            where: { id: existing.id },
            data: {
              status: 'REVIEW_REQUIRED',
              reason: 'EXTERNAL_REFUND_REQUIRES_REVERSAL',
            },
          });
        if (existing.status === 'SETTLED' && a.status === 'CANCELLED')
          await tx.deploymentPaymentCapture.update({
            where: { id: existing.id },
            data: {
              status: 'REVIEW_REQUIRED',
              reason: 'SETTLED_CANCELLATION_REQUIRES_REVERSAL',
            },
          });
        return;
      }
      let reason: string | null = null;
      let status = 'SETTLED';
      if (remote.amount_refunded > 0) {
        status = 'REVIEW_REQUIRED';
        reason = 'PAYMENT_ALREADY_REFUNDED';
      } else if (p.status === 'PAID') {
        // Staff may have approved this very same gateway payment through the old app.
        // This is a duplicate settlement attempt, not a second collection to refund.
        if (p.providerReference !== remote.id) {
          status = 'REFUND_PENDING';
          reason = 'DUPLICATE_PAYMENT';
        }
      } else if (['CANCELLED', 'COMPLETED'].includes(a.status)) {
        status = 'REFUND_PENDING';
        reason = 'ALLOCATION_CANCELLED_OR_COMPLETED';
      } else if (w.status !== 'PAYMENT_PENDING' || !a.rider.userId) {
        status = 'REVIEW_REQUIRED';
        reason = 'ALLOCATION_NOT_PAYABLE';
      } else if (
        !p.amount.mul(100).eq(order.amountPaise.toString()) ||
        p.currency !== order.currency
      ) {
        status = 'REVIEW_REQUIRED';
        reason = 'PAYMENT_AMOUNT_CHANGED';
      } else {
        try {
          await this.commercial.assertPaymentQuote(tx, order.clientId, a);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          status = 'REVIEW_REQUIRED';
          reason = 'COMMERCIAL_QUOTE_CHANGED';
        }
      }
      if (
        status === 'SETTLED' &&
        (await tx.deploymentPayment.findFirst({
          where: { providerReference: remote.id, id: { not: p.id } },
          select: { id: true },
        }))
      ) {
        status = 'REVIEW_REQUIRED';
        reason = 'PAYMENT_REFERENCE_ALREADY_USED';
      }
      await tx.deploymentPaymentCapture.create({
        data: {
          attemptId: order.id,
          providerPaymentId: remote.id,
          paymentMethod: razorpayPaymentMethod(remote),
          amountPaise: BigInt(remote.amount),
          currency: remote.currency,
          status,
          reason,
        },
      });
      await tx.deploymentPaymentAttempt.update({
        where: { id: order.id },
        data: { status: 'PAID', checkedAt: new Date() },
      });
      if (status === 'SETTLED') {
        const paid = await tx.deploymentPayment.update({
          where: { id: p.id },
          data: {
            provider: 'RAZORPAY',
            providerReference: remote.id,
            rejectionReason: null,
            rejectedAt: null,
            rejectedById: null,
          },
        });
        // The financial receipt belongs to the payer; approval itself is attributed to the system.
        await this.commercial.settlePaymentInTransaction(
          tx,
          order.clientId,
          a.rider.userId!,
          { ...a, mobileDeployment: { ...w, payment: paid } },
          true,
        );
      }
      await tx.auditLog.create({
        data: {
          clientId: order.clientId,
          actorId: null,
          action: 'RAZORPAY_PAYMENT_RECONCILED',
          entityType: 'DeploymentPayment',
          entityId: p.id,
          newData: {
            orderId: order.providerOrderId,
            paymentId: remote.id,
            status,
            reason,
          },
        },
      });
    });
  }
  async webhook(raw: Buffer, signature: string, eventId: string, routedClientId?: string) {
    if (!eventId || eventId.length > 128)
      throw new BadRequestException('A valid Razorpay event ID is required.');
    let input: z.infer<typeof hook>;
    try {
      input = hook.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      throw new BadRequestException('Invalid Razorpay webhook payload.');
    }
    const providerPaymentId = input.payload.payment?.entity.id ?? input.payload.refund?.entity.payment_id;
    const providerOrderId = input.payload.payment?.entity.order_id ?? input.payload.order?.entity.id;
    const clientId = await resolveWebhookMerchant(this.db, {
      orderId: providerOrderId,
      paymentId: providerPaymentId,
      tokenId: input.payload.token?.entity.id,
    }, routedClientId);
    const configurationVersionId = await this.gateway.verifyWebhook(raw, signature, clientId);
    const hash = createHash('sha256').update(raw).digest('hex');
    await this.db.paymentProviderEvent.createMany({
      skipDuplicates: true,
      data: {
        provider: 'RAZORPAY',
        eventKey: eventId,
        clientId,
        configurationVersionId,
        eventType: input.event,
        payloadHash: hash,
        recurringPayload: { tokenId: (input.payload.token as { entity: { id: string } } | undefined)?.entity.id ?? null },
        deploymentPayload: {
          paymentId: providerPaymentId ?? null,
          orderId: input.payload.payment?.entity.order_id ?? input.payload.order?.entity.id ?? null,
          refundId: input.payload.refund?.entity.id ?? null,
        },
      },
    });
    const event = await this.db.paymentProviderEvent.findUniqueOrThrow({
      where: { provider_eventKey: { provider: 'RAZORPAY', eventKey: eventId } },
    });
    if (event.clientId && event.clientId !== clientId)
      throw new ConflictException('Razorpay webhook merchant mismatch.');
    if (event.payloadHash !== hash)
      throw new BadRequestException(
        'Webhook event ID was reused with different content.',
      );
    if (!event.clientId) {
      await this.db.paymentProviderEvent.updateMany({ where: { id: event.id, clientId: null }, data: { clientId } });
      const bound = await this.db.paymentProviderEvent.findUniqueOrThrow({ where: { id: event.id } });
      if (bound.clientId !== clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
    }
    if (!event.configurationVersionId && configurationVersionId) {
      await this.db.paymentProviderEvent.updateMany({
        where: { id: event.id, clientId, configurationVersionId: null },
        data: { configurationVersionId },
      });
    }
    if (['PROCESSED', 'IGNORED'].includes(event.status))
      return { received: true };
    // Durable inbox: acknowledge only after storing the signature-verified event.
    // The worker retries processing even after Razorpay stops delivering retries.
    return { received: true };
  }
  private async processEvent(event: {
    id: string;
    eventType: string;
    deploymentPayload: unknown;
    recurringPayload?: unknown;
    clientId?: string | null;
    configurationVersionId?: string | null;
  }) {
    try {
      if (!event.clientId) throw new ConflictException('Webhook requires merchant-verified redelivery.');
      if (await this.eventRouter?.process(event)) {
        await this.db.paymentProviderEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), failureReason: null } });
        return;
      }
      const entity = z
        .object({
          paymentId: z.string().nullable(),
          orderId: z.string().nullable(),
          refundId: z.string().nullable().optional(),
        })
        .parse(event.deploymentPayload);
      const handled = [
        'payment.authorized',
        'payment.captured',
        'order.paid',
        'payment.failed',
        'refund.processed',
        'refund.failed',
      ].includes(event.eventType);
      let owned = false;
      if (entity.refundId && entity.paymentId) {
        const capture = await this.db.deploymentPaymentCapture.findUnique({
          where: { providerPaymentId: entity.paymentId },
          include: { attempt: true },
        });
        if (capture) {
          if (capture.attempt.clientId !== event.clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
          owned = true;
          await this.db.paymentProviderEvent.update({
            where: { id: event.id },
            data: {
              deploymentAttemptId: capture.attemptId,
              clientId: capture.attempt.clientId,
            },
          });
          await this.reconcileRefund(capture.id);
        }
      }
      if (handled && (!entity.paymentId || !entity.orderId))
        if (!entity.refundId)
          throw new BadRequestException(
          'Payment and order IDs are required for this webhook event.',
          );
      if (handled && !entity.refundId && entity.orderId && entity.paymentId) {
        let order = await this.db.deploymentPaymentAttempt.findUnique({
          where: { providerOrderId: entity.orderId },
        });
        if (!order) {
          const remote = await this.gateway.fetchOrder(entity.orderId, event.clientId, event.configurationVersionId);
          const pending = remote.receipt
            ? await this.db.deploymentPaymentAttempt.findUnique({
                where: { id: remote.receipt },
              })
            : null;
          if (pending) {
            if (pending.clientId !== event.clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
            await this.gateway.assertConfigured(pending.clientId, pending.providerKeyReference!, pending.configurationVersionId);
            order = await this.bindOrder(pending, remote);
          }
        }
        if (!order && this.penalties) owned = await this.penalties.processEvent(event.id, entity.orderId, entity.paymentId, event.clientId, event.configurationVersionId);
        if (order) {
          if (order.clientId !== event.clientId) throw new ConflictException('Razorpay webhook merchant mismatch.');
          owned = true;
          await this.gateway.assertConfigured(order.clientId, order.providerKeyReference!, order.configurationVersionId);
          await this.db.paymentProviderEvent.update({
            where: { id: event.id },
            data: { deploymentAttemptId: order.id, clientId: order.clientId },
          });
          const payment = await this.gateway.fetchPayment(entity.paymentId, order.clientId, order.configurationVersionId);
          this.assertPayment(order, payment);
          if (['captured', 'refunded'].includes(payment.status))
            await this.settle(order, payment);
        }
      }
      await this.db.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: handled && owned ? 'PROCESSED' : 'IGNORED',
          processedAt: new Date(),
          failureReason: null,
        },
      });
    } catch (error) {
      await this.db.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          processedAt: new Date(),
          failureReason: 'RAZORPAY_RECONCILIATION_FAILED',
        },
      });
      throw error;
    }
  }
  async reconcileOrder(order: DeploymentPaymentAttempt) {
    await this.db.deploymentPaymentAttempt.update({
      where: { id: order.id },
      data: { checkedAt: new Date() },
    });
    await this.gateway.assertConfigured(order.clientId, order.providerKeyReference!, order.configurationVersionId);
    if (!order.providerOrderId) {
      if (Date.now() - order.createdAt.getTime() < 30000) return;
      const matches = await this.gateway.findOrders(order.id, order.clientId, order.configurationVersionId);
      if (!matches.length) return; // Ambiguous create: never blindly issue another POST.
      order = await this.bindOrder(order, matches[0]);
    }
    for (const payment of await this.gateway.orderPayments(
      order.providerOrderId!, order.clientId, order.configurationVersionId,
    ))
      if (['captured', 'refunded'].includes(payment.status))
        await this.settle(order, payment);
  }
  private async reconcileRefund(id: string) {
    const capture = await this.db.deploymentPaymentCapture.findUniqueOrThrow({
      where: { id },
      include: { attempt: true },
    });
    await this.db.deploymentPaymentCapture.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    await this.gateway.assertConfigured(capture.attempt.clientId, capture.attempt.providerKeyReference!, capture.attempt.configurationVersionId);
    let remote;
    if (capture.providerRefundId)
      remote = await this.gateway.fetchRefund(capture.providerRefundId, capture.attempt.clientId, capture.attempt.configurationVersionId);
    else if (capture.status === 'REFUND_PENDING') {
      const payment = await this.gateway.fetchPayment(
        capture.providerPaymentId, capture.attempt.clientId, capture.attempt.configurationVersionId,
      );
      if (payment.amount_refunded !== 0) {
        await this.db.deploymentPaymentCapture.update({
          where: { id },
          data: {
            status: 'REVIEW_REQUIRED',
            reason: 'EXTERNAL_REFUND_DETECTED',
          },
        });
        return;
      }
      const claim = await this.db.deploymentPaymentCapture.updateMany({
        where: { id, status: 'REFUND_PENDING' },
        data: { status: 'REFUND_UNKNOWN' },
      });
      if (!claim.count) return;
      try {
        remote = await this.gateway.refund(
          capture.providerPaymentId,
          Number(capture.amountPaise),
          capture.id, capture.attempt.clientId, capture.attempt.configurationVersionId,
        );
      } catch (error) {
        if (error instanceof RazorpayProviderError && error.definitive)
          await this.db.deploymentPaymentCapture.update({
            where: { id },
            data: {
              status: 'REFUND_FAILED',
              reason: 'PROVIDER_REFUND_REJECTED',
            },
          });
        throw error;
      }
    } else
      remote = (await this.gateway.findRefunds(capture.providerPaymentId, capture.attempt.clientId, capture.attempt.configurationVersionId)).find(
        (r) => r.receipt === capture.id,
      );
    if (!remote) {
      await this.db.deploymentPaymentCapture.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      return;
    }
    if (
      remote.payment_id !== capture.providerPaymentId ||
      BigInt(remote.amount) !== capture.amountPaise
    )
      throw new ConflictException('Refund does not match captured payment.');
    await this.db.$transaction(async (tx) => {
      await tx.deploymentPaymentCapture.update({
        where: { id },
        data: {
          providerRefundId: remote.id,
          status:
            remote.status === 'processed'
              ? 'REFUNDED'
              : remote.status === 'failed'
                ? 'REFUND_FAILED'
                : 'REFUND_PROCESSING',
        },
      });
      await tx.auditLog.create({
        data: {
          clientId: capture.attempt.clientId,
          action: 'RAZORPAY_REFUND_RECONCILED',
          entityType: 'DeploymentPayment',
          entityId: capture.attempt.deploymentPaymentId,
          newData: {
            captureId: id,
            refundId: remote.id,
            status: remote.status,
          },
        },
      });
    });
  }
  async details(clientId: string, allocationId: string) {
    const a = await this.allocation(this.db, clientId, allocationId);
    const orders = await this.db.deploymentPaymentAttempt.findMany({
      where: { clientId, deploymentPaymentId: a.mobileDeployment!.payment!.id },
      include: { captures: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => ({
      ...order,
      amountPaise: order.amountPaise.toString(),
      captures: order.captures.map((capture) => ({
        ...capture,
        amountPaise: capture.amountPaise.toString(),
      })),
    }));
  }
  async reconcileAllocation(clientId: string, allocationId: string) {
    const a = await this.allocation(this.db, clientId, allocationId);
    const orders = await this.db.deploymentPaymentAttempt.findMany({
      where: { clientId, deploymentPaymentId: a.mobileDeployment!.payment!.id },
    });
    const events = orders.length
      ? await this.db.paymentProviderEvent.findMany({
          where: {
            provider: 'RAZORPAY',
            status: { in: ['RECEIVED', 'FAILED'] },
            OR: orders
              .filter((order) => order.providerOrderId)
              .map((order) => ({
                deploymentPayload: {
                  path: ['orderId'],
                  equals: order.providerOrderId!,
                },
              })),
          },
        })
      : [];
    for (const event of events) await this.processEvent(event);
    for (const order of orders) await this.reconcileOrder(order);
    const captures = await this.db.deploymentPaymentCapture.findMany({
      where: {
        attemptId: { in: orders.map((order) => order.id) },
        status: {
          in: ['REFUND_PENDING', 'REFUND_UNKNOWN', 'REFUND_PROCESSING'],
        },
      },
    });
    for (const capture of captures) await this.reconcileRefund(capture.id);
    return this.details(clientId, allocationId);
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile() {
    // Missing lease infrastructure must fail closed for scheduled money work.
    if (!this.automation) return;
    await this.automation.run('worker:razorpay-deployment', async () => {
      await this.runScheduledBatch();
      return true;
    }, 30);
  }
  private async runScheduledBatch() {
    if (!this.gateway.enabled || this.running) return;
    this.running = true;
    try {
      const events = await this.db.paymentProviderEvent.findMany({
        where: { provider: 'RAZORPAY', status: { in: ['RECEIVED', 'FAILED'] } },
        orderBy: { processedAt: { sort: 'asc', nulls: 'first' } },
        take: 10,
      });
      for (const event of events) {
        try {
          await this.processEvent(event);
        } catch {
          this.logger.warn(`Razorpay event processing pending: ${event.id}`);
        }
      }
      // Include paid/superseded orders: a second capture or late capture still needs recording.
      const orders = await this.db.deploymentPaymentAttempt.findMany({
        where: { status: { not: 'FAILED' } },
        orderBy: { checkedAt: 'asc' },
        take: 10,
      });
      for (const order of orders) {
        try {
          await this.reconcileOrder(order);
        } catch {
          this.logger.warn(
            `Razorpay order reconciliation pending: ${order.id}`,
          );
        }
      }
      if (this.penalties) await this.penalties.reconcile();
      const refunds = await this.db.deploymentPaymentCapture.findMany({
        where: {
          status: {
            in: ['REFUND_PENDING', 'REFUND_UNKNOWN', 'REFUND_PROCESSING'],
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 10,
      });
      for (const refund of refunds) {
        try {
          await this.reconcileRefund(refund.id);
        } catch {
          this.logger.warn(
            `Razorpay refund reconciliation pending: ${refund.id}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
