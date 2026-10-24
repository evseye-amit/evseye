import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WalletService } from '../../wallet/wallet.service.js';
import { WalletBillingService } from '../../wallet/wallet-billing.service.js';
import { RazorpayClient } from './razorpay.client.js';
import { RazorpayPenaltyService } from './razorpay-penalty.service.js';

const open = ['CREATING', 'PENDING', 'UNKNOWN'];
@Injectable()
export class RazorpayInvoiceService {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: RazorpayClient,
    private readonly wallet: WalletService,
    private readonly walletBilling: WalletBillingService,
    private readonly collections: RazorpayPenaltyService,
  ) {}

  async payInvoice(
    clientId: string,
    riderId: string,
    invoiceId: string,
    key: string,
    useWallet: boolean,
    actorId: string,
  ) {
    this.gateway.assertConfigured(clientId);
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException(
        'Idempotency-Key must contain 8–120 letters, digits, colon, underscore, or hyphen.',
      );
    // Check ownership before creating any wallet or changing its balance.
    const owned = await this.db.riderInvoice.findFirst({
      where: { id: invoiceId, clientId, riderId },
    });
    if (!owned) throw new NotFoundException('INVOICE_NOT_FOUND');
    if (owned.invoiceType !== 'RENTAL')
      throw new BadRequestException(
        'Razorpay invoice checkout currently supports rental invoices only.',
      );
    if (owned.currency !== 'INR')
      throw new BadRequestException(
        'Razorpay rental invoice payments support INR only.',
      );
    const wallet = await this.wallet.ensure(clientId, riderId, actorId);
    const result = await this.wallet.locked(wallet.id, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
      const previous = await tx.paymentCollectionRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
        include: { razorpayPenaltyOrder: true },
      });
      if (previous) {
        const snapshot = previous.paymentSnapshot as Record<
          string,
          unknown
        > | null;
        if (
          previous.provider !== 'RAZORPAY' ||
          previous.collectionType !== 'INVOICE_PAYMENT' ||
          previous.riderId !== riderId ||
          previous.invoiceId !== invoiceId ||
          snapshot?.useWallet !== useWallet
        )
          throw new ConflictException(
            'Idempotency-Key belongs to another payment request.',
          );
        if (
          previous.status === 'FAILED' &&
          !previous.razorpayPenaltyOrder?.providerOrderId
        )
          throw new ConflictException(
            'Payment order was rejected. Use a new Idempotency-Key to retry.',
          );
        if (!previous.razorpayPenaltyOrder)
          throw new ConflictException(
            'Payment order is unavailable; contact support.',
          );
        return { request: previous, order: previous.razorpayPenaltyOrder };
      }
      // Keep the same conservative cross-provider exclusion used by penalty checkout.
      const active = await tx.paymentCollectionRequest.findFirst({
        where: {
          clientId,
          riderId,
          OR: [
            { status: { in: open } },
            {
              provider: 'RAZORPAY',
              status: 'SUCCESS',
              failureCode: { not: null },
            },
          ],
        },
      });
      if (active) throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      if (
        await tx.paymentTransaction.findFirst({
          where: {
            clientId,
            riderId,
            invoiceId,
            status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
          },
        })
      )
        throw new ConflictException('PAYMENT_ALREADY_IN_PROGRESS');
      await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${invoiceId} AND "clientId" = ${clientId} FOR UPDATE`;
      let invoice = await tx.riderInvoice.findFirstOrThrow({
        where: { id: invoiceId, clientId, riderId },
      });
      if (invoice.invoiceType !== 'RENTAL' || invoice.currency !== 'INR')
        throw new ConflictException(
          'Rental invoice scope or currency changed.',
        );
      const outstandingBeforeWallet = invoice.outstandingAmount;
      const walletKey = `razorpay:invoice:${key}`;
      const applied = await tx.walletTransaction.findUnique({
        where: {
          clientId_idempotencyKey: { clientId, idempotencyKey: walletKey },
        },
      });
      if (applied) {
        if (
          !useWallet ||
          !(await tx.walletInvoiceAllocation.findFirst({
            where: { clientId, invoiceId, transactionId: applied.id },
          }))
        )
          throw new ConflictException(
            'Idempotency-Key belongs to another wallet payment.',
          );
      } else if (
        !['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) ||
        invoice.outstandingAmount.lte(0)
      )
        throw new ConflictException('INVOICE_ALREADY_PAID');
      if (useWallet)
        invoice = await this.walletBilling.settleInTransaction(
          tx,
          clientId,
          invoiceId,
          actorId,
          walletKey,
          wallet,
        );
      if (invoice.outstandingAmount.lte(0))
        return { request: null, order: null };
      const amount = invoice.outstandingAmount;
      const paise = amount.mul(100);
      if (
        amount.lt(1) ||
        !paise.isInteger() ||
        paise.gt(Number.MAX_SAFE_INTEGER)
      )
        throw new BadRequestException(
          'The external rental payment must be at least INR 1.00 and within the supported amount range.',
        );
      const id = randomUUID();
      const request = await tx.paymentCollectionRequest.create({
        data: {
          clientId,
          riderId,
          invoiceId,
          collectionType: 'INVOICE_PAYMENT',
          provider: 'RAZORPAY',
          method: 'UPI',
          status: 'CREATING',
          amount,
          currency: invoice.currency,
          idempotencyKey: key,
          paymentSnapshot: {
            version: 1,
            scope: 'RENTAL_INVOICE',
            invoiceId,
            useWallet,
            totalAmount: invoice.totalAmount.toFixed(2),
            outstandingBeforePayment: amount.toFixed(2),
            externalPaymentRequested: amount.toFixed(2),
            walletContribution: outstandingBeforeWallet
              .minus(amount)
              .toFixed(2),
          },
          attempts: {
            create: {
              clientId,
              sequence: 1,
              status: 'CREATING',
              providerPaymentId: `invoice_${id}`,
            },
          },
        },
      });
      const order = await tx.razorpayPenaltyOrder.create({
        data: {
          id,
          collectionId: request.id,
          keyId: this.gateway.keyId,
          amountPaise: BigInt(paise.toString()),
          currency: invoice.currency,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'PAYMENT_COLLECTION_CREATED',
          entityType: 'PaymentCollectionRequest',
          entityId: request.id,
          newData: {
            invoiceId,
            provider: 'RAZORPAY',
            purpose: 'INVOICE',
            amount: amount.toFixed(2),
          },
        },
      });
      return { request, order };
    });
    if (!result.request || !result.order)
      return { collectionId: null, amount: '0.00', currency: owned.currency };
    // Replays of terminal orders must not submit another provider POST.
    if (
      !['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(
        result.request.status,
      )
    )
      await this.collections.startOrder(
        clientId,
        result.order,
        'INVOICE_PAYMENT',
      );
    return {
      collectionId: result.request.id,
      amount: result.request.amount.toFixed(2),
      currency: result.request.currency,
    };
  }
}
