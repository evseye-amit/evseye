import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
} from './payment-provider.interface.js';

const openStatuses = ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] as const;
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
  ) {}
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
    const providerName = this.config.getOrThrow('PAYMENT_PROVIDER');
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
        const inProgress = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            OR: [{ invoiceId }, { collectionType: 'OUTSTANDING_PAYMENT' }],
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
            paymentNumber: paymentNumber(),
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
            method: 'UPI',
            provider: providerName.toUpperCase(),
            amount: invoice.outstandingAmount,
            paymentSnapshot: {
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
            providerOrderId: orderId,
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
    if (!created) return this.view(request);
    return this.startProviderCheckout(request, riderId);
  }
  async payOutstanding(clientId: string, riderId: string, key: string) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('Idempotency-Key is required.');
    const providerName = this.config.getOrThrow('PAYMENT_PROVIDER');
    if (providerName === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    let created = false;
    let request: PaymentCollectionRequest;
    try {
      request = await this.serializable(async (tx) => {
        const previous = await tx.paymentCollectionRequest.findUnique({
          where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        });
        if (previous) {
          if (
            previous.riderId !== riderId ||
            previous.collectionType !== 'OUTSTANDING_PAYMENT'
          )
            throw new ConflictException(
              'Collection key belongs to another obligation.',
            );
          return previous;
        }
        const invoices = await tx.riderInvoice.findMany({
          where: {
            clientId,
            riderId,
            status: { in: [...openStatuses] },
            outstandingAmount: { gt: 0 },
          },
          select: { id: true, currency: true, outstandingAmount: true },
        });
        if (!invoices.length)
          throw new ConflictException('No outstanding invoices.');
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
        const amount = invoices.reduce(
          (sum, invoice) => sum.plus(invoice.outstandingAmount),
          new Prisma.Decimal(0),
        );
        const orderId = `EVSEYE_PG_${randomUUID().replaceAll('-', '')}`;
        const result = await tx.paymentCollectionRequest.create({
          data: {
            clientId,
            riderId,
            collectionType: 'OUTSTANDING_PAYMENT',
            paymentNumber: paymentNumber(),
            method: 'UPI',
            provider: providerName.toUpperCase(),
            amount,
            currency: 'INR',
            idempotencyKey: key,
            providerOrderId: orderId,
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
              invoiceIds: invoices.map((invoice) => invoice.id),
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
    if (!created) return this.view(request);
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
    const providerName = this.config.getOrThrow('PAYMENT_PROVIDER');
    if (providerName === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    let created = false;
    let request: PaymentCollectionRequest;
    try {
      request = await this.serializable(async (tx) => {
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
        const inProgress = await tx.paymentCollectionRequest.findFirst({
          where: {
            clientId,
            riderId,
            depositId,
            paymentNumber: paymentNumber(),
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
            providerOrderId: orderId,
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
    if (!created) return this.view(request);
    return this.startProviderCheckout(request, riderId);
  }
  private async startProviderCheckout(
    request: PaymentCollectionRequest,
    riderId: string,
  ) {
    const clientId = request.clientId;
    const rider = await this.prisma.rider.findFirstOrThrow({
      where: { id: riderId, clientId },
      select: { name: true, mobile: true },
    });
    try {
      const order = await this.provider.createCheckoutOrder({
        orderId: request.providerOrderId!,
        idempotencyKey: request.id,
        amount: request.amount.toFixed(2),
        currency: request.currency,
        customer: { id: riderId, phone: rider.mobile, name: rider.name },
        notifyUrl: this.config.get('CASHFREE_PG_WEBHOOK_URL'),
      });
      if (order.orderId !== request.providerOrderId || !order.paymentSessionId)
        throw new ConflictException(
          'Provider checkout order identity mismatch.',
        );
      const updated = await this.prisma.paymentCollectionRequest.update({
        where: { id: request.id },
        data: {
          paymentSessionId: order.paymentSessionId,
          expiresAt: order.expiresAt && Number.isFinite(Date.parse(order.expiresAt)) ? new Date(order.expiresAt) : undefined,
          status: 'PENDING',
          attempts: {
            update: {
              where: {
                collectionRequestId_sequence: {
                  collectionRequestId: request.id,
                  sequence: 1,
                },
              },
              data: { status: 'PENDING' },
            },
          },
        },
      });
      return this.view(updated);
    } catch (error) {
      const known =
        error instanceof ProviderRequestError &&
        error.category === 'INVALID_REQUEST';
      await this.prisma.paymentCollectionRequest.update({
        where: { id: request.id },
        data: {
          status: known ? 'FAILED' : 'UNKNOWN',
          failureCode: known ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE',
          attempts: {
            update: {
              where: {
                collectionRequestId_sequence: {
                  collectionRequestId: request.id,
                  sequence: 1,
                },
              },
              data: { status: known ? 'FAILED' : 'UNKNOWN' },
            },
          },
        },
      });
      if (known)
        throw new BadRequestException(
          'Payment provider rejected the checkout order.',
        );
      throw new ServiceUnavailableException(
        'Checkout order state is uncertain; verify before retrying.',
      );
    }
  }
  async verify(clientId: string, riderId: string, collectionId: string) {
    const request = await this.prisma.paymentCollectionRequest.findFirst({
      where: { id: collectionId, clientId, riderId },
    });
    if (!request) throw new NotFoundException('Collection not found.');
    if (!request.providerOrderId)
      throw new ConflictException('Collection has no provider order.');
    const results = await this.provider.fetchCheckoutPayments(
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
      const wallet = request.invoiceId
        ? await this.wallet.ensure(clientId, riderId, 'SYSTEM')
        : null;
      return this.view(
        await this.serializable(async (tx) => {
          if (wallet)
            await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id = ${wallet.id} FOR UPDATE`;
          const current = await tx.paymentCollectionRequest.findUniqueOrThrow({
            where: { id: request.id },
          });
          if (current.status === 'SUCCESS')
            return current;
          let unappliedExternal = false;
          const depositTransaction = current.depositId
            ? await this.deposits.confirmProviderCollectionInTransaction(
                tx,
                clientId,
                riderId,
                current.depositId,
                current.amount,
                confirmed.providerPaymentId,
                current.id,
              )
            : null;
          const walletDepositInvoice = current.invoiceId
            ? await tx.riderInvoice.findFirst({
                where: { id: current.invoiceId, clientId, riderId, invoiceType: 'SECURITY_DEPOSIT' },
                include: { lines: true },
              })
            : null;
          const payment = depositTransaction || walletDepositInvoice
            ? null
            : await this.payments.confirmProviderPaymentInTransaction(tx, {
                clientId,
                riderId,
                amount: current.amount,
                currency: current.currency,
                method: current.method,
                provider: current.provider,
                providerPaymentId: confirmed.providerPaymentId,
                sourceId: current.id,
                invoiceId: current.invoiceId ?? undefined,
                allocate: !current.depositId,
              });
          if (wallet && current.invoiceId) {
            const accounts = await tx.walletAccount.findMany({ where: { clientId, walletId: wallet.id } });
            const account = (type: 'CLEARING' | 'PROVIDER_CLEARING' | 'SECURITY_DEPOSIT') => {
              const found = accounts.find(item => item.accountType === type);
              if (!found) throw new ConflictException('WALLET_ACCOUNT_NOT_FOUND');
              return found;
            };
            if (walletDepositInvoice) {
              let remaining = current.amount;
              for (const line of walletDepositInvoice.lines.filter(item => item.chargeType === 'SECURITY_DEPOSIT')) {
                if (remaining.lte(0)) break;
                const deposit = await tx.walletSecurityDeposit.findFirst({ where: { id: line.sourceId, clientId, walletId: wallet.id } });
                if (!deposit) throw new ConflictException('SECURITY_DEPOSIT_NOT_FOUND');
                const summary = await this.walletDeposits.summaryTx(tx, deposit);
                const applied = Prisma.Decimal.min(remaining, new Prisma.Decimal(summary.outstandingAmount), walletDepositInvoice.outstandingAmount);
                if (applied.lte(0)) continue;
                const amount = applied.toFixed(2);
                const ledger = await this.wallet.postInTransaction(tx, {
                  clientId, walletId: wallet.id, actorId: 'SYSTEM', type: 'SECURITY_DEPOSIT', amount,
                  currency: current.currency, description: `Verified provider deposit payment ${current.id}`,
                  idempotencyKey: `provider:deposit:${current.id}:${deposit.id}`,
                  referenceType: 'WALLET_SECURITY_DEPOSIT', referenceId: deposit.id,
                  entries: [
                    { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
                    { accountId: account('SECURITY_DEPOSIT').id, entryType: 'CREDIT', amount },
                  ],
                });
                await tx.walletInvoiceAllocation.create({ data: {
                  clientId, invoiceId: walletDepositInvoice.id, transactionId: ledger.id,
                  sourceType: 'EXTERNAL_RECORD', amount: applied, currency: current.currency, createdById: 'SYSTEM',
                } });
                await tx.walletSecurityDeposit.update({ where: { id: deposit.id }, data: {
                  status: applied.eq(summary.outstandingAmount) ? 'PAID' : 'PARTIALLY_PAID',
                } });
                remaining = remaining.minus(applied);
              }
              const applied = current.amount.minus(remaining);
              if (remaining.gt(0)) {
                unappliedExternal = true;
                const amount = remaining.toFixed(2);
                await this.wallet.postInTransaction(tx, {
                  clientId, walletId: wallet.id, actorId: 'SYSTEM', type: 'PAYMENT', amount,
                  currency: current.currency, description: `Unapplied provider deposit payment ${current.id}`,
                  idempotencyKey: `provider:unapplied:${current.id}`,
                  referenceType: 'PAYMENT_COLLECTION', referenceId: current.id,
                  entries: [
                    { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
                    { accountId: account('PROVIDER_CLEARING').id, entryType: 'CREDIT', amount },
                  ],
                });
              }
              if (applied.gt(0)) {
                const latest = await tx.riderInvoice.findUniqueOrThrow({ where: { id: walletDepositInvoice.id } });
                const outstanding = latest.outstandingAmount.minus(applied);
                await tx.riderInvoice.update({ where: { id: latest.id }, data: {
                  paidAmount: latest.paidAmount.plus(applied), outstandingAmount: outstanding,
                  status: outstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID',
                  paidAt: outstanding.eq(0) ? new Date() : null,
                } });
              }
            } else {
              const amount = current.amount.toFixed(2);
              await this.wallet.postInTransaction(tx, {
                clientId, walletId: wallet.id, actorId: 'SYSTEM', type: 'PAYMENT', amount,
                currency: current.currency, description: `Verified provider invoice payment ${current.id}`,
                idempotencyKey: `provider:invoice:${current.id}`, referenceType: 'RIDER_INVOICE', referenceId: current.invoiceId,
                entries: [
                  { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
                  { accountId: account('PROVIDER_CLEARING').id, entryType: 'CREDIT', amount },
                ],
              });
              if (payment) {
                const receipt = await tx.riderPayment.findUniqueOrThrow({ where: { id: payment.id } });
                unappliedExternal = receipt.unallocatedAmount.gt(0);
              }
            }
          }
          const updated = await tx.paymentCollectionRequest.update({
            where: { id: current.id },
            data: {
              status: 'SUCCESS',
              providerPaymentId: confirmed.providerPaymentId,
              riderPaymentId: payment?.id,
              depositTransactionId: depositTransaction?.id,
              completedAt: new Date(),
              failureCode:
                unappliedExternal ? 'UNAPPLIED_PROVIDER_PAYMENT_REVIEW' : depositTransaction || !current.depositId
                  ? null
                  : 'DEPOSIT_STATE_CHANGED_REVIEW',
              attempts: {
                update: {
                  where: {
                    collectionRequestId_sequence: {
                      collectionRequestId: current.id,
                      sequence: 1,
                    },
                  },
                  data: {
                    status: 'SUCCESS',
                    providerReference: confirmed.providerReference,
                  },
                },
              },
            },
          });
          await tx.auditLog.create({
            data: {
              clientId,
              actorId: null,
              action: 'PAYMENT_COLLECTION_CONFIRMED',
              entityType: 'PaymentCollectionRequest',
              entityId: current.id,
              newData: {
                riderPaymentId: payment?.id,
                depositTransactionId: depositTransaction?.id,
                amount: current.amount.toFixed(2),
              },
            },
          });
          return updated;
        }),
      );
    }
    const orderStatus = await this.provider.fetchCheckoutOrder(request.providerOrderId);
    if (orderStatus.orderId !== request.providerOrderId) throw new ConflictException('PROVIDER_ORDER_MISMATCH');
    if (orderStatus.status === 'EXPIRED') {
      await this.prisma.paymentCollectionRequest.updateMany({ where: { id: request.id, status: { not: 'SUCCESS' } }, data: { status: 'EXPIRED', failureCode: 'PROVIDER_ORDER_EXPIRED' } });
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
    return this.view(await this.prisma.paymentCollectionRequest.findUniqueOrThrow({ where: { id: request.id } }));
  }
  async webhook(rawBody: Buffer, timestamp: string, signature: string) {
    const verified = this.provider.verifyCheckoutWebhook(
      rawBody,
      timestamp,
      signature,
    );
    const payload = verified.payload as Record<string, unknown>;
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
        attempts: { select: { sequence: true, status: true, providerStatus: true, createdAt: true, updatedAt: true }, orderBy: { sequence: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('PAYMENT_NOT_FOUND');
    return request;
  }
}
