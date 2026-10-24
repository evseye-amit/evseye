import { afterAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CheckoutCollectionService } from './checkout-collection.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { SubmissionPenaltyService } from '../submission-penalties/submission-penalty.service.js';
import { requirePenaltyClearance } from '../submission-penalties/penalty-accounting.js';

const url = process.env.PENALTY_PAYMENT_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());
const D = (amount: string) => new Prisma.Decimal(amount);
describe.skipIf(!url)(
  'consolidated penalty payment accounting in PostgreSQL',
  () => {
    async function fixture() {
      const id = randomUUID();
      const client = await db.client.create({
        data: { name: 'Penalty checkout test', slug: id, status: 'ACTIVE' },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          name: 'Rider',
          mobile: id,
          status: 'ACTIVE',
        },
      });
      const wallet = new WalletService(db as never);
      const providerResults: Array<{
        orderId: string;
        providerPaymentId: string;
        status: string;
        rawStatus: string;
        amount: string;
        currency: string;
      }> = [];
      const provider = {
        createCheckoutOrder: vi.fn(
          async ({ orderId }: { orderId: string }) => ({
            orderId,
            paymentSessionId: 'test-session',
            rawStatus: 'ACTIVE',
          }),
        ),
        fetchCheckoutPayments: vi.fn(async (orderId: string) =>
          providerResults.filter((result) => result.orderId === orderId),
        ),
        fetchCheckoutOrder: vi.fn(async (orderId: string) => ({
          orderId,
          status: 'ACTIVE',
        })),
      };
      const checkout = new CheckoutCollectionService(
        db as never,
        { getOrThrow: () => 'mock', get: () => undefined } as never,
        provider as never,
        new RiderPaymentsService(db as never),
        {} as never,
        {} as never,
        wallet,
        {} as never,
      );
      const penalties = new SubmissionPenaltyService(db as never);
      async function invoice(
        amount: string,
        type = 'SUBMISSION_PENALTY',
        dueDate = '2026-01-01',
      ) {
        const invoice = await db.riderInvoice.create({
          data: {
            clientId: client.id,
            riderId: rider.id,
            invoiceNumber: randomUUID(),
            invoiceType: type,
            billingPeriodStart: new Date('2026-01-01'),
            billingPeriodEnd: new Date('2026-01-02'),
            dueDate: new Date(dueDate),
            subtotal: amount,
            creditAmount: 0,
            totalAmount: amount,
            outstandingAmount: amount,
            currency: 'INR',
            lines: {
              create: {
                kind: 'CHARGE',
                sourceId: randomUUID(),
                description: 'Test penalty',
                amount,
                currency: 'INR',
                chargeType: 'RETURN_PENALTY',
              },
            },
          },
        });
        if (type === 'SUBMISSION_PENALTY')
          await db.riderCharge.create({
            data: {
              clientId: client.id,
              riderId: rider.id,
              invoiceId: invoice.id,
              sourceKey: randomUUID(),
              chargeType: 'RETURN_PENALTY',
              description: 'Test penalty',
              quantity: 1,
              unitAmount: amount,
              amount,
              currency: 'INR',
              status: 'INVOICED',
            },
          });
        return db.riderInvoice.update({
          where: { id: invoice.id },
          data: { status: 'FINALIZED', finalizedAt: new Date() },
        });
      }
      const older = await invoice('300');
      const newer = await invoice('900', 'SUBMISSION_PENALTY', '2026-01-02');
      const rental = await invoice('100', 'RENTAL', '2025-01-01');
      function success(orderId: string, amount: string) {
        providerResults.push({
          orderId,
          amount,
          providerPaymentId: `test-${randomUUID()}`,
          currency: 'INR',
          status: 'SUCCESS',
          rawStatus: 'SUCCESS',
        });
      }
      return {
        client,
        rider,
        older,
        newer,
        rental,
        invoice,
        checkout,
        wallet,
        penalties,
        provider,
        success,
      };
    }
    it('makes one partial payment across penalties, preserves rent, and posts one receipt/ledger/wallet history entry', async () => {
      const f = await fixture();
      expect(await f.penalties.summary(f.client.id, f.rider.id)).toMatchObject({
        defaultAmount: '1200.00',
        pendingCount: 2,
      });
      const key = randomUUID();
      const request = await f.checkout.payOutstanding(
        f.client.id,
        f.rider.id,
        key,
        { scope: 'SUBMISSION_PENALTY', amount: '500.00' },
      );
      expect(request.amount).toBe('500.00');
      const retry = await f.checkout.payOutstanding(
        f.client.id,
        f.rider.id,
        key,
        { scope: 'SUBMISSION_PENALTY', amount: '500' },
      );
      expect(retry.collectionId).toBe(request.collectionId);
      expect(f.provider.createCheckoutOrder).toHaveBeenCalledTimes(1);
      await expect(
        f.checkout.payOutstanding(f.client.id, f.rider.id, key, {
          scope: 'SUBMISSION_PENALTY',
          amount: '600',
        }),
      ).rejects.toThrow('different payment amount');
      await expect(
        f.checkout.payOutstanding(f.client.id, f.rider.id, randomUUID(), {
          scope: 'SUBMISSION_PENALTY',
          amount: '100',
        }),
      ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
      await expect(
        f.checkout.payInvoice(
          f.client.id,
          f.rider.id,
          f.older.id,
          randomUUID(),
          false,
          'SYSTEM',
        ),
      ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
      const later = await f.invoice('50', 'SUBMISSION_PENALTY', '2025-01-01');
      f.success(request.orderId!, '500.00');
      await Promise.all([
        f.checkout.verify(f.client.id, f.rider.id, request.collectionId),
        f.checkout.verify(f.client.id, f.rider.id, request.collectionId),
      ]);
      expect(
        await db.riderInvoice.findUnique({ where: { id: f.older.id } }),
      ).toMatchObject({ status: 'PAID', outstandingAmount: D('0') });
      expect(
        await db.riderInvoice.findUnique({ where: { id: f.newer.id } }),
      ).toMatchObject({
        status: 'PARTIALLY_PAID',
        outstandingAmount: D('700'),
      });
      expect(
        await db.riderInvoice.findUnique({ where: { id: f.rental.id } }),
      ).toMatchObject({ outstandingAmount: D('100') });
      expect(
        await db.riderInvoice.findUnique({ where: { id: later.id } }),
      ).toMatchObject({ outstandingAmount: D('50') });
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        await db.riderLedgerEntry.count({
          where: { clientId: f.client.id, entryType: 'PAYMENT' },
        }),
      ).toBe(1);
      expect(
        await db.walletTransaction.count({
          where: { clientId: f.client.id, transactionType: 'PAYMENT' },
        }),
      ).toBe(1);
      const w = await f.wallet.ensure(f.client.id, f.rider.id);
      expect(await f.wallet.balance(f.client.id, w.id)).toMatchObject({
        availableBalance: '0.00',
      });
      expect(await f.penalties.summary(f.client.id, f.rider.id)).toMatchObject({
        defaultAmount: '750.00',
        payNowAvailable: true,
      });
      await expect(
        db.$transaction((tx) =>
          requirePenaltyClearance(tx, f.client.id, f.rider.id, randomUUID()),
        ),
      ).rejects.toThrow();
    }, 30000);
    it('pays the full penalty balance when no amount is supplied and preserves old ALL callers', async () => {
      const f = await fixture();
      const request = await f.checkout.payOutstanding(
        f.client.id,
        f.rider.id,
        randomUUID(),
        { scope: 'SUBMISSION_PENALTY' },
      );
      f.success(request.orderId!, request.amount);
      await f.checkout.verify(f.client.id, f.rider.id, request.collectionId);
      expect(await f.penalties.summary(f.client.id, f.rider.id)).toMatchObject({
        defaultAmount: '0.00',
        pendingCount: 0,
        payNowAvailable: false,
      });
      await db.$transaction((tx) =>
        requirePenaltyClearance(tx, f.client.id, f.rider.id, randomUUID()),
      );
      const old = await f.checkout.payOutstanding(
        f.client.id,
        f.rider.id,
        randomUUID(),
      );
      expect(old.amount).toBe('100.00');
    }, 30000);
    it('rejects overpayment and keeps late success surplus unallocated rather than paying new charges', async () => {
      const f = await fixture();
      await expect(
        f.checkout.payOutstanding(f.client.id, f.rider.id, randomUUID(), {
          scope: 'SUBMISSION_PENALTY',
          amount: '1200.01',
        }),
      ).rejects.toThrow('cannot exceed');
      const request = await f.checkout.payOutstanding(
        f.client.id,
        f.rider.id,
        randomUUID(),
        { scope: 'SUBMISSION_PENALTY', amount: '500' },
      );
      await db.riderInvoice.update({
        where: { id: f.older.id },
        data: { outstandingAmount: 0, paidAmount: 300, status: 'PAID' },
      });
      f.success(request.orderId!, request.amount);
      expect(
        await f.checkout.verify(f.client.id, f.rider.id, request.collectionId),
      ).toMatchObject({ failureCode: 'UNAPPLIED_PROVIDER_PAYMENT_REVIEW' });
      expect(
        await db.riderInvoice.findUnique({ where: { id: f.newer.id } }),
      ).toMatchObject({ outstandingAmount: D('700') });
      expect(
        await db.riderPayment.findFirst({ where: { clientId: f.client.id } }),
      ).toMatchObject({ unallocatedAmount: D('300') });
      const ledger = await db.walletLedgerEntry.findMany({
        where: { clientId: f.client.id },
      });
      expect(ledger).toHaveLength(2);
      expect(ledger.map((entry) => entry.amount.toFixed(2))).toEqual([
        '500.00',
        '500.00',
      ]);
    }, 30000);
  },
);
