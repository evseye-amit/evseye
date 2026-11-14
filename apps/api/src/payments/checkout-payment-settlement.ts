import { z } from 'zod';
import { ConflictException } from '@nestjs/common';
import { Prisma, type PaymentCollectionRequest } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import type { RiderDepositService } from '../rider-deposits/deposit.service.js';
import type { WalletService } from '../wallet/wallet.service.js';
import type { SecurityDepositService } from '../wallet/security-deposit.service.js';
import { retryablePaymentTransaction } from './transaction-retry.js';

/** Accounting shared by checkout gateways; callers must first verify provider proof. */
export async function settleCheckoutPayment(
  db: PrismaService,
  payments: RiderPaymentsService,
  deposits: RiderDepositService,
  walletService: WalletService,
  walletDeposits: SecurityDepositService,
  request: PaymentCollectionRequest,
  confirmed: { providerPaymentId: string; providerReference?: string },
) {
  const { clientId, riderId } = request;
  async function serializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        });
      } catch (error) {
        if (
          (retryablePaymentTransaction(error) ||
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002')) &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  if (request.collectionType === 'TOP_UP') {
    const updated = await serializable(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE "clientId"=${clientId} AND "riderId"=${riderId} AND currency=${request.currency} FOR UPDATE`;
      const current = await tx.paymentCollectionRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      if (current.status === 'SUCCESS') {
        if (current.providerPaymentId !== confirmed.providerPaymentId)
          throw new ConflictException('DUPLICATE_CAPTURE_REQUIRES_REVIEW');
        return current;
      }
      const pending = await tx.walletTransaction.findFirst({
        where: {
          clientId,
          referenceType: 'PAYMENT_COLLECTION',
          referenceId: current.id,
          transactionType: 'TOP_UP',
          idempotencyKey: `topup:${current.id}`,
        },
      });
      if (!pending) throw new ConflictException('TOP_UP_TRANSACTION_NOT_FOUND');
      const wallet = await tx.riderWallet.findFirstOrThrow({
        where: { clientId, id: pending.walletId },
        include: { accounts: true },
      });
      const cash = wallet.accounts.find((a) => a.accountType === 'CASH');
      const clearing = wallet.accounts.find(
        (a) => a.accountType === 'PROVIDER_CLEARING',
      );
      if (!cash || !clearing)
        throw new ConflictException('WALLET_ACCOUNT_NOT_FOUND');
      await walletService.postInTransaction(tx, {
        clientId,
        walletId: wallet.id,
        actorId: 'SYSTEM',
        type: 'TOP_UP',
        pendingTransactionId: pending.id,
        amount: current.amount.toFixed(2),
        currency: current.currency,
        description: 'Settled wallet top-up',
        idempotencyKey: `topup:post:${current.id}`,
        referenceType: 'PAYMENT_COLLECTION',
        referenceId: current.id,
        entries: [
          {
            accountId: clearing.id,
            entryType: 'DEBIT',
            amount: current.amount.toFixed(2),
          },
          {
            accountId: cash.id,
            entryType: 'CREDIT',
            amount: current.amount.toFixed(2),
          },
        ],
      });
      return tx.paymentCollectionRequest.update({
        where: { id: current.id },
        data: {
          status: 'SUCCESS',
          providerPaymentId: confirmed.providerPaymentId,
          completedAt: new Date(),
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
    });
    return updated;
  }
  const wallet = request.invoiceId
    ? await walletService.ensure(clientId, riderId, 'SYSTEM')
    : null;
  return await serializable(async (tx) => {
    if (wallet)
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id = ${wallet.id} FOR UPDATE`;
    const current = await tx.paymentCollectionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    if (current.status === 'SUCCESS') {
      if (current.providerPaymentId !== confirmed.providerPaymentId)
        throw new ConflictException('DUPLICATE_CAPTURE_REQUIRES_REVIEW');
      return current;
    }
    let unappliedExternal = false;
    const snapshot = current.paymentSnapshot as Record<string, unknown> | null;
    let invoiceLimits: Array<{ invoiceId: string; amount: string }> | undefined;
    if (
      current.collectionType === 'OUTSTANDING_PAYMENT' &&
      snapshot?.allocations !== undefined
    ) {
      const parsed = z
        .array(z.object({ invoiceId: z.string(), amount: z.string() }))
        .min(1)
        .safeParse(snapshot.allocations);
      if (!parsed.success)
        throw new ConflictException('PAYMENT_ALLOCATION_SNAPSHOT_INVALID');
      invoiceLimits = parsed.data;
    }
    const depositTransaction = current.depositId
      ? await deposits.confirmProviderCollectionInTransaction(
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
          where: {
            id: current.invoiceId,
            clientId,
            riderId,
            invoiceType: 'SECURITY_DEPOSIT',
          },
          include: { lines: true },
        })
      : null;
    const payment =
      depositTransaction || walletDepositInvoice
        ? null
        : await payments.confirmProviderPaymentInTransaction(tx, {
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
            invoiceLimits,
          });
    if (wallet && current.invoiceId) {
      const accounts = await tx.walletAccount.findMany({
        where: { clientId, walletId: wallet.id },
      });
      const account = (
        type: 'CLEARING' | 'PROVIDER_CLEARING' | 'SECURITY_DEPOSIT',
      ) => {
        const found = accounts.find((item) => item.accountType === type);
        if (!found) throw new ConflictException('WALLET_ACCOUNT_NOT_FOUND');
        return found;
      };
      if (walletDepositInvoice) {
        let remaining = current.amount;
        for (const line of walletDepositInvoice.lines.filter(
          (item) => item.chargeType === 'SECURITY_DEPOSIT',
        )) {
          if (remaining.lte(0)) break;
          const deposit = await tx.walletSecurityDeposit.findFirst({
            where: { id: line.sourceId, clientId, walletId: wallet.id },
          });
          if (!deposit)
            throw new ConflictException('SECURITY_DEPOSIT_NOT_FOUND');
          const summary = await walletDeposits.summaryTx(tx, deposit);
          const applied = Prisma.Decimal.min(
            remaining,
            new Prisma.Decimal(summary.outstandingAmount),
            walletDepositInvoice.outstandingAmount,
          );
          if (applied.lte(0)) continue;
          const amount = applied.toFixed(2);
          const ledger = await walletService.postInTransaction(tx, {
            clientId,
            walletId: wallet.id,
            actorId: 'SYSTEM',
            type: 'SECURITY_DEPOSIT',
            amount,
            currency: current.currency,
            description: `Verified provider deposit payment ${current.id}`,
            idempotencyKey: `provider:deposit:${current.id}:${deposit.id}`,
            referenceType: 'WALLET_SECURITY_DEPOSIT',
            referenceId: deposit.id,
            entries: [
              { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
              {
                accountId: account('SECURITY_DEPOSIT').id,
                entryType: 'CREDIT',
                amount,
              },
            ],
          });
          await tx.walletInvoiceAllocation.create({
            data: {
              clientId,
              invoiceId: walletDepositInvoice.id,
              transactionId: ledger.id,
              sourceType: 'EXTERNAL_RECORD',
              amount: applied,
              currency: current.currency,
              createdById: 'SYSTEM',
            },
          });
          await tx.walletSecurityDeposit.update({
            where: { id: deposit.id },
            data: {
              status: applied.eq(summary.outstandingAmount)
                ? 'PAID'
                : 'PARTIALLY_PAID',
            },
          });
          remaining = remaining.minus(applied);
        }
        const applied = current.amount.minus(remaining);
        if (remaining.gt(0)) {
          unappliedExternal = true;
          const amount = remaining.toFixed(2);
          await walletService.postInTransaction(tx, {
            clientId,
            walletId: wallet.id,
            actorId: 'SYSTEM',
            type: 'PAYMENT',
            amount,
            currency: current.currency,
            description: `Unapplied provider deposit payment ${current.id}`,
            idempotencyKey: `provider:unapplied:${current.id}`,
            referenceType: 'PAYMENT_COLLECTION',
            referenceId: current.id,
            entries: [
              { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
              {
                accountId: account('PROVIDER_CLEARING').id,
                entryType: 'CREDIT',
                amount,
              },
            ],
          });
        }
        if (applied.gt(0)) {
          const latest = await tx.riderInvoice.findUniqueOrThrow({
            where: { id: walletDepositInvoice.id },
          });
          const outstanding = latest.outstandingAmount.minus(applied);
          await tx.riderInvoice.update({
            where: { id: latest.id },
            data: {
              paidAmount: latest.paidAmount.plus(applied),
              outstandingAmount: outstanding,
              status: outstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID',
              paidAt: outstanding.eq(0) ? new Date() : null,
            },
          });
        }
      } else {
        const amount = current.amount.toFixed(2);
        await walletService.postInTransaction(tx, {
          clientId,
          walletId: wallet.id,
          actorId: 'SYSTEM',
          type: 'PAYMENT',
          amount,
          currency: current.currency,
          description: `Verified provider invoice payment ${current.id}`,
          idempotencyKey: `provider:invoice:${current.id}`,
          referenceType: 'RIDER_INVOICE',
          referenceId: current.invoiceId,
          entries: [
            { accountId: account('CLEARING').id, entryType: 'DEBIT', amount },
            {
              accountId: account('PROVIDER_CLEARING').id,
              entryType: 'CREDIT',
              amount,
            },
          ],
        });
        if (payment) {
          const receipt = await tx.riderPayment.findUniqueOrThrow({
            where: { id: payment.id },
          });
          unappliedExternal = receipt.unallocatedAmount.gt(0);
        }
      }
    }
    if (payment) {
      const receipt = await tx.riderPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      unappliedExternal = receipt.unallocatedAmount.gt(0);
    }
    const updated = await tx.paymentCollectionRequest.update({
      where: { id: current.id },
      data: {
        status: 'SUCCESS',
        providerPaymentId: confirmed.providerPaymentId,
        riderPaymentId: payment?.id,
        depositTransactionId: depositTransaction?.id,
        completedAt: new Date(),
        failureCode: unappliedExternal
          ? 'UNAPPLIED_PROVIDER_PAYMENT_REVIEW'
          : depositTransaction || !current.depositId
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
  });
}
