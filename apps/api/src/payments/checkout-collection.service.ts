import { settleCheckoutPayment } from './checkout-payment-settlement.js';
import { RazorpayPenaltyService } from './razorpay/razorpay-penalty.service.js';
import { settlePenaltyPayment } from './penalty-payment-settlement.js';
import { PENALTY_PAYMENT, parseOutstandingInput, planPenaltyPayment } from './outstanding-payment.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PaymentGatewayPolicyService, type PaymentPurpose } from './payment-gateway-policy.service.js';
import { CashfreePaymentProvider } from './cashfree/cashfree-payment.provider.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { ConfigService } from '@nestjs/config';
import { Prisma, type PaymentCollectionRequest } from '@prisma/client';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { WalletBillingService } from '../wallet/wallet-billing.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { SecurityDepositService } from '../wallet/security-deposit.service.js';
import { ProviderRequestError } from './payment-provider.interface.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type CheckoutProvider,
} from './payment-provider.interface.js';

const openStatuses = ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] as const;
function validateCheckoutAmount(provider: string, amount: Prisma.Decimal) {
  if (provider !== 'razorpay') return;
  const paise = amount.mul(100);
  if (!paise.isInteger() || paise.lt(100) || paise.gt(Number.MAX_SAFE_INTEGER))
    throw new BadRequestException('Online payments require at least INR 1.00 and a supported amount.');
}
const paymentNumber = () => `EVP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
@Injectable()
export class CheckoutCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly payments: RiderPaymentsService,
    private readonly deposits: RiderDepositService,
    private readonly walletBilling: WalletBillingService,
    private readonly wallet: WalletService,
    private readonly walletDeposits: SecurityDepositService,
    private readonly razorpayPenalties?: RazorpayPenaltyService,
    @Optional() private readonly policy?: PaymentGatewayPolicyService,
    @Optional() private readonly cashfree?: CashfreePaymentProvider,
    @Optional() private readonly mock?: MockPaymentProvider,
  ) {}
  private async selected(clientId: string, purpose: PaymentPurpose) {
    const name = this.policy ? await this.policy.resolve(clientId, purpose) : this.config.getOrThrow('PAYMENT_PROVIDER').toUpperCase();
    if (!['RAZORPAY', 'CASHFREE', 'MOCK'].includes(name)) throw new ServiceUnavailableException('Use the configured gateway checkout endpoint for this purpose.');
    return name.toLowerCase();
  }
  private savedProvider(name: string): CheckoutProvider {
    if (name === 'CASHFREE' && this.cashfree) return this.cashfree;
    if (name === 'MOCK' && this.mock) return this.mock;
    if (name === this.config.getOrThrow('PAYMENT_PROVIDER').toUpperCase()) return this.provider;
    throw new ServiceUnavailableException('The saved checkout provider is unavailable.');
  }
  private async providerFor(request: PaymentCollectionRequest, newOperation = false) {
    return request.provider === 'CASHFREE' && this.cashfree
      ? this.cashfree.forClient(request.clientId, newOperation ? undefined : request.configurationVersionId ?? null)
      : this.savedProvider(request.provider);
  }
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 12000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  private view(request: {
    id: string;
    paymentNumber?: string | null;
    invoiceId: string | null;
    depositId: string | null;
    status: string;
    amount: Prisma.Decimal;
    currency: string;
    method: string;
    paymentSessionId: string | null;
    providerOrderId: string | null;
    riderPaymentId: string | null;
    depositTransactionId?: string | null;
    failureCode: string | null;
  }) {
    return {
      collectionId: request.id,
      paymentNumber: request.paymentNumber ?? null,
      invoiceId: request.invoiceId,
      depositId: request.depositId,
      status: request.status,
      amount: request.amount.toFixed(2),
      currency: request.currency,
      method: request.method,
      paymentSessionId: request.paymentSessionId,
      orderId: request.providerOrderId,
      paymentId: request.riderPaymentId,
      depositTransactionId: request.depositTransactionId ?? null,
      failureCode: request.failureCode,
    };
  }
  async payInvoice(
    clientId: string,
    riderId: string,
    invoiceId: string,
    key: string,
    useWallet: boolean,
    actorId: string,
  ) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('Idempotency-Key is required.');
    const providerName = await this.selected(clientId, 'INVOICE');
    if (providerName === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    const existing = await this.prisma.paymentCollectionRequest.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
    });
    let walletContribution = new Prisma.Decimal(0);
    if (!existing && useWallet) {
      const ownedInvoice = await this.prisma.riderInvoice.findFirst({ where: { id: invoiceId, clientId, riderId } });
      if (!ownedInvoice) throw new NotFoundException('INVOICE_NOT_FOUND');
      const settled = await this.walletBilling.settle(clientId, invoiceId, actorId, `checkout:${key}`);
      walletContribution = settled.paidAmount.minus(ownedInvoice.paidAmount);
      if (settled.outstandingAmount.lte(0)) return {
        collectionId: null, paymentNumber: null, invoiceId, depositId: null, status: 'PAID', amount: '0.00',
        currency: settled.currency, method: 'WALLET', paymentSessionId: null,
        orderId: null, paymentId: null, depositTransactionId: null, failureCode: null,
      };
    }
    let created = false;
    let request;
    try {
      request = await this.serializable(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
        const invoice = await tx.riderInvoice.findFirst({
          where: { id: invoiceId, clientId, riderId },
        });
        if (!invoice) throw new NotFoundException('INVOICE_NOT_FOUND');
        const previous = await tx.paymentCollectionRequest.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (previous.riderId !== riderId || previous.invoiceId !== invoiceId)
            throw new ConflictException(
              'Collection key belongs to another obligation.',
            );
          return previous;
        }
        if (
          !openStatuses.includes(
            invoice.status as (typeof openStatuses)[number],
          ) ||
          invoice.outstandingAmount.lte(0)
        )
          throw new ConflictException('INVOICE_ALREADY_PAID');
        if (invoice.currency !== 'INR')
          throw new BadRequestException('Checkout supports INR invoices.');
        validateCheckoutAmount(providerName, invoice.outstandingAmount);
        const inProgress = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            OR: [{ invoiceId }, { collectionType: { in: ['OUTSTANDING_PAYMENT', PENALTY_PAYMENT] } }],
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        });
        if (inProgress)
          throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
        const autoPay = await tx.paymentTransaction.findFirst({
          where: {
            clientId,
            riderId,
            invoiceId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        });
        if (autoPay) throw new ConflictException('AUTOPAY_ALREADY_IN_PROGRESS');
        const rider = await tx.rider.findFirst({
          where: { id: riderId, clientId, deletedAt: null },
          select: { name: true, mobile: true },
        });
        if (!rider) throw new NotFoundException('Rider not found.');
        const orderId = `EVSEYE_PG_${randomUUID().replaceAll('-', '')}`;
        const result = await tx.paymentCollectionRequest.create({
          data: {
            clientId,
            riderId,
            invoiceId,
            collectionType: 'INVOICE_PAYMENT',
            paymentNumber: paymentNumber(),
            method: 'UPI',
            provider: providerName.toUpperCase(),
            amount: invoice.outstandingAmount,
            paymentSnapshot: {
              settlement: 'CHECKOUT',
              invoiceId,
              invoiceNumber: invoice.invoiceNumber,
              originalInvoiceAmount: invoice.totalAmount.toFixed(2),
              outstandingBeforePayment: invoice.outstandingAmount.toFixed(2),
              walletContribution: walletContribution.toFixed(2),
              externalPaymentRequested: invoice.outstandingAmount.toFixed(2),
              currency: invoice.currency,
            },
            currency: invoice.currency,
            idempotencyKey: key,
            providerOrderId: providerName === 'razorpay' ? null : orderId,
            status: 'CREATING',
            attempts: {
              create: {
                clientId,
                sequence: 1,
                providerPaymentId: orderId,
                status: 'CREATING',
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: null,
            action: 'PAYMENT_COLLECTION_CREATED',
            entityType: 'PaymentCollectionRequest',
            entityId: result.id,
            newData: { invoiceId, amount: result.amount.toFixed(2) },
          },
        });
        created = true;
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      throw error;
    }
    if (!created) return this.resume(request);
    return this.startProviderCheckout(request, riderId);
  }
  async payOutstanding(clientId: string, riderId: string, key: string, input?: unknown) {
    const selection = parseOutstandingInput(input);
    const isPenalty = selection.scope === 'SUBMISSION_PENALTY';
    const collectionType = isPenalty ? PENALTY_PAYMENT : 'OUTSTANDING_PAYMENT';
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('Idempotency-Key is required.');
    const providerName = await this.selected(clientId, isPenalty ? 'SUBMISSION_PENALTY' : 'OUTSTANDING');
    if (providerName === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    let created = false;
    let request: PaymentCollectionRequest;
    try {
      request = await this.serializable(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
        const previous = await tx.paymentCollectionRequest.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (
            previous.riderId !== riderId ||
            previous.collectionType !== collectionType
          )
            throw new ConflictException(
              'Collection key belongs to another obligation.',
            );
          const snapshot = previous.paymentSnapshot && typeof previous.paymentSnapshot === 'object' && !Array.isArray(previous.paymentSnapshot) ? previous.paymentSnapshot as Record<string, unknown> : {};
          if ((snapshot.requestedAmount ?? null) !== selection.requestedAmount) throw new ConflictException('Idempotency-Key was used with a different payment amount.');
          return previous;
        }
        const invoices = await tx.riderInvoice.findMany({
          where: {
            clientId,
            riderId,
            status: { in: [...openStatuses] },
            outstandingAmount: { gt: 0 },
            ...(isPenalty ? { invoiceType: 'SUBMISSION_PENALTY' } : {}),
          },
          select: { id: true, currency: true, outstandingAmount: true, invoiceType: true },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        });
        if (!invoices.length)
          throw new ConflictException('No outstanding invoices.');
        // Deposit funding uses its dedicated ledger, never the generic receivables allocator.
        if (invoices.some(invoice => invoice.invoiceType === 'SECURITY_DEPOSIT'))
          throw new ConflictException('PAY_SECURITY_DEPOSIT_INVOICE_SEPARATELY');
        if (invoices.some((invoice) => invoice.currency !== 'INR'))
          throw new BadRequestException('Checkout supports INR invoices.');
        const inProgress = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        });
        const autoPay = await tx.paymentTransaction.findFirst({
          where: {
            clientId,
            riderId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        });
        if (inProgress || autoPay)
          throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
        const rider = await tx.rider.findFirst({
          where: { id: riderId, clientId, deletedAt: null },
          select: { id: true },
        });
        if (!rider) throw new NotFoundException('Rider not found.');
        const outstanding = invoices.reduce(
          (sum, invoice) => sum.plus(invoice.outstandingAmount),
          new Prisma.Decimal(0),
        );
        const amount = selection.requestedAmount === null ? outstanding : new Prisma.Decimal(selection.requestedAmount);
        if (isPenalty && amount.lt(1)) throw new BadRequestException('The minimum online penalty payment is INR 1.00.');
        if (amount.gt(outstanding)) throw new BadRequestException('Payment amount cannot exceed the outstanding balance.');
        validateCheckoutAmount(providerName, amount);
        const snapshot = { version: 1, scope: selection.scope, requestedAmount: selection.requestedAmount, outstandingBeforePayment: outstanding.toFixed(2), externalPaymentRequested: amount.toFixed(2),
          allocations: planPenaltyPayment(invoices, amount),
        };
        const orderId = `EVSEYE_PG_${randomUUID().replaceAll('-', '')}`;
        const result = await tx.paymentCollectionRequest.create({
          data: {
            clientId,
            riderId,
            collectionType,
            paymentSnapshot: snapshot,
            paymentNumber: paymentNumber(),
            method: 'UPI',
            provider: providerName.toUpperCase(),
            amount,
            currency: 'INR',
            idempotencyKey: key,
            providerOrderId: providerName === 'razorpay' ? null : orderId,
            status: 'CREATING',
            attempts: {
              create: {
                clientId,
                sequence: 1,
                providerPaymentId: orderId,
                status: 'CREATING',
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: null,
            action: 'PAYMENT_COLLECTION_CREATED',
            entityType: 'PaymentCollectionRequest',
            entityId: result.id,
            newData: {
              scope: selection.scope, invoiceIds: invoices.map((invoice) => invoice.id),
              amount: amount.toFixed(2),
            },
          },
        });
        created = true;
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      throw error;
    }
    if (!created) return this.resume(request);
    return this.startProviderCheckout(request, riderId);
  }

  async payTopUp(clientId: string, riderId: string, key: string, requestedAmount: string) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key)) throw new BadRequestException('Idempotency-Key is required.');
    if (!/^(?:[5-9]\d{2}|[1-4]\d{3}|5000)\.\d{2}$/.test(requestedAmount)) throw new BadRequestException('Top-up amount must be between INR 500.00 and INR 5000.00.');
    const amount = new Prisma.Decimal(requestedAmount);
    if (amount.gt(5000)) throw new BadRequestException('Top-up amount must be between INR 500.00 and INR 5000.00.');
    const providerName = await this.selected(clientId, 'TOP_UP');
    if (providerName === 'disabled') throw new ServiceUnavailableException('Payment provider is disabled.');
    const wallet = await this.wallet.ensure(clientId, riderId, 'SYSTEM');
    let created = false;
    let request: PaymentCollectionRequest;
    try {
      request = await this.serializable(async (tx) => {
        const previous = await tx.paymentCollectionRequest.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
        if (previous) {
          if (previous.riderId !== riderId || previous.collectionType !== 'TOP_UP' || !previous.amount.eq(amount)) throw new ConflictException('Idempotency-Key was used with a different top-up.');
          return previous;
        }
        const orderId = `EVSEYE_PG_${randomUUID().replaceAll('-', '')}`;
        const result = await tx.paymentCollectionRequest.create({ data: { clientId, riderId, collectionType: 'TOP_UP', paymentNumber: paymentNumber(), method: 'UPI', provider: providerName.toUpperCase(), amount, currency: wallet.currency, idempotencyKey: key, providerOrderId: providerName === 'razorpay' ? null : orderId, status: 'CREATING', paymentSnapshot: { purpose: 'TOP_UP', requestedAmount: amount.toFixed(2), refundable: false, withdrawable: false }, attempts: { create: { clientId, sequence: 1, providerPaymentId: orderId, status: 'CREATING' } } } });
        await tx.walletTransaction.create({ data: { clientId, walletId: wallet.id, transactionNumber: `EVW-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${randomUUID().slice(0,8).toUpperCase()}`, transactionType: 'TOP_UP', status: 'PENDING', currency: wallet.currency, amount, description: 'Money added to wallet', idempotencyKey: `topup:${result.id}`, requestHash: createHash('sha256').update(`${result.id}:${amount.toFixed(2)}`).digest('hex'), referenceType: 'PAYMENT_COLLECTION', referenceId: result.id } });
        created = true;
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      throw error;
    }
    if (!created) return this.resume(request);
    return this.startProviderCheckout(request, riderId);
  }
  async payDeposit(
    clientId: string,
    riderId: string,
    depositId: string,
    key: string,
  ) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('Idempotency-Key is required.');
    const providerName = await this.selected(clientId, 'SECURITY_DEPOSIT');
    if (providerName === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    let created = false;
    let request: PaymentCollectionRequest;
    try {
      request = await this.serializable(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
        const previous = await tx.paymentCollectionRequest.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (previous.riderId !== riderId || previous.depositId !== depositId)
            throw new ConflictException(
              'Collection key belongs to another obligation.',
            );
          return previous;
        }
        const deposit = await tx.riderDeposit.findFirst({
          where: { id: depositId, clientId, riderId },
        });
        if (!deposit) throw new NotFoundException('Deposit not found.');
        if (deposit.status === 'CLOSED')
          throw new ConflictException('Deposit is closed.');
        if (deposit.currency !== 'INR')
          throw new BadRequestException('Checkout supports INR deposits.');
        const amount = Prisma.Decimal.max(
          0,
          deposit.depositType === 'RIDER_SECURITY'
            ? deposit.requiredAmount.minus(deposit.availableAmount)
            : deposit.requiredAmount.minus(deposit.fundedAmount),
        );
        if (amount.lte(0))
          throw new ConflictException('Deposit is already funded.');
        validateCheckoutAmount(providerName, amount);
        const inProgress = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            OR: [{ depositId }, { collectionType: { in: ['OUTSTANDING_PAYMENT', PENALTY_PAYMENT] } }],
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        });
        if (inProgress)
          throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
        const orderId = `EVSEYE_PG_${randomUUID().replaceAll('-', '')}`;
        const result = await tx.paymentCollectionRequest.create({
          data: {
            clientId,
            riderId,
            depositId,
            collectionType: 'SECURITY_DEPOSIT',
            method: 'UPI',
            provider: providerName.toUpperCase(),
            amount,
            currency: deposit.currency,
            idempotencyKey: key,
            providerOrderId: providerName === 'razorpay' ? null : orderId,
            status: 'CREATING',
            attempts: {
              create: {
                clientId,
                sequence: 1,
                providerPaymentId: orderId,
                status: 'CREATING',
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: null,
            action: 'DEPOSIT_COLLECTION_CREATED',
            entityType: 'PaymentCollectionRequest',
            entityId: result.id,
            newData: { depositId, amount: amount.toFixed(2) },
          },
        });
        created = true;
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      throw error;
    }
    if (!created) return this.resume(request);
    return this.startProviderCheckout(request, riderId);
  }
  private async resume(request: PaymentCollectionRequest): Promise<ReturnType<CheckoutCollectionService['view']>> {
    if (['SUCCESS', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(request.status)) return this.view(request);
    if (request.provider === 'RAZORPAY' || !request.paymentSessionId)
      return this.startProviderCheckout(request, request.riderId);
    return this.view(request);
  }

  private async startProviderCheckout(request: PaymentCollectionRequest, riderId: string) {
    if (request.provider === 'RAZORPAY') {
      if (!this.razorpayPenalties) throw new ServiceUnavailableException('Razorpay checkout is unavailable.');
      await this.razorpayPenalties.startCollection(request);
      return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
    }
    // Pin credentials and the exact outbound payload before claiming the POST.
    // A crash before this transaction commits cannot have sent a provider request.
    request = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PaymentCollectionRequest" WHERE id=${request.id} FOR UPDATE`;
      const saved = await tx.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } });
      const snapshot = (saved.paymentSnapshot ?? {}) as Prisma.JsonObject;
      if (snapshot.paymentEnvironment || ['SUCCESS', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(saved.status)) return saved;
      if (saved.status !== 'CREATING') throw new ConflictException('PROVIDER_CHECKOUT_RECOVERY_REQUIRES_REVIEW');
      const provider = await this.providerFor(saved, true);
      const binding = provider as { configurationVersionId?: string; environment?: string };
      const rider = await tx.rider.findFirstOrThrow({ where: { id: riderId, clientId: saved.clientId }, select: { name: true, mobile: true } });
      return tx.paymentCollectionRequest.update({ where: { id: saved.id }, data: {
        configurationVersionId: binding.configurationVersionId,
        paymentSnapshot: { ...snapshot, paymentEnvironment: binding.environment ?? (saved.provider === 'CASHFREE' ? this.config.getOrThrow('CASHFREE_ENVIRONMENT') : 'MOCK'),
          checkoutCustomer: { id: riderId, phone: rider.mobile, name: rider.name }, checkoutNotifyUrl: this.config.get('CASHFREE_PG_WEBHOOK_URL') ?? null },
      } });
    });
    if (['SUCCESS', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(request.status)) return this.view(request);
    const provider = await this.providerFor(request);
    const claimed = await this.prisma.paymentAttempt.updateMany({
      where: { collectionRequestId: request.id, sequence: 1, status: 'CREATING' }, data: { status: 'UNKNOWN' },
    });
    const snapshot = request.paymentSnapshot as Prisma.JsonObject;
    if (!claimed.count || !snapshot.checkoutCustomer) {
      try {
        const order = await provider.fetchCheckoutOrder(request.providerOrderId!);
        if (order.orderId !== request.providerOrderId) throw new ConflictException('PROVIDER_ORDER_MISMATCH');
        if (order.status !== 'ACTIVE') return this.verify(request.clientId, riderId, request.id, false);
        if (!order.paymentSessionId || order.currency !== request.currency || !order.amount || !new Prisma.Decimal(order.amount).eq(request.amount))
          throw new ConflictException('PROVIDER_CHECKOUT_RECOVERY_REQUIRES_REVIEW');
        return this.bindCheckout(request, order.paymentSessionId, order.expiresAt);
      } catch (error) {
        // Cashfree explicitly supports same-key retry after timeout. Never rotate the
        // merchant/order/key or reconstruct a historical payload we did not persist.
        if (!(error instanceof ProviderRequestError) || error.httpStatus !== 404 || !snapshot.checkoutCustomer) throw error;
      }
    }
    const customer = snapshot.checkoutCustomer as { id: string; phone: string; name: string } | undefined;
    if (!customer) throw new ConflictException('PROVIDER_CHECKOUT_RECOVERY_REQUIRES_REVIEW');
    try {
      const order = await provider.createCheckoutOrder({
        orderId: request.providerOrderId!, idempotencyKey: request.id, amount: request.amount.toFixed(2), currency: request.currency,
        customer, notifyUrl: typeof snapshot.checkoutNotifyUrl === 'string' ? snapshot.checkoutNotifyUrl : undefined,
      });
      if (order.orderId !== request.providerOrderId || !order.paymentSessionId) throw new ConflictException('Provider checkout order identity mismatch.');
      return this.bindCheckout(request, order.paymentSessionId, order.expiresAt);
    } catch (error) {
      const known = error instanceof ProviderRequestError && error.category === 'INVALID_REQUEST' && error.httpStatus !== 409;
      await this.prisma.paymentCollectionRequest.updateMany({
        where: { id: request.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
        data: { status: known ? 'FAILED' : 'UNKNOWN', failureCode: known ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE' },
      });
      // An uncertain result is not a failed top-up, and a webhook may already have succeeded.
      if (known && request.collectionType === 'TOP_UP') await this.prisma.walletTransaction.updateMany({
        where: { clientId: request.clientId, referenceType: 'PAYMENT_COLLECTION', referenceId: request.id, status: 'PENDING',
          wallet: { clientId: request.clientId } }, data: { status: 'FAILED', failedAt: new Date() },
      });
      if (known) throw new BadRequestException('Payment provider rejected the checkout order.');
      throw new ServiceUnavailableException('Checkout order state is uncertain; reuse the same request or reconcile before retrying.');
    }
  }

  private async bindCheckout(request: PaymentCollectionRequest, session: string, expiresAt?: string) {
    await this.prisma.paymentCollectionRequest.updateMany({
      where: { id: request.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
      data: { paymentSessionId: session, status: 'PENDING', failureCode: null,
        expiresAt: expiresAt && Number.isFinite(Date.parse(expiresAt)) ? new Date(expiresAt) : undefined },
    });
    await this.prisma.paymentAttempt.updateMany({ where: { collectionRequestId: request.id, sequence: 1, status: { in: ['CREATING', 'UNKNOWN'] } }, data: { status: 'PENDING' } });
    return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
  }
  async verify(clientId: string, riderId: string, collectionId: string, recover = true) {
    const request = await this.prisma.paymentCollectionRequest.findFirst({
      where: { id: collectionId, clientId, riderId },
    });
    if (!request) throw new NotFoundException('Collection not found.');
    if (recover && request.provider !== 'RAZORPAY' && !request.paymentSessionId && ['CREATING', 'UNKNOWN'].includes(request.status)) return this.resume(request);
    if (request.provider === 'RAZORPAY') {
      if (!this.razorpayPenalties) throw new ConflictException('Use the Razorpay penalty verify endpoint.');
      await this.razorpayPenalties.reconcileCollection(clientId, riderId, request.id);
      return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
    }
    if (!request.providerOrderId)
      throw new ConflictException('Collection has no provider order.');
    const results = await (await this.providerFor(request)).fetchCheckoutPayments(
      request.providerOrderId,
    );
    for (const result of results) {
      if (!result.providerPaymentId) continue;
      const existingObservation = await this.prisma.providerPaymentObservation.findUnique({
        where: { provider_providerPaymentId: { provider: request.provider, providerPaymentId: result.providerPaymentId } },
      });
      if (existingObservation && (existingObservation.collectionId !== request.id || existingObservation.providerOrderId !== result.orderId))
        throw new ConflictException('PROVIDER_PAYMENT_IDENTITY_CONFLICT');
      const parsedAmount = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(result.amount) && new Prisma.Decimal(result.amount).gt(0)
        ? new Prisma.Decimal(result.amount) : null;
      const reviewCode = result.orderId !== request.providerOrderId ? 'ORDER_MISMATCH'
        : result.currency !== request.currency ? 'CURRENCY_MISMATCH'
        : !parsedAmount || !parsedAmount.eq(request.amount) ? 'AMOUNT_MISMATCH' : null;
      await this.prisma.providerPaymentObservation.upsert({
        where: { provider_providerPaymentId: { provider: request.provider, providerPaymentId: result.providerPaymentId } },
        create: { clientId, riderId, collectionId: request.id, provider: request.provider,
          providerOrderId: result.orderId, providerPaymentId: result.providerPaymentId,
          status: result.status, amount: parsedAmount, currency: result.currency || null, reviewCode },
        update: { status: existingObservation?.status === 'SUCCESS' ? 'SUCCESS' : result.status, reviewCode },
      });
      await this.serializable(async (tx) => {
        const previous = await tx.paymentAttempt.findUnique({
          where: { clientId_providerPaymentId: { clientId, providerPaymentId: result.providerPaymentId } },
        });
        if (previous) {
          if (previous.collectionRequestId !== request.id) throw new ConflictException('PROVIDER_PAYMENT_IDENTITY_CONFLICT');
          if (previous.status !== 'SUCCESS') await tx.paymentAttempt.update({ where: { id: previous.id }, data: {
            status: result.status === 'UNKNOWN' ? 'UNKNOWN' : result.status,
            providerStatus: result.rawStatus,
            providerReference: result.providerReference,
          } });
          return;
        }
        const last = await tx.paymentAttempt.findFirst({ where: { collectionRequestId: request.id }, orderBy: { sequence: 'desc' } });
        await tx.paymentAttempt.create({ data: {
          clientId, collectionRequestId: request.id, sequence: (last?.sequence ?? 0) + 1,
          providerPaymentId: result.providerPaymentId,
          status: result.status === 'UNKNOWN' ? 'UNKNOWN' : result.status,
          providerStatus: result.rawStatus, providerReference: result.providerReference,
        } });
      });
    }
    const success = results.filter((result) => result.status === 'SUCCESS');
    if (success.length > 1) {
      await this.prisma.paymentCollectionRequest.update({ where: { id: request.id }, data: { status: request.status === 'SUCCESS' ? 'SUCCESS' : 'UNKNOWN', failureCode: 'MULTIPLE_PROVIDER_SUCCESSES_REVIEW' } });
      throw new ConflictException('MULTIPLE_PROVIDER_SUCCESSES_REQUIRE_REVIEW');
    }
    const confirmed = success[0];
    if (confirmed) {
      if (
        confirmed.orderId !== request.providerOrderId ||
        !confirmed.providerPaymentId ||
        confirmed.currency !== request.currency ||
        !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(confirmed.amount) ||
        !new Prisma.Decimal(confirmed.amount).eq(request.amount)
      ) {
        await this.prisma.paymentCollectionRequest.update({ where: { id: request.id }, data: {
          status: request.status === 'SUCCESS' ? 'SUCCESS' : 'UNKNOWN', failureCode: 'PROVIDER_PAYMENT_MISMATCH',
        } });
        throw new ConflictException('PROVIDER_PAYMENT_MISMATCH');
      }
      if (request.collectionType === PENALTY_PAYMENT) return this.view(await settlePenaltyPayment(this.prisma, this.payments, this.wallet, request, confirmed.providerPaymentId));
      return this.view(await settleCheckoutPayment(this.prisma, this.payments, this.deposits, this.wallet, this.walletDeposits, request, confirmed));
    }
    const orderStatus = await (await this.providerFor(request)).fetchCheckoutOrder(request.providerOrderId);
    if (orderStatus.orderId !== request.providerOrderId) throw new ConflictException('PROVIDER_ORDER_MISMATCH');
    if (orderStatus.status === 'EXPIRED') {
      await this.prisma.paymentCollectionRequest.updateMany({ where: { id: request.id, status: { not: 'SUCCESS' } }, data: { status: 'EXPIRED', failureCode: 'PROVIDER_ORDER_EXPIRED' } });
      if (request.collectionType === 'TOP_UP') await this.prisma.walletTransaction.updateMany({ where: { clientId, referenceType: 'PAYMENT_COLLECTION', referenceId: request.id, status: 'PENDING' }, data: { status: 'FAILED', failedAt: new Date() } });
      return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
    }
    if (orderStatus.status === 'PAID') {
      await this.prisma.paymentCollectionRequest.updateMany({ where: { id: request.id, status: { not: 'SUCCESS' } }, data: { status: 'UNKNOWN', failureCode: 'PROVIDER_PAID_WITHOUT_VERIFIED_PAYMENT_REVIEW' } });
      return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
    }
    const pending = results.some(
      (result) => result.status === 'PENDING' || result.status === 'UNKNOWN',
    );
    const failed = results.length > 0 && !pending;
    if (!failed) return this.view(request);
    await this.prisma.paymentCollectionRequest.updateMany({
      where: { id: request.id, status: { not: 'SUCCESS' } },
      data: {
        status: 'FAILED',
        failureCode: 'PROVIDER_DECLINED',
      },
    });
    if (request.collectionType === 'TOP_UP') await this.prisma.walletTransaction.updateMany({ where: { clientId, referenceType: 'PAYMENT_COLLECTION', referenceId: request.id, status: 'PENDING' }, data: { status: 'FAILED', failedAt: new Date() } });
    return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
  }
  async webhook(rawBody: Buffer, timestamp: string, signature: string) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(rawBody.toString()); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(); } catch { throw new BadRequestException('Invalid webhook.'); }
    const data = payload.data as Record<string, unknown> | undefined;
    const order = data?.order as Record<string, unknown> | undefined;
    const orderId =
      typeof order?.order_id === 'string'
        ? order.order_id
        : typeof data?.order_id === 'string'
          ? data.order_id
          : '';
    const request = orderId
      ? await this.prisma.paymentCollectionRequest.findUnique({
          where: { providerOrderId: orderId },
        })
      : null;
    if (request && request.provider !== 'CASHFREE') throw new BadRequestException('Webhook provider mismatch.');
    const gateway = request ? await this.providerFor(request) : this.savedProvider('CASHFREE');
    gateway.verifyCheckoutWebhook(rawBody, timestamp, signature);
    const hash = createHash('sha256').update(rawBody).digest('hex');
    const event = await this.prisma.paymentProviderEvent.upsert({
      where: { provider_eventKey: { provider: 'CASHFREE', eventKey: hash } },
      create: {
        provider: 'CASHFREE',
        eventKey: hash,
        eventType: typeof payload.type === 'string' ? payload.type : 'UNKNOWN',
        payloadHash: hash,
        clientId: request?.clientId,
        collectionRequestId: request?.id,
        configurationVersionId: request?.configurationVersionId,
        status: request ? 'RECEIVED' : 'FAILED',
        failureReason: request ? undefined : 'UNKNOWN_ORDER',
      },
      update: {},
    });
    if (!request) return { accepted: true, reviewRequired: true };
    if (event.status === 'PROCESSED')
      return { accepted: true, duplicate: true };
    try {
      const result = await this.verify(
        request.clientId,
        request.riderId,
        request.id,
      );
      if (!['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.status))
        return { accepted: true, pending: true };
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          failureReason: null,
        },
      });
      return { accepted: true };
    } catch {
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          failureReason: 'PROVIDER_RECONCILIATION_FAILED',
        },
      });
      throw new ServiceUnavailableException(
        'Payment event verification failed.',
      );
    }
  }
  async list(clientId: string, riderId: string) {
    return this.prisma.paymentCollectionRequest.findMany({
      where: { clientId, riderId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        paymentNumber: true,
        collectionType: true,
        status: true,
        amount: true,
        currency: true,
        method: true,
        invoiceId: true,
        depositId: true,
        riderPaymentId: true,
        depositTransactionId: true,
        createdAt: true,
        completedAt: true,
        failureCode: true,
      },
    });
  }
  async detail(clientId: string, riderId: string, collectionId: string) {
    const request = await this.prisma.paymentCollectionRequest.findFirst({
      where: { id: collectionId, clientId, riderId },
      select: {
        id: true, paymentNumber: true, invoiceId: true, depositId: true,
        collectionType: true, status: true, amount: true, currency: true,
        method: true, provider: true, providerOrderId: true,
        providerPaymentId: true, riderPaymentId: true, depositTransactionId: true,
        paymentSnapshot: true, failureCode: true, createdAt: true, completedAt: true,
        razorpayPenaltyOrder: { select: { id: true, status: true, providerOrderId: true,
          captures: { select: { providerPaymentId: true, status: true, reason: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } },
        attempts: { select: { sequence: true, status: true, providerStatus: true, createdAt: true, updatedAt: true }, orderBy: { sequence: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('PAYMENT_NOT_FOUND');
    return request;
  }
}
