import { ConflictException } from '@nestjs/common';
import { Prisma, type PaymentCollectionRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { WalletService } from '../wallet/wallet.service.js';

/** Settle only the saved rental invoice; surplus stays unallocated for review. */
export async function settleRazorpayRentalInvoice(
  db: PrismaService,
  payments: RiderPaymentsService,
  walletService: WalletService,
  request: PaymentCollectionRequest,
  paymentId: string,
) {
  const snapshot = request.paymentSnapshot as Record<string, unknown> | null;
  if (
    request.collectionType !== 'INVOICE_PAYMENT' ||
    request.provider !== 'RAZORPAY' ||
    !request.invoiceId ||
    snapshot?.version !== 1 ||
    snapshot.scope !== 'RENTAL_INVOICE' ||
    snapshot.invoiceId !== request.invoiceId ||
    snapshot.externalPaymentRequested !== request.amount.toFixed(2)
  )
    throw new ConflictException('INVALID_RENTAL_INVOICE_COLLECTION');
  const { clientId, riderId } = request;
  const wallet = await walletService.ensure(clientId, riderId, 'SYSTEM');
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id = ${wallet.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
          const current = await tx.paymentCollectionRequest.findUniqueOrThrow({
            where: { id: request.id },
          });
          if (current.status === 'SUCCESS') {
            if (current.providerPaymentId !== paymentId)
              throw new ConflictException('DUPLICATE_CAPTURE_REQUIRES_REVIEW');
            return current;
          }
          const payment = await payments.confirmProviderPaymentInTransaction(
            tx,
            {
              clientId,
              riderId,
              amount: current.amount,
              currency: current.currency,
              method: current.method,
              provider: current.provider,
              providerPaymentId: paymentId,
              sourceId: current.id,
              allocate: true,
              invoiceId: current.invoiceId!,
              invoiceType: 'RENTAL',
            },
          );
          const accounts = await tx.walletAccount.findMany({
            where: { clientId, walletId: wallet.id },
          });
          const clearing = accounts.find((a) => a.accountType === 'CLEARING');
          const provider = accounts.find(
            (a) => a.accountType === 'PROVIDER_CLEARING',
          );
          if (!clearing || !provider)
            throw new ConflictException('WALLET_ACCOUNT_NOT_FOUND');
          const amount = current.amount.toFixed(2);
          await walletService.postInTransaction(tx, {
            clientId,
            walletId: wallet.id,
            actorId: 'SYSTEM',
            type: 'PAYMENT',
            amount,
            currency: current.currency,
            description: `Verified rental invoice payment ${current.id}`,
            idempotencyKey: `provider:invoice:${current.id}`,
            referenceType: 'PAYMENT_COLLECTION',
            referenceId: current.id,
            entries: [
              { accountId: clearing.id, entryType: 'DEBIT', amount },
              { accountId: provider.id, entryType: 'CREDIT', amount },
            ],
          });
          const receipt = await tx.riderPayment.findUniqueOrThrow({
            where: { id: payment.id },
          });
          const updated = await tx.paymentCollectionRequest.update({
            where: { id: current.id },
            data: {
              status: 'SUCCESS',
              providerPaymentId: paymentId,
              riderPaymentId: payment.id,
              completedAt: new Date(),
              failureCode: receipt.unallocatedAmount.gt(0)
                ? 'UNAPPLIED_PROVIDER_PAYMENT_REVIEW'
                : null,
              attempts: {
                update: {
                  where: {
                    collectionRequestId_sequence: {
                      collectionRequestId: current.id,
                      sequence: 1,
                    },
                  },
                  data: { status: 'SUCCESS', providerReference: paymentId },
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
              newData: { riderPaymentId: payment.id, amount },
            },
          });
          return updated;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 12000,
        },
      );
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
