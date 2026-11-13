import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MandateService } from '../mandate.service.js';
import { PaymentOrchestratorService } from '../payment-orchestrator.service.js';
import {
  RazorpayEventRouter,
  type RazorpayInboxEvent,
} from './razorpay-event-router.service.js';
import { RazorpayRecurringClient } from './razorpay-recurring.client.js';

@Injectable()
export class RazorpayAutoPayWorker implements OnModuleInit {
  private running = false;
  private readonly logger = new Logger(RazorpayAutoPayWorker.name);
  constructor(
    private readonly db: PrismaService,
    private readonly mandates: MandateService,
    private readonly payments: PaymentOrchestratorService,
    private readonly gateway: RazorpayRecurringClient,
    private readonly events: RazorpayEventRouter,
  ) {}
  onModuleInit() {
    this.events.register((event) => this.processEvent(event));
  }
  async processEvent(event: RazorpayInboxEvent) {
    if (event.eventType.startsWith('token.')) {
      const parsed = z
        .object({ tokenId: z.string().regex(/^token_[A-Za-z0-9]+$/) })
        .safeParse(event.recurringPayload);
      if (!parsed.success) return false;
      const mandate = await this.db.paymentMandate.findFirst({
        where: { provider: 'RAZORPAY', providerTokenId: parsed.data.tokenId },
      });
      // First token confirmation may arrive before registration recovery binds it.
      // The independent mandate poll below recovers that case without trusting webhook identity.
      if (!mandate) return false;
      await this.mandates.reconcileStored(mandate.id);
      await this.db.paymentProviderEvent.update({
        where: { id: event.id },
        data: { clientId: mandate.clientId, mandateId: mandate.id },
      });
      return true;
    }
    if (
      ![
        'payment.captured',
        'payment.authorized',
        'payment.failed',
        'order.paid',
      ].includes(event.eventType)
    )
      return false;
    const entity = z
      .object({
        paymentId: z.string().nullable(),
        orderId: z.string().nullable(),
      })
      .parse(event.deploymentPayload);
    if (!entity.orderId) return false;
    let transaction = await this.db.paymentTransaction.findFirst({
      where: { provider: 'RAZORPAY', providerOrderId: entity.orderId },
    });
    let mandate = await this.db.paymentMandate.findFirst({
      where: {
        provider: 'RAZORPAY',
        providerAuthorizationOrderId: entity.orderId,
      },
    });
    if (!transaction && !mandate) {
      // Bind only through an existing local attempt's receipt, never caller-supplied client IDs.
      const order = await this.gateway.fetchOrder(entity.orderId);
      if (order.receipt) {
        transaction = await this.db.paymentTransaction.findFirst({
          where: { provider: 'RAZORPAY', id: order.receipt },
        });
        if (!transaction)
          mandate = await this.db.paymentMandate.findFirst({
            where: { provider: 'RAZORPAY', id: order.receipt },
          });
      }
    }
    if (transaction) {
      await this.payments.verify(
        transaction.clientId,
        transaction.riderId,
        transaction.id,
      );
      await this.db.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          clientId: transaction.clientId,
          paymentTransactionId: transaction.id,
          mandateId: transaction.mandateId,
        },
      });
      return true;
    }
    if (mandate) {
      await this.mandates.reconcileStored(mandate.id);
      await this.db.paymentProviderEvent.update({
        where: { id: event.id },
        data: { clientId: mandate.clientId, mandateId: mandate.id },
      });
      return true;
    }
    return false;
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile() {
    if (this.running || !this.gateway.enabled) return;
    this.running = true;
    try {
      const mandates = await this.db.paymentMandate.findMany({
        where: {
          provider: 'RAZORPAY',
          status: {
            in: [
              'CREATING',
              'CREATED',
              'AUTHORIZATION_PENDING',
              'ACTIVE',
              'PAUSED',
              'UNKNOWN',
            ],
          },
        },
        orderBy: { providerCheckedAt: 'asc' },
        take: 20,
      });
      for (const m of mandates) {
        await this.db.paymentMandate.update({
          where: { id: m.id },
          data: { providerCheckedAt: new Date() },
        });
        try {
          await this.mandates.reconcileStored(m.id);
        } catch {
          this.logger.warn(`Razorpay mandate reconciliation pending: ${m.id}`);
        }
      }
      // Include successful/failed debits to detect external refunds and late captures.
      const debits = await this.db.paymentTransaction.findMany({
        where: { provider: 'RAZORPAY' },
        orderBy: { providerCheckedAt: 'asc' },
        take: 20,
      });
      for (const t of debits) {
        await this.db.paymentTransaction.update({
          where: { id: t.id },
          data: { providerCheckedAt: new Date() },
        });
        try {
          await this.payments.verify(t.clientId, t.riderId, t.id);
        } catch {
          this.logger.warn(`Razorpay debit reconciliation pending: ${t.id}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
