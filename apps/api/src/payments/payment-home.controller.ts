import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';
import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';

@Controller('rider-app/payments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderPaymentHomeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientContextService,
    private readonly billing: RiderBillingService,
    private readonly receipts: RiderPaymentsService,
    private readonly policy: PaymentGatewayPolicyService,
  ) {}
  private async context(user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return {
      clientId,
      riderId: await this.billing.riderForUser(clientId, user.id),
    };
  }
  @Get('home')
  async home(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.context(user);
    const [invoices, profile, mandate, nextAutoPay, recentPayments, capabilities, pendingCheckout] =
      await Promise.all([
        this.prisma.riderInvoice.findMany({
          where: {
            clientId,
            riderId,
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
          },
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            outstandingAmount: true,
            invoiceType: true,
            dueDate: true,
            status: true,
          },
        }),
        this.prisma.riderPaymentProfile.findUnique({
          where: { clientId_riderId: { clientId, riderId } },
        }),
        this.prisma.paymentMandate.findFirst({
          where: { clientId, riderId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            method: true,
            maxAmount: true,
            expiresAt: true,
          },
        }),
        this.prisma.paymentTransaction.findFirst({
          where: { clientId, riderId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
          orderBy: { scheduledAt: 'asc' },
          select: { scheduledAt: true },
        }),
        this.prisma.riderPayment.findMany({
          where: { clientId, riderId, status: 'CONFIRMED' },
          orderBy: { receivedAt: 'desc' },
          take: 5,
          select: { id: true, amount: true, method: true, receivedAt: true },
        }),
        this.policy.capabilities(clientId),
        this.prisma.paymentCollectionRequest.findFirst({ where: { clientId, riderId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } }, select: { id: true } }),
      ]);
    const now = new Date();
    const amountDue = invoices.reduce(
      (sum, invoice) => sum.plus(invoice.outstandingAmount),
      new Prisma.Decimal(0),
    );
    const overdueAmount = invoices
      .filter((invoice) => invoice.dueDate < now)
      .reduce(
        (sum, invoice) => sum.plus(invoice.outstandingAmount),
        new Prisma.Decimal(0),
      );
    const autoPayStatus = !mandate || !profile?.autoPayEnabled
      ? 'NOT_ENABLED'
      : mandate.expiresAt && mandate.expiresAt <= now ? 'EXPIRED' : ((
          {
            CREATED: 'SETUP_REQUIRED',
            AUTHORIZATION_PENDING: 'AUTHENTICATION_PENDING',
            ACTIVE: 'ACTIVE',
            PAUSED: 'PAUSED',
            FAILED: 'FAILED',
            CANCELLED: 'REVOKED',
            EXPIRED: 'EXPIRED',
            UNKNOWN: 'SETUP_REQUIRED',
          } as Record<string, string>
        )[mandate.status] ?? 'SETUP_REQUIRED');
    const capability = capabilities.purposes.OUTSTANDING;
    const payNowUnavailableReason = amountDue.lte(0) ? 'NO_AMOUNT_DUE'
      : !capability?.enabled ? capability?.reason ?? 'PAYMENT_UNAVAILABLE'
      : pendingCheckout || nextAutoPay ? 'PAYMENT_ALREADY_IN_PROGRESS'
      : invoices.some(i => i.invoiceType === 'SECURITY_DEPOSIT') ? 'PAY_SECURITY_DEPOSIT_INVOICE_SEPARATELY'
      : amountDue.lt(1) ? 'PAYMENT_BELOW_GATEWAY_MINIMUM' : null;
    return {
      data: {
        amountDue: amountDue.toFixed(2),
        overdueAmount: overdueAmount.toFixed(2),
        dueDate: invoices[0]?.dueDate ?? null,
        currency: profile?.currency ?? 'INR',
        autoPayStatus,
        autoPayEnabled: profile?.autoPayEnabled ?? false,
        paymentMethod: mandate?.method ?? null,
        mandateStatus: mandate?.status ?? null,
        mandateMaxAmount: mandate?.maxAmount.toFixed(2) ?? null,
        mandateExpiresAt: mandate?.expiresAt ?? null,
        nextAutoPayDate: nextAutoPay?.scheduledAt ?? null,
        recentPayments: recentPayments.map((payment) => ({
          id: payment.id,
          amount: payment.amount.toFixed(2),
          method: payment.method,
          receivedAt: payment.receivedAt,
        })),
        payNowAvailable: payNowUnavailableReason === null,
        payNowUnavailableReason,
      },
    };
  }
  @Get('history') async history(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.context(user);
    const payments = await this.receipts.history(clientId, riderId);
    return {
      data: payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        receivedAt: payment.receivedAt,
        allocations: payment.allocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amount: allocation.amount.toFixed(2),
        })),
      })),
    };
  }
  @Get('attempts/:id')
  async attempt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { clientId, riderId } = await this.context(user);
    const checkout = await this.prisma.paymentCollectionRequest.findFirst({
      where: { id, clientId, riderId },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        method: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (checkout) return { data: checkout };
    const autopay = await this.prisma.paymentTransaction.findFirst({
      where: { id, clientId, riderId },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        scheduledAt: true,
        completedAt: true,
      },
    });
    if (autopay) return { data: autopay };
    throw new NotFoundException('Payment attempt not found.');
  }
}
