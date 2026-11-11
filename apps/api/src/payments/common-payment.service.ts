import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { CheckoutCollectionService } from './checkout-collection.service.js';
import { RazorpayDeploymentService } from './razorpay/razorpay-deployment.service.js';
import { RazorpayPenaltyService } from './razorpay/razorpay-penalty.service.js';
import {
  parseOrderInput,
  parsePaymentRequestId,
  parseRazorpayCallback,
} from './common-payment.input.js';
import { RazorpayInvoiceService } from './razorpay/razorpay-invoice.service.js';
import { PENALTY_PAYMENT } from './outstanding-payment.js';

const purposes: Record<string, string> = {
  INVOICE_PAYMENT: 'INVOICE',
  OUTSTANDING_PAYMENT: 'OUTSTANDING',
  SECURITY_DEPOSIT: 'SECURITY_DEPOSIT',
  [PENALTY_PAYMENT]: 'SUBMISSION_PENALTY',
};
export function commonPaymentStatus(
  status: string,
  reason: string | null = null,
) {
  if (reason && /REVIEW|DUPLICATE_CAPTURE|EXTERNAL_REFUND/.test(reason))
    return 'REVIEW_REQUIRED';
  if (status === 'REFUNDED') return 'REFUNDED';
  if (status.startsWith('REFUND_')) return 'REFUND_PENDING';
  if (['SUCCESS', 'PAID', 'SETTLED'].includes(status)) return 'SUCCEEDED';
  if (['CREATING', 'CREATE_UNKNOWN'].includes(status)) return 'CREATING';
  if (['OPEN', 'PENDING', 'AUTHORIZED'].includes(status)) return 'PENDING';
  if (['FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'].includes(status))
    return status;
  return 'UNKNOWN';
}
function nextAction(status: string) {
  if (['REVIEW_REQUIRED', 'REFUND_PENDING'].includes(status))
    return 'CONTACT_SUPPORT';
  if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status))
    return 'RETRY_ONLINE_PAYMENT';
  if (['PENDING', 'CREATING', 'UNKNOWN'].includes(status))
    return 'AWAITING_GATEWAY_CONFIRMATION';
  return undefined;
}

@Injectable()
export class CommonPaymentService {
  constructor(
    private readonly db: PrismaService,
    private readonly billing: RiderBillingService,
    private readonly checkout: CheckoutCollectionService,
    private readonly deployments: RazorpayDeploymentService,
    private readonly penalties: RazorpayPenaltyService,
    private readonly invoices?: RazorpayInvoiceService,
  ) {}

  async create(clientId: string, userId: string, body: unknown, key?: string) {
    const input = parseOrderInput(body);
    const riderId = await this.billing.riderForUser(clientId, userId);
    if (input.purpose === 'DEPLOYMENT') {
      const remote = await this.deployments.createOrder(
        clientId,
        userId,
        input.allocationId,
      );
      const order = await this.db.razorpayDeploymentOrder.findFirst({
        where: {
          clientId,
          providerOrderId: remote.orderId,
          payment: {
            workflow: {
              allocationId: input.allocationId,
              allocation: { clientId, riderId },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Payment request not found.');
      return this.detail(clientId, userId, `deployment:${order.id}`);
    }
    if (
      input.purpose === 'SUBMISSION_PENALTY' &&
      input.provider !== 'CASHFREE'
    ) {
      const remote = await this.penalties.createOrder(
        clientId,
        userId,
        input.amount === undefined ? {} : { amount: input.amount },
      );
      const collection = await this.db.paymentCollectionRequest.findFirst({
        where: {
          clientId,
          riderId,
          provider: 'RAZORPAY',
          providerOrderId: remote.orderId,
          collectionType: PENALTY_PAYMENT,
        },
      });
      if (!collection)
        throw new NotFoundException('Payment request not found.');
      return this.detail(clientId, userId, `collection:${collection.id}`);
    }
    // Existing Cashfree checkout owns idempotency, wallet use and settlement.
    const result =
      input.purpose === 'INVOICE' && input.provider === 'RAZORPAY'
        ? await this.invoices!.payInvoice(
            clientId,
            riderId,
            input.invoiceId,
            key ?? '',
            input.useWallet ?? true,
            userId,
          )
        : input.purpose === 'SUBMISSION_PENALTY'
          ? await this.checkout.payOutstanding(clientId, riderId, key ?? '', {
              scope: 'SUBMISSION_PENALTY',
              ...(input.amount === undefined ? {} : { amount: input.amount }),
            })
          : input.purpose === 'INVOICE'
            ? await this.checkout.payInvoice(
                clientId,
                riderId,
                input.invoiceId,
                key ?? '',
                input.useWallet ?? true,
                userId,
              )
            : input.purpose === 'SECURITY_DEPOSIT'
              ? await this.checkout.payDeposit(
                  clientId,
                  riderId,
                  input.depositId,
                  key ?? '',
                )
              : await this.checkout.payOutstanding(
                  clientId,
                  riderId,
                  key ?? '',
                  {
                    scope: 'ALL',
                    ...(input.amount === undefined
                      ? {}
                      : { amount: input.amount }),
                  },
                );
    if (!result.collectionId)
      return {
        paymentRequestId: null,
        purpose: input.purpose,
        provider: 'WALLET',
        providerOrderId: null,
        providerPaymentId: null,
        failureCode: null,
        status: 'SUCCEEDED',
        amount: result.amount,
        currency: result.currency,
        checkout: null,
        invoiceId: input.purpose === 'INVOICE' ? input.invoiceId : null,
      };
    return this.detail(clientId, userId, `collection:${result.collectionId}`);
  }

  private async owned(clientId: string, userId: string, requestId: string) {
    const { kind, recordId } = parsePaymentRequestId(requestId);
    const riderId = await this.billing.riderForUser(clientId, userId);
    if (kind === 'deployment') {
      const order = await this.db.razorpayDeploymentOrder.findFirst({
        where: {
          id: recordId,
          clientId,
          payment: {
            clientId,
            workflow: { allocation: { clientId, riderId } },
          },
        },
        include: {
          payment: {
            include: {
              workflow: {
                select: {
                  allocationId: true,
                  status: true,
                  allocation: { select: { status: true } },
                },
              },
            },
          },
          captures: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!order) throw new NotFoundException('Payment request not found.');
      return { kind: 'deployment' as const, order, riderId };
    }
    const collection = await this.db.paymentCollectionRequest.findFirst({
      where: { id: recordId, clientId, riderId },
      include: {
        razorpayPenaltyOrder: {
          include: { captures: { orderBy: { createdAt: 'desc' } } },
        },
      },
    });
    if (!collection || !purposes[collection.collectionType])
      throw new NotFoundException('Payment request not found.');
    return { kind: 'collection' as const, collection, riderId };
  }

  async detail(clientId: string, userId: string, requestId: string) {
    const owned = await this.owned(clientId, userId, requestId);
    if (owned.kind === 'deployment') {
      const { order } = owned;
      // Review/refund captures take precedence over the paid business payment.
      const capture =
        order.captures.find(
          (c) => !['SETTLED', 'REFUNDED'].includes(c.status),
        ) ??
        order.captures.find((c) => c.status === 'SETTLED') ??
        order.captures[0];
      const cancelled = ['CANCELLED', 'COMPLETED'].includes(
        order.payment.workflow.allocation.status,
      );
      const status = commonPaymentStatus(
        capture?.status ??
          (cancelled && order.payment.status !== 'PAID'
            ? 'CANCELLED'
            : order.payment.status === 'PAID'
              ? 'PAID'
              : order.status),
        capture?.reason,
      );
      const action = cancelled && !capture ? undefined : nextAction(status);
      return {
        paymentRequestId: requestId,
        purpose: 'DEPLOYMENT',
        provider: 'RAZORPAY',
        status,
        amount: new Prisma.Decimal(order.amountPaise.toString())
          .div(100)
          .toFixed(2),
        currency: order.currency,
        allocationId: order.payment.workflow.allocationId,
        providerOrderId: order.providerOrderId,
        providerPaymentId: capture?.providerPaymentId ?? null,
        failureCode: capture?.reason ?? null,
        checkout:
          status === 'PENDING' &&
          order.providerOrderId &&
          ['PENDING', 'REJECTED'].includes(order.payment.status) &&
          order.payment.workflow.status === 'PAYMENT_PENDING' &&
          !cancelled
            ? {
                orderId: order.providerOrderId,
                keyId: order.keyId,
                amountPaise: Number(order.amountPaise),
              }
            : null,
        ...(action ? { nextAction: action } : {}),
      };
    }
    const c = owned.collection;
    const order = c.razorpayPenaltyOrder;
    const review = order?.captures.find(
      (capture) => capture.status !== 'SETTLED',
    );
    const status = commonPaymentStatus(
      review?.status ?? c.status,
      review?.reason ?? c.failureCode,
    );
    const action = nextAction(status);
    return {
      paymentRequestId: requestId,
      purpose: purposes[c.collectionType],
      provider: c.provider,
      status,
      amount: c.amount.toFixed(2),
      currency: c.currency,
      invoiceId: c.invoiceId,
      depositId: c.depositId,
      providerOrderId: c.providerOrderId,
      providerPaymentId: c.providerPaymentId,
      failureCode: review?.reason ?? c.failureCode,
      checkout:
        status === 'PENDING'
          ? c.provider === 'RAZORPAY'
            ? order?.providerOrderId
              ? {
                  orderId: order.providerOrderId,
                  keyId: order.keyId,
                  amountPaise: Number(order.amountPaise),
                }
              : null
            : c.providerOrderId && c.paymentSessionId
              ? {
                  orderId: c.providerOrderId,
                  paymentSessionId: c.paymentSessionId,
                }
              : null
          : null,
      ...(action ? { nextAction: action } : {}),
    };
  }

  async verify(
    clientId: string,
    userId: string,
    requestId: string,
    body: unknown,
  ) {
    const owned = await this.owned(clientId, userId, requestId);
    const provider =
      owned.kind === 'deployment' ? 'RAZORPAY' : owned.collection.provider;
    let action: string | undefined;
    if (provider === 'RAZORPAY') {
      const input = parseRazorpayCallback(body);
      const orderId =
        owned.kind === 'deployment'
          ? owned.order.providerOrderId
          : owned.collection.providerOrderId;
      if (input.razorpayOrderId !== orderId)
        throw new ConflictException(
          'The gateway order does not match this payment request.',
        );
      const result =
        owned.kind === 'deployment'
          ? await this.deployments.verify(
              clientId,
              userId,
              owned.order.payment.workflow.allocationId,
              input,
            )
          : await this.penalties.verify(clientId, userId, input);
      action = result.nextAction;
    } else {
      if (
        body !== undefined &&
        body !== null &&
        (typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length)
      )
        throw new BadRequestException(
          'Cashfree verification does not accept caller payment status, purpose or amount.',
        );
      if (owned.kind !== 'collection')
        throw new NotFoundException('Payment request not found.');
      await this.checkout.verify(clientId, owned.riderId, owned.collection.id);
    }
    const result = await this.detail(clientId, userId, requestId);
    return {
      ...result,
      ...(result.status === 'PENDING' && action ? { nextAction: action } : {}),
    };
  }
}
