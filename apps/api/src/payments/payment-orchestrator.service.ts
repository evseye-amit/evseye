import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentTransactionStatus, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CashfreeProviderError } from './cashfree/cashfree-http.client.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentResult,
} from './payment-provider.interface.js';

type Tx = Prisma.TransactionClient;
const openInvoiceStatuses = ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] as const;

@Injectable()
export class PaymentOrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private async serializable<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
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

  private view(item: {
    id: string;
    invoiceId: string;
    riderId: string;
    status: PaymentTransactionStatus;
    amount: Prisma.Decimal;
    currency: string;
    scheduledAt: Date;
    providerPaymentId: string;
    providerReference: string | null;
    completedAt: Date | null;
  }) {
    return {
      paymentId: item.id,
      invoiceId: item.invoiceId,
      riderId: item.riderId,
      status: item.status,
      amount: item.amount.toFixed(2),
      currency: item.currency,
      scheduledAt: item.scheduledAt.toISOString(),
      providerPaymentId: item.providerPaymentId,
      providerReference: item.providerReference,
      completedAt: item.completedAt?.toISOString() ?? null,
    };
  }

  async collect(
    clientId: string,
    riderId: string,
    invoiceId: string,
    requestKey: string,
    scheduledAtText: string,
  ) {
    if (this.config.getOrThrow('PAYMENT_PROVIDER') === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey))
      throw new BadRequestException(
        'Idempotency-Key must contain 8–120 letters, digits, colon, underscore, or hyphen.',
      );
    const scheduledAt = new Date(scheduledAtText);
    if (!Number.isFinite(scheduledAt.getTime()))
      throw new BadRequestException(
        'A valid ISO payment schedule date is required.',
      );
    let reserved;
    let created = false;
    try {
      reserved = await this.serializable(async (tx) => {
        const invoice = await tx.riderInvoice.findFirst({
          where: { id: invoiceId, clientId, riderId },
        });
        if (!invoice) throw new NotFoundException('Rider invoice not found.');
        const previous = await tx.paymentTransaction.findUnique({
          where: { clientId_invoiceId: { clientId, invoiceId } },
        });
        if (previous) {
          if (previous.requestKey !== requestKey)
            throw new ConflictException(
              'This invoice already has a collection. Use its existing payment ID.',
            );
          return previous;
        }
        // Cashfree ignores the time component and executes by the calendar date in IST.
        const istDay = (value: Date) =>
          new Date(value.getTime() + 330 * 60_000).toISOString().slice(0, 10);
        if (
          scheduledAt <= new Date() ||
          istDay(scheduledAt) <= istDay(new Date())
        )
          throw new BadRequestException(
            'Cashfree charge date must be after today in India.',
          );
        if (
          !openInvoiceStatuses.includes(
            invoice.status as (typeof openInvoiceStatuses)[number],
          ) ||
          invoice.outstandingAmount.lte(0)
        )
          throw new ConflictException(
            'Only a finalized invoice with an outstanding amount can be collected.',
          );
        if (invoice.currency !== 'INR')
          throw new BadRequestException(
            'Cashfree AutoPay currently supports INR invoices only.',
          );
        const mandate = await tx.paymentMandate.findFirst({
          where: {
            clientId,
            riderId,
            status: 'ACTIVE',
            expiresAt: { gt: scheduledAt },
            currency: invoice.currency,
          },
          orderBy: { authorizedAt: 'desc' },
        });
        if (!mandate)
          throw new ConflictException(
            'An active AutoPay mandate valid on the scheduled date is required.',
          );
        if (invoice.outstandingAmount.gt(mandate.maxAmount))
          throw new ConflictException(
            'Invoice outstanding amount exceeds the AutoPay mandate limit.',
          );
        const providerPaymentId = `EVSEYE_PAY_${randomUUID().replaceAll('-', '')}`;
        const item = await tx.paymentTransaction.create({
          data: {
            clientId,
            riderId,
            invoiceId,
            mandateId: mandate.id,
            requestKey,
            provider: this.config.getOrThrow('PAYMENT_PROVIDER').toUpperCase(),
            providerPaymentId,
            status: 'CREATING',
            amount: invoice.outstandingAmount,
            currency: invoice.currency,
            scheduledAt,
            attempts: {
              create: {
                clientId,
                sequence: 1,
                providerPaymentId,
                status: 'CREATING',
              },
            },
          },
        });
        created = true;
        return item;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'An invoice collection already exists. Retry with the same Idempotency-Key.',
        );
      throw error;
    }
    if (!created) {
      if (reserved.status === 'CREATING' || reserved.status === 'UNKNOWN') {
        try {
          return await this.verify(clientId, riderId, reserved.id);
        } catch (error) {
          if (error instanceof CashfreeProviderError)
            return this.view(reserved);
          throw error;
        }
      }
      return this.view(reserved);
    }
    const mandate = await this.prisma.paymentMandate.findFirstOrThrow({
      where: { id: reserved.mandateId, clientId },
    });
    let result: PaymentResult;
    try {
      result = await this.provider.createPayment({
        providerMandateId: mandate.providerMandateId,
        providerPaymentId: reserved.providerPaymentId,
        idempotencyKey: reserved.id,
        amount: reserved.amount.toFixed(2),
        scheduledAt: scheduledAt.toISOString(),
        remarks: `EVsEye invoice ${invoiceId}`,
      });
    } catch (error) {
      const knownRejection =
        error instanceof CashfreeProviderError &&
        error.category === 'INVALID_REQUEST';
      await this.prisma.paymentTransaction.update({
        where: { id: reserved.id },
        data: {
          status: knownRejection ? 'FAILED' : 'UNKNOWN',
          attempts: {
            update: {
              where: {
                transactionId_sequence: {
                  transactionId: reserved.id,
                  sequence: 1,
                },
              },
              data: {
                status: knownRejection ? 'FAILED' : 'UNKNOWN',
                providerStatus: knownRejection
                  ? 'CREATE_REJECTED'
                  : 'CREATE_UNCERTAIN',
              },
            },
          },
        },
      });
      if (knownRejection)
        throw new BadRequestException(
          'Cashfree rejected the scheduled invoice charge.',
        );
      throw new ServiceUnavailableException(
        'Charge creation is uncertain. Verify its status before any further attempt.',
      );
    }
    // A create response is not proof of collection. Fetch any reported success
    // before posting to the immutable ledger; reconciliation failures stay visible.
    const authoritative =
      result.status === 'SUCCESS'
        ? await this.provider.fetchPayment(
            mandate.providerMandateId,
            reserved.providerPaymentId,
          )
        : result;
    return this.view(
      await this.applyResult(
        reserved.id,
        authoritative,
        result.status === 'SUCCESS',
      ),
    );
  }

  private async applyResult(
    transactionId: string,
    result: PaymentResult,
    verified: boolean,
  ) {
    return this.serializable(async (tx) => {
      const item = await tx.paymentTransaction.findUniqueOrThrow({
        where: { id: transactionId },
      });
      const mandate = await tx.paymentMandate.findUniqueOrThrow({
        where: { id: item.mandateId },
      });
      if (
        result.providerMandateId !== mandate.providerMandateId ||
        result.providerPaymentId !== item.providerPaymentId
      )
        throw new ConflictException(
          'Provider payment identity does not match the invoice collection.',
        );
      if (item.status === 'SUCCESS') return item;
      const next = result.status as PaymentTransactionStatus;
      if (next === 'SUCCESS') {
        if (
          !verified ||
          result.paymentType !== 'CHARGE' ||
          !result.providerReference ||
          result.amount == null ||
          !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(result.amount) ||
          !new Prisma.Decimal(result.amount).eq(item.amount)
        )
          throw new ConflictException(
            'Provider payment proof does not match the invoice collection.',
          );
        const invoice = await tx.riderInvoice.findUniqueOrThrow({
          where: { id: item.invoiceId },
        });
        if (
          invoice.clientId !== item.clientId ||
          invoice.riderId !== item.riderId ||
          invoice.currency !== item.currency ||
          !openInvoiceStatuses.includes(
            invoice.status as (typeof openInvoiceStatuses)[number],
          ) ||
          invoice.outstandingAmount.lt(item.amount)
        )
          throw new ConflictException(
            'Invoice state no longer permits payment settlement.',
          );
        const outstanding = invoice.outstandingAmount.minus(item.amount);
        const now = new Date();
        await tx.riderLedgerEntry.create({
          data: {
            clientId: item.clientId,
            riderId: item.riderId,
            entryType: 'PAYMENT',
            sourceType: 'PAYMENT_TRANSACTION',
            sourceId: item.id,
            description: `Cashfree payment for invoice ${invoice.invoiceNumber}`,
            creditAmount: item.amount,
            currency: item.currency,
            effectiveAt: now,
          },
        });
        await tx.riderInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: invoice.paidAmount.plus(item.amount),
            outstandingAmount: outstanding,
            status: outstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: outstanding.eq(0) ? now : null,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId: item.clientId,
            actorId: null,
            action: 'RIDER_INVOICE_PAYMENT_SETTLED',
            entityType: 'RiderInvoice',
            entityId: invoice.id,
            newData: {
              paymentTransactionId: item.id,
              amount: item.amount.toFixed(2),
              providerReference: result.providerReference,
            },
          },
        });
      }
      const updated = await tx.paymentTransaction.update({
        where: { id: item.id },
        data: {
          status: next,
          providerReference: result.providerReference ?? item.providerReference,
          lastVerifiedAt: verified ? new Date() : item.lastVerifiedAt,
          completedAt: next === 'SUCCESS' ? new Date() : item.completedAt,
        },
      });
      await tx.paymentAttempt.update({
        where: {
          transactionId_sequence: { transactionId: item.id, sequence: 1 },
        },
        data: {
          status: next,
          providerStatus: result.rawStatus,
          providerReference: result.providerReference,
        },
      });
      return updated;
    });
  }

  async verify(clientId: string, riderId: string, transactionId: string) {
    const item = await this.prisma.paymentTransaction.findFirst({
      where: { id: transactionId, clientId, riderId },
    });
    if (!item) throw new NotFoundException('Invoice collection not found.');
    if (item.status === 'SUCCESS') return this.view(item);
    const mandate = await this.prisma.paymentMandate.findFirstOrThrow({
      where: { id: item.mandateId, clientId },
    });
    const result = await this.provider.fetchPayment(
      mandate.providerMandateId,
      item.providerPaymentId,
    );
    return this.view(await this.applyResult(item.id, result, true));
  }

  async processWebhook(
    clientId: string,
    providerMandateId: string,
    providerPaymentId: string,
  ) {
    const item = await this.prisma.paymentTransaction.findFirst({
      where: { clientId, providerPaymentId, mandate: { providerMandateId } },
    });
    if (!item)
      throw new NotFoundException('Cashfree payment is not registered.');
    await this.verify(clientId, item.riderId, item.id);
    return item.id;
  }

  async list(clientId: string, riderId: string) {
    const items = await this.prisma.paymentTransaction.findMany({
      where: { clientId, riderId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((item) => this.view(item));
  }
}
