import { CommonPaymentService } from '../../src/payments/common-payment.service.js';
import { RiderBillingService } from '../../src/rider-billing/rider-billing.service.js';
import { RazorpayDeploymentService } from '../../src/payments/razorpay/razorpay-deployment.service.js';
import { RazorpayPenaltyService } from '../../src/payments/razorpay/razorpay-penalty.service.js';
import { RazorpayProviderError } from '../../src/payments/razorpay/razorpay.client.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CheckoutCollectionService } from '../../src/payments/checkout-collection.service.js';
import { RiderPaymentsService } from '../../src/rider-billing/rider-payments.service.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import { SubmissionPenaltyService } from '../../src/submission-penalties/submission-penalty.service.js';
import { requirePenaltyClearance } from '../../src/submission-penalties/penalty-accounting.js';

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
      const user = await db.user.create({
        data: { clientId: client.id, name: 'Rider', mobile: id, role: 'RIDER' },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          userId: user.id,
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
        user,
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
    function razorpay(f: Awaited<ReturnType<typeof fixture>>) {
      const orders = new Map<string, any>();
      const captures = new Map<string, any>();
      const gateway = {
        keyId: 'rzp_test_penalty',
        enabled: true,
        verifyWebhook: vi.fn(),
        assertConfigured: vi.fn(),
        verifyCheckout: vi.fn(),
        createOrder: vi.fn(
          async (amount: number, currency: string, receipt: string) => {
            const order = {
              id: `order_${randomUUID().replaceAll('-', '')}`,
              amount,
              currency,
              receipt,
              status: 'created',
            };
            orders.set(order.id, order);
            return order;
          },
        ),
        fetchOrder: vi.fn(async (id: string) => orders.get(id)),
        findOrders: vi.fn(async (receipt: string) =>
          [...orders.values()].filter((o) => o.receipt === receipt),
        ),
        fetchPayment: vi.fn(async (id: string) => captures.get(id)),
        orderPayments: vi.fn(async (id: string) =>
          [...captures.values()].filter((p) => p.order_id === id),
        ),
      };
      const penalties = {
        rider: f.penalties.rider.bind(f.penalties),
        summary: f.penalties.summary.bind(f.penalties),
      };
      const service = new RazorpayPenaltyService(
        db as never,
        gateway as never,
        new RiderPaymentsService(db as never),
        f.wallet,
        penalties as never,
      );
      function capture(
        order: { orderId: string | null; amount: number; currency: string },
        extra = {},
      ) {
        const payment = {
          id: `pay_${randomUUID().replaceAll('-', '')}`,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          status: 'captured',
          captured: true,
          amount_refunded: 0,
          ...extra,
        };
        captures.set(payment.id, payment);
        return {
          razorpayOrderId: order.orderId!,
          razorpayPaymentId: payment.id,
          razorpaySignature: 'a'.repeat(64),
        };
      }
      return { service, gateway, capture, captures };
    }
    it('Razorpay reuses an open order, blocks Cashfree, and settles partial payment exactly once without paying later charges', async () => {
      const f = await fixture();
      const r = razorpay(f);
      const order = await r.service.createOrder(f.client.id, f.user.id, {
        amount: '500',
      });
      expect(
        await r.service.createOrder(f.client.id, f.user.id, {
          amount: '500.00',
        }),
      ).toEqual(order);
      expect(r.gateway.createOrder).toHaveBeenCalledTimes(1);
      await expect(
        f.checkout.payOutstanding(f.client.id, f.rider.id, randomUUID(), {
          scope: 'SUBMISSION_PENALTY',
        }),
      ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
      expect(await f.penalties.summary(f.client.id, f.rider.id)).toMatchObject({
        payNowAvailable: false,
        paymentInProgress: { source: 'RAZORPAY', orderId: order.orderId },
      });
      expect((await f.penalties.list(f.client.id, f.rider.id, 1, 100, true)).data.every(row => row.paymentStatus === 'UNPAID')).toBe(true);
      const later = await f.invoice('50', 'SUBMISSION_PENALTY', '2025-01-01');
      const callback = r.capture(order);
      await Promise.all([
        r.service.verify(f.client.id, f.user.id, callback),
        r.service.verify(f.client.id, f.user.id, callback),
      ]);
      const result = await r.service.verify(f.client.id, f.user.id, callback);
      const penaltyList = await f.penalties.list(f.client.id, f.rider.id, 1, 100, true);
      expect(penaltyList.data.find(row => row.invoiceId === f.older.id)).toMatchObject({ paymentStatus: 'PAID', paidAmount: '300.00', outstandingAmount: '0.00' });
      expect(penaltyList.data.find(row => row.invoiceId === f.newer.id)).toMatchObject({ paymentStatus: 'UNPAID', paidAmount: '200.00', outstandingAmount: '700.00' });

      expect(result).toMatchObject({
        defaultAmount: '750.00',
        paymentStatus: 'SUCCESS',
      });
      expect(result).not.toHaveProperty('nextAction');
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: later.id } })
        ).outstandingAmount.toFixed(2),
      ).toBe('50.00');
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({
            where: { id: f.rental.id },
          })
        ).paidAmount.toFixed(2),
      ).toBe('0.00');
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        await db.razorpayPenaltyCapture.count({
          where: {
            order: { collection: { clientId: f.client.id } },
            status: 'SETTLED',
          },
        }),
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
      const duplicate = r.capture(order);
      expect(
        await r.service.verify(f.client.id, f.user.id, duplicate),
      ).toMatchObject({
        paymentStatus: 'SUCCESS',
        nextAction: 'CONTACT_SUPPORT',
      });
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
    });
    it('Razorpay rejects invalid amounts, foreign orders, invalid signatures and mismatched captures', async () => {
      const f = await fixture();
      const r = razorpay(f);
      for (const body of [
        { amount: '0.99' },
        { amount: '1201' },
        { amount: 5 },
        { amount: '1.001' },
        { scope: 'ALL' },
      ])
        await expect(
          r.service.createOrder(f.client.id, f.user.id, body),
        ).rejects.toThrow();
      const order = await r.service.createOrder(f.client.id, f.user.id, {});
      const callback = r.capture(order);
      await expect(
        r.service.verify('foreign-client', f.user.id, callback),
      ).rejects.toThrow('not found');
      r.gateway.verifyCheckout.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });
      await expect(
        r.service.verify(f.client.id, f.user.id, callback),
      ).rejects.toThrow('Invalid signature');
      const wrong = r.capture(order, { amount: order.amount - 1 });
      await expect(
        r.service.verify(f.client.id, f.user.id, wrong),
      ).rejects.toThrow('PROVIDER_PAYMENT_MISMATCH');
      expect((await f.penalties.list(f.client.id, f.rider.id, 1, 100, true)).data.every(row => row.paymentStatus === 'UNPAID')).toBe(true);

      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
    });
    it('Razorpay reconciles app-closed captures and preserves surplus for review when planned charges were paid elsewhere', async () => {
      const f = await fixture();
      const r = razorpay(f);
      const order = await r.service.createOrder(f.client.id, f.user.id, {
        amount: '500',
      });
      r.capture(order);
      await db.riderInvoice.update({
        where: { id: f.older.id },
        data: { paidAmount: 300, outstandingAmount: 0, status: 'PAID' },
      });
      const collection = await db.paymentCollectionRequest.findUniqueOrThrow({
        where: { providerOrderId: order.orderId! },
      });
      await r.service.reconcileCollection(
        f.client.id,
        f.rider.id,
        collection.id,
      );
      const payment = await db.riderPayment.findFirstOrThrow({
        where: { clientId: f.client.id },
      });
      expect(payment.unallocatedAmount.toFixed(2)).toBe('300.00');
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: f.newer.id } })
        ).paidAmount.toFixed(2),
      ).toBe('200.00');
      expect(
        await db.razorpayPenaltyCapture.findFirst({
          where: { providerPaymentId: payment.externalReference! },
        }),
      ).toMatchObject({ status: 'REVIEW_REQUIRED' });
    });
    it('Razorpay keeps authorization pending and recovers an ambiguous create by receipt without a second POST', async () => {
      const f = await fixture();
      const r = razorpay(f);
      const original = r.gateway.createOrder.getMockImplementation()!;
      r.gateway.createOrder.mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new RazorpayProviderError();
      });
      await expect(
        r.service.createOrder(f.client.id, f.user.id, {}),
      ).rejects.toThrow();
      await db.razorpayPenaltyOrder.updateMany({
        where: { collection: { clientId: f.client.id } },
        data: { createdAt: new Date(Date.now() - 60000) },
      });
      const recovered = await r.service.createOrder(f.client.id, f.user.id, {});
      expect(r.gateway.createOrder).toHaveBeenCalledTimes(1);
      const callback = r.capture(recovered, {
        status: 'authorized',
        captured: false,
      });
      expect(
        await r.service.verify(f.client.id, f.user.id, callback),
      ).toMatchObject({
        nextAction: 'AWAITING_GATEWAY_CONFIRMATION',
        payNowAvailable: false,
      });
      r.captures.get(callback.razorpayPaymentId).captured = true;
      r.captures.get(callback.razorpayPaymentId).status = 'captured';
      const collection = await db.paymentCollectionRequest.findUniqueOrThrow({
        where: { providerOrderId: recovered.orderId! },
      });
      await r.service.reconcileCollection(
        f.client.id,
        f.rider.id,
        collection.id,
      );
      expect(
        (await f.penalties.summary(f.client.id, f.rider.id)).defaultAmount,
      ).toBe('0.00');
    });
    it('routes durable Razorpay webhook events to penalty settlement and rejects event ID collisions', async () => {
      const f = await fixture();
      const r = razorpay(f);
      const order = await r.service.createOrder(f.client.id, f.user.id, {
        amount: '100',
      });
      const callback = r.capture(order);
      const worker = new RazorpayDeploymentService(
        db as never,
        r.gateway as never,
        {} as never,
        r.service,
      );
      const eventId = randomUUID();
      const raw = Buffer.from(
        JSON.stringify({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: callback.razorpayPaymentId,
                order_id: order.orderId,
              },
            },
          },
        }),
      );
      await worker.webhook(raw, 'test', eventId);
      await worker.webhook(raw, 'test', eventId);
      const event = await db.paymentProviderEvent.findUniqueOrThrow({
        where: {
          provider_eventKey: { provider: 'RAZORPAY', eventKey: eventId },
        },
      });
      await worker['processEvent'](event);
      await worker['processEvent'](event);
      expect(
        await db.paymentProviderEvent.findUnique({ where: { id: event.id } }),
      ).toMatchObject({ status: 'PROCESSED', clientId: f.client.id });
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      await expect(
        worker.webhook(
          Buffer.from(
            raw.toString().replace('payment.captured', 'payment.failed'),
          ),
          'test',
          eventId,
        ),
      ).rejects.toThrow('different content');
    });
    it('reserves only one Razorpay order for concurrent Pay taps and retries failed attempts using that order', async () => {
      const f = await fixture();
      const r = razorpay(f);
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          r.service.createOrder(f.client.id, f.user.id, { amount: '50' }),
        ),
      );
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );
      expect(r.gateway.createOrder).toHaveBeenCalledTimes(1);
      expect(
        await db.razorpayPenaltyOrder.count({
          where: { collection: { clientId: f.client.id } },
        }),
      ).toBe(1);
      const order = await r.service.createOrder(f.client.id, f.user.id, {
        amount: '50',
      });
      const callback = r.capture(order, { status: 'failed', captured: false });
      expect(
        await r.service.verify(f.client.id, f.user.id, callback),
      ).toMatchObject({ nextAction: 'RETRY_ONLINE_PAYMENT' });
      expect(
        await r.service.createOrder(f.client.id, f.user.id, { amount: '50' }),
      ).toEqual(order);
      expect(r.gateway.createOrder).toHaveBeenCalledTimes(1);
    });
    it('settles partial Razorpay and Cashfree penalty payments through the common API without duplicate accounting', async () => {
      const f = await fixture(); const r = razorpay(f);
      const api = new CommonPaymentService(db as never, new RiderBillingService(db as never), f.checkout, {} as never, r.service);
      const created = await api.create(f.client.id, f.user.id, { purpose: 'SUBMISSION_PENALTY', amount: '500' });
      expect(created).toMatchObject({ purpose: 'SUBMISSION_PENALTY', provider: 'RAZORPAY', status: 'PENDING', amount: '500.00' });
      const callback = r.capture({ orderId: created.providerOrderId!, amount: 50000, currency: 'INR' });
      await expect(api.detail('foreign-client', f.user.id, created.paymentRequestId!)).rejects.toThrow();
      await expect(api.verify(f.client.id, f.user.id, created.paymentRequestId!, { ...callback, purpose: 'DEPLOYMENT' })).rejects.toThrow();
      await Promise.all([api.verify(f.client.id, f.user.id, created.paymentRequestId!, callback), api.verify(f.client.id, f.user.id, created.paymentRequestId!, callback)]);
      expect(await api.detail(f.client.id, f.user.id, created.paymentRequestId!)).toMatchObject({ status: 'SUCCEEDED', checkout: null });
      const cashfree = await api.create(f.client.id, f.user.id, { purpose: 'SUBMISSION_PENALTY', provider: 'CASHFREE', amount: '200' }, randomUUID());
      expect(cashfree).toMatchObject({ provider: 'MOCK', amount: '200.00', checkout: { paymentSessionId: 'test-session' } });
      f.success(cashfree.providerOrderId!, '200');
      expect(await api.verify(f.client.id, f.user.id, cashfree.paymentRequestId!, {})).toMatchObject({ status: 'SUCCEEDED', purpose: 'SUBMISSION_PENALTY' });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(2);
      expect(await db.walletTransaction.count({ where: { clientId: f.client.id, transactionType: 'PAYMENT' } })).toBe(2);
      expect((await f.penalties.summary(f.client.id, f.rider.id)).defaultAmount).toBe('500.00');
      expect(await f.penalties.get(f.client.id, f.rider.id, f.older.id)).toMatchObject({ paymentStatus: 'PAID' });
      expect(await f.penalties.get(f.client.id, f.rider.id, f.newer.id)).toMatchObject({ paymentStatus: 'UNPAID', outstandingAmount: '500.00' });

    });
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
      const paidList = await f.penalties.list(f.client.id, f.rider.id, 1, 100, true);
      expect(paidList.data).toHaveLength(2);
      expect(paidList.data.every(row => row.paymentStatus === 'PAID')).toBe(true);
      expect((await f.penalties.list(f.client.id, f.rider.id, 1, 100)).data).toEqual([]);
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
