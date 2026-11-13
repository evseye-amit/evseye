import { createTestPrisma } from '../../helpers/prisma-client.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { RazorpayInvoiceService } from '../../../src/payments/razorpay/razorpay-invoice.service.js';
import { RazorpayPenaltyService } from '../../../src/payments/razorpay/razorpay-penalty.service.js';
import { RazorpayDeploymentService } from '../../../src/payments/razorpay/razorpay-deployment.service.js';
import {
  RazorpayProviderError,
  verifyRazorpaySignature,
} from '../../../src/payments/razorpay/razorpay.client.js';
import { CommonPaymentService } from '../../../src/payments/common-payment.service.js';
import { PaymentOrchestratorService } from '../../../src/payments/payment-orchestrator.service.js';
import { RiderPaymentsService } from '../../../src/rider-billing/rider-payments.service.js';
import { SubmissionPenaltyService } from '../../../src/submission-penalties/submission-penalty.service.js';
import { WalletService } from '../../../src/wallet/wallet.service.js';
import { WalletBillingService } from '../../../src/wallet/wallet-billing.service.js';
const url = process.env.RENTAL_PAYMENT_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());
describe.skipIf(!url)('Razorpay rental invoices through the common API', () => {
  async function fixture() {
    const client = await db.client.create({
      data: {
        name: 'Rental payment test',
        slug: randomUUID(),
        status: 'ACTIVE',
      },
    });
    const user = await db.user.create({
      data: {
        clientId: client.id,
        name: 'Rider',
        mobile: randomUUID(),
        role: 'RIDER',
      },
    });
    const rider = await db.rider.create({
      data: {
        clientId: client.id,
        userId: user.id,
        name: 'Rider',
        mobile: user.mobile,
        status: 'ACTIVE',
      },
    });
    const wallet = new WalletService(db as never);
    const walletBilling = new WalletBillingService(
      db as never,
      wallet,
      {} as never,
    );
    const payments = new RiderPaymentsService(db as never);
    const orders = new Map<
      string,
      {
        id: string;
        amount: number;
        currency: string;
        receipt: string;
        status: string;
      }
    >();
    const captures = new Map<
      string,
      {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        captured: boolean;
        amount_refunded: number;
      }
    >();
    const secret = 'test-only-signing-secret';
    const gateway = {
      enabled: true,
      keyId: 'rzp_test_rental',
      assertConfigured: vi.fn(),
      verifyCheckout: vi.fn(
        (order: string, payment: string, signature: string) =>
          verifyRazorpaySignature(`${order}|${payment}`, signature, secret),
      ),
      verifyWebhook: vi.fn((body: Buffer, signature: string) =>
        verifyRazorpaySignature(body, signature, secret),
      ),
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
      findOrders: vi.fn(async (receipt: string) =>
        [...orders.values()].filter((o) => o.receipt === receipt),
      ),
      fetchOrder: vi.fn(async (id: string) => orders.get(id)),
      fetchPayment: vi.fn(async (id: string) => captures.get(id)),
      orderPayments: vi.fn(async (id: string) =>
        [...captures.values()].filter((p) => p.order_id === id),
      ),
    };
    const penalties = new RazorpayPenaltyService(
      db as never,
      gateway as never,
      payments,
      wallet,
      new SubmissionPenaltyService(db as never),
    );
    const invoices = new RazorpayInvoiceService(
      db as never,
      gateway as never,
      wallet,
      walletBilling,
      penalties,
    );
    const checkout = { payInvoice: vi.fn(), payOutstanding: vi.fn() };
    const billing = {
      riderForUser: async (c: string, u: string) =>
        (await db.rider.findFirstOrThrow({ where: { clientId: c, userId: u } }))
          .id,
    };
    const common = new CommonPaymentService(
      db as never,
      billing as never,
      checkout as never,
      {} as never,
      penalties,
      invoices,
    );
    let period = 0;
    async function invoice(
      amount = '500',
      type = 'RENTAL',
      status = 'FINALIZED',
      currency = 'INR',
    ) {
      const start = new Date(Date.UTC(2026, 9, 1 + period++ * 2));
      const end = new Date(start.getTime() + 86400000);
      const row = await db.riderInvoice.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          invoiceNumber: randomUUID(),
          invoiceType: type,
          status: 'DRAFT',
          billingPeriodStart: start,
          billingPeriodEnd: end,
          dueDate: new Date('2026-11-01'),
          subtotal: amount,
          creditAmount: 0,
          totalAmount: amount,
          outstandingAmount: amount,
          currency,
          pricingSnapshot: {
            rateCardVersionId: 'accepted-rate-card-version',
            rentalAmount: amount,
          },
          lines: {
            create: {
              kind: 'CHARGE',
              sourceId: randomUUID(),
              description: 'Frozen rental invoice',
              amount,
              currency,
              chargeType: 'RENTAL',
            },
          },
        },
      });
      return db.riderInvoice.update({
        where: { id: row.id },
        data: { status: status as never, issuedAt: new Date() },
      });
    }
    async function create(
      invoiceId: string,
      useWallet = false,
      key = randomUUID(),
    ) {
      return common.create(
        client.id,
        user.id,
        { purpose: 'INVOICE', provider: 'RAZORPAY', invoiceId, useWallet },
        key,
      );
    }
    function capture(
      orderId: string,
      overrides: Partial<{
        amount: number;
        currency: string;
        status: string;
        captured: boolean;
      }> = {},
    ) {
      const order = orders.get(orderId)!;
      const payment = {
        id: `pay_${randomUUID().replaceAll('-', '')}`,
        order_id: orderId,
        amount: order.amount,
        currency: order.currency,
        status: 'captured',
        captured: true,
        amount_refunded: 0,
        ...overrides,
      };
      captures.set(payment.id, payment);
      return {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: createHmac('sha256', secret)
          .update(`${orderId}|${payment.id}`)
          .digest('hex'),
      };
    }
    async function fund(value: string) {
      const amount = new Prisma.Decimal(value).toFixed(2);
      const w = await wallet.ensure(client.id, rider.id);
      const accounts = await db.walletAccount.findMany({
        where: { walletId: w.id },
      });
      await db.$transaction((tx) =>
        wallet.postInTransaction(tx, {
          clientId: client.id,
          walletId: w.id,
          actorId: 'SYSTEM',
          type: 'TOP_UP',
          amount,
          currency: 'INR',
          description: 'Test funds',
          idempotencyKey: randomUUID(),
          entries: [
            {
              accountId: accounts.find((a) => a.accountType === 'CLEARING')!.id,
              entryType: 'DEBIT',
              amount,
            },
            {
              accountId: accounts.find((a) => a.accountType === 'CASH')!.id,
              entryType: 'CREDIT',
              amount,
            },
          ],
        }),
      );
    }
    return {
      client,
      user,
      rider,
      wallet,
      walletBilling,
      payments,
      gateway,
      penalties,
      invoices,
      common,
      checkout,
      orders,
      captures,
      secret,
      invoice,
      create,
      capture,
      fund,
    };
  }
  it('collects frozen rent and settles once across concurrent callbacks, preserving other obligations', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const penalty = await f.invoice('200', 'SUBMISSION_PENALTY');
    const created = await f.create(invoice.id);
    expect(created).toMatchObject({
      purpose: 'INVOICE',
      provider: 'RAZORPAY',
      status: 'PENDING',
      amount: '500.00',
      invoiceId: invoice.id,
    });
    const callback = f.capture(created.providerOrderId!);
    await Promise.all([
      f.common.verify(
        f.client.id,
        f.user.id,
        created.paymentRequestId!,
        callback,
      ),
      f.common.verify(
        f.client.id,
        f.user.id,
        created.paymentRequestId!,
        callback,
      ),
    ]);
    expect(
      (
        await f.common.verify(
          f.client.id,
          f.user.id,
          created.paymentRequestId!,
          callback,
        )
      ).status,
    ).toBe('SUCCEEDED');
    expect(
      (
        await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
      ).outstandingAmount.toFixed(2),
    ).toBe('0.00');
    expect(
      (
        await db.riderInvoice.findUniqueOrThrow({ where: { id: penalty.id } })
      ).outstandingAmount.toFixed(2),
    ).toBe('200.00');
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
    expect(
      (await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } }))
        .pricingSnapshot,
    ).toEqual(invoice.pricingSnapshot);
  });
  it('applies wallet funds once and sends only remaining rent to Razorpay', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await f.fund('200');
    const key = randomUUID();
    const first = await f.create(invoice.id, true, key);
    const retry = await f.create(invoice.id, true, key);
    expect(first.amount).toBe('300.00');
    expect(retry.paymentRequestId).toBe(first.paymentRequestId);
    expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
    expect(
      await db.walletInvoiceAllocation.count({
        where: { clientId: f.client.id, invoiceId: invoice.id },
      }),
    ).toBe(1);
    await f.common.verify(
      f.client.id,
      f.user.id,
      first.paymentRequestId!,
      f.capture(first.providerOrderId!),
    );
    expect(
      (
        await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
      ).paidAmount.toFixed(2),
    ).toBe('500.00');
    await expect(f.create(invoice.id, false, key)).rejects.toThrow(
      'Idempotency-Key',
    );
  });
  it('supports wallet-only payment and repeat requests without creating an external order', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await f.fund('500');
    const key = randomUUID();
    expect(await f.create(invoice.id, true, key)).toMatchObject({
      provider: 'WALLET',
      status: 'SUCCEEDED',
      checkout: null,
      amount: '0.00',
    });
    expect(await f.create(invoice.id, true, key)).toMatchObject({
      provider: 'WALLET',
      status: 'SUCCEEDED',
    });
    expect(f.gateway.createOrder).not.toHaveBeenCalled();
    expect(
      await db.walletInvoiceAllocation.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
  });
  it('rejects paid, draft, non-rental, foreign and non-INR invoices', async () => {
    const f = await fixture();
    const other = await fixture();
    const foreign = await other.invoice();
    await expect(f.create(foreign.id)).rejects.toThrow('INVOICE_NOT_FOUND');
    await expect(
      f.create((await f.invoice('50', 'SUBMISSION_PENALTY')).id),
    ).rejects.toThrow('rental invoices only');
    await expect(
      f.create((await f.invoice('50', 'RENTAL', 'DRAFT')).id),
    ).rejects.toThrow('INVOICE_ALREADY_PAID');
    const usd = await f.invoice('500', 'RENTAL', 'FINALIZED', 'USD');
    await expect(f.create(usd.id)).rejects.toThrow('INR only');
    const paid = await f.invoice();
    await db.riderInvoice.update({
      where: { id: paid.id },
      data: { status: 'PAID', paidAmount: 500, outstandingAmount: 0 },
    });
    await expect(f.create(paid.id)).rejects.toThrow('INVOICE_ALREADY_PAID');
    expect(f.gateway.createOrder).not.toHaveBeenCalled();
  });
  it('reserves one order for concurrent Pay taps and rejects a reused key for another invoice', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const key = randomUUID();
    const results = await Promise.allSettled([
      f.create(invoice.id, false, key),
      f.create(invoice.id, false, key),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
    expect(
      await db.paymentCollectionRequest.count({
        where: { clientId: f.client.id },
      }),
    ).toBe(1);
    await expect(f.create((await f.invoice()).id, false, key)).rejects.toThrow(
      'Idempotency-Key',
    );
    await expect(f.create(invoice.id)).rejects.toThrow(
      'PAYMENT_ALREADY_IN_PROGRESS',
    );
    await expect(
      f.penalties.createOrder(f.client.id, f.user.id, { amount: '100' }),
    ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
  });
  it('blocks invoice checkout before wallet use when an AutoPay debit is already pending', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await f.fund('100');
    const mandate = await db.paymentMandate.create({
      data: {
        clientId: f.client.id,
        riderId: f.rider.id,
        requestKey: randomUUID(),
        providerMandateId: randomUUID(),
        maxAmount: 1000,
        expiresAt: new Date(Date.now() + 864000000),
        status: 'ACTIVE',
      },
    });
    await db.paymentTransaction.create({
      data: {
        clientId: f.client.id,
        riderId: f.rider.id,
        invoiceId: invoice.id,
        mandateId: mandate.id,
        requestKey: randomUUID(),
        providerPaymentId: randomUUID(),
        amount: 500,
        status: 'PENDING',
        scheduledAt: new Date(Date.now() + 86400000),
      },
    });
    await expect(f.create(invoice.id, true)).rejects.toThrow(
      'PAYMENT_ALREADY_IN_PROGRESS',
    );
    expect(
      await db.walletInvoiceAllocation.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(0);
  });
  it('blocks direct wallet settlement once a Razorpay rental checkout has reserved the invoice', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await f.create(invoice.id);
    await f.fund('200');
    await expect(
      f.walletBilling.settle(f.client.id, invoice.id, f.user.id, randomUUID()),
    ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
    expect(
      await db.walletInvoiceAllocation.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(0);
  });
  it('blocks AutoPay collection while the Razorpay invoice order is open', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await f.create(invoice.id);
    const orchestrator = new PaymentOrchestratorService(
      db as never,
      { getOrThrow: () => 'mock' } as never,
      {} as never,
      f.payments,
      f.wallet,
    );
    await expect(
      orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        randomUUID(),
        new Date(Date.now() + 86400000).toISOString(),
      ),
    ).rejects.toThrow('checkout payment is already in progress');
  });
  it('keeps authorization and failed attempts unpaid, and allows retry within the same order', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const order = await f.create(invoice.id);
    const pending = f.capture(order.providerOrderId!, {
      status: 'authorized',
      captured: false,
    });
    expect(
      (
        await f.common.verify(
          f.client.id,
          f.user.id,
          order.paymentRequestId!,
          pending,
        )
      ).status,
    ).toBe('PENDING');
    const p = f.captures.get(pending.razorpayPaymentId)!;
    p.status = 'failed';
    expect(
      await f.common.verify(
        f.client.id,
        f.user.id,
        order.paymentRequestId!,
        pending,
      ),
    ).toMatchObject({ status: 'PENDING', nextAction: 'RETRY_ONLINE_PAYMENT' });
    expect(
      await db.riderPayment.count({ where: { clientId: f.client.id } }),
    ).toBe(0);
    expect(
      (
        await f.common.verify(
          f.client.id,
          f.user.id,
          order.paymentRequestId!,
          f.capture(order.providerOrderId!),
        )
      ).status,
    ).toBe('SUCCEEDED');
  });
  it('rejects tampered callbacks and mismatched captures before crediting money', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const order = await f.create(invoice.id);
    const callback = f.capture(order.providerOrderId!);
    await expect(
      f.common.verify(f.client.id, f.user.id, order.paymentRequestId!, {
        ...callback,
        razorpaySignature: '0'.repeat(64),
      }),
    ).rejects.toThrow('signature');
    await expect(
      f.common.verify(f.client.id, f.user.id, order.paymentRequestId!, {
        ...callback,
        razorpayOrderId: 'order_foreign',
      }),
    ).rejects.toThrow('does not match');
    const wrong = f.capture(order.providerOrderId!, { amount: 100 });
    await expect(
      f.common.verify(f.client.id, f.user.id, order.paymentRequestId!, wrong),
    ).rejects.toThrow('PROVIDER_PAYMENT_MISMATCH');
    expect(
      await db.riderPayment.count({ where: { clientId: f.client.id } }),
    ).toBe(0);
  });
  it('recovers an uncertain order by receipt without another create POST', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const key = randomUUID();
    const original = f.gateway.createOrder.getMockImplementation()!;
    f.gateway.createOrder.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new RazorpayProviderError();
    });
    await expect(f.create(invoice.id, false, key)).rejects.toThrow();
    const local = await db.razorpayPenaltyOrder.findFirstOrThrow({
      where: { collection: { clientId: f.client.id } },
    });
    await db.razorpayPenaltyOrder.update({
      where: { id: local.id },
      data: { createdAt: new Date(Date.now() - 60000) },
    });
    const recovered = await f.create(invoice.id, false, key);
    expect(recovered.providerOrderId).toBe([...f.orders.keys()][0]);
    expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
  });
  it('records surplus from a late capture for review and never pays unrelated invoices', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const unrelated = await f.invoice('200');
    const order = await f.create(invoice.id);
    await db.riderInvoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAmount: 500, outstandingAmount: 0 },
    });
    expect(
      (
        await f.common.verify(
          f.client.id,
          f.user.id,
          order.paymentRequestId!,
          f.capture(order.providerOrderId!),
        )
      ).status,
    ).toBe('REVIEW_REQUIRED');
    const payment = await db.riderPayment.findFirstOrThrow({
      where: { clientId: f.client.id },
    });
    expect(payment.unallocatedAmount.toFixed(2)).toBe('500.00');
    expect(
      (
        await db.riderInvoice.findUniqueOrThrow({ where: { id: unrelated.id } })
      ).outstandingAmount.toFixed(2),
    ).toBe('200.00');
  });
  it('collects only the remaining balance on an already partially paid rental invoice', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    await db.riderInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'PARTIALLY_PAID',
        paidAmount: 200,
        outstandingAmount: 300,
      },
    });
    const order = await f.create(invoice.id);
    expect(order.amount).toBe('300.00');
    await f.common.verify(
      f.client.id,
      f.user.id,
      order.paymentRequestId!,
      f.capture(order.providerOrderId!),
    );
    expect(
      (
        await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
      ).paidAmount.toFixed(2),
    ).toBe('500.00');
  });
  it('records a captured payment against a voided invoice as unallocated review funds', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const order = await f.create(invoice.id);
    await db.riderInvoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID' },
    });
    expect(
      (
        await f.common.verify(
          f.client.id,
          f.user.id,
          order.paymentRequestId!,
          f.capture(order.providerOrderId!),
        )
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      (
        await db.riderPayment.findFirstOrThrow({
          where: { clientId: f.client.id },
        })
      ).unallocatedAmount.toFixed(2),
    ).toBe('500.00');
  });
  it('flags duplicate captures and external refunds without another ledger credit', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const order = await f.create(invoice.id);
    const callback = f.capture(order.providerOrderId!);
    await f.common.verify(
      f.client.id,
      f.user.id,
      order.paymentRequestId!,
      callback,
    );
    await f.common.verify(
      f.client.id,
      f.user.id,
      order.paymentRequestId!,
      f.capture(order.providerOrderId!),
    );
    f.captures.get(callback.razorpayPaymentId)!.amount_refunded = 100;
    await f.common.verify(
      f.client.id,
      f.user.id,
      order.paymentRequestId!,
      callback,
    );
    expect(
      await db.riderPayment.count({ where: { clientId: f.client.id } }),
    ).toBe(1);
    expect(
      (await f.common.detail(f.client.id, f.user.id, order.paymentRequestId!))
        .status,
    ).toBe('REVIEW_REQUIRED');
  });
  it('settles signed durable webhook events after app closure and deduplicates replay', async () => {
    const f = await fixture();
    const invoice = await f.invoice();
    const order = await f.create(invoice.id);
    const callback = f.capture(order.providerOrderId!);
    const dispatcher = new RazorpayDeploymentService(
      db as never,
      f.gateway as never,
      {} as never,
      f.penalties,
    );
    const raw = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: callback.razorpayPaymentId,
              order_id: callback.razorpayOrderId,
            },
          },
        },
      }),
    );
    const signature = createHmac('sha256', f.secret).update(raw).digest('hex');
    const eventId = randomUUID();
    await dispatcher.webhook(raw, signature, eventId);
    await dispatcher.webhook(raw, signature, eventId);
    const event = await db.paymentProviderEvent.findUniqueOrThrow({
      where: { provider_eventKey: { provider: 'RAZORPAY', eventKey: eventId } },
    });
    await dispatcher['processEvent'](event);
    await dispatcher['processEvent'](event);
    expect(
      (await f.common.detail(f.client.id, f.user.id, order.paymentRequestId!))
        .status,
    ).toBe('SUCCEEDED');
    expect(
      await db.riderPayment.count({ where: { clientId: f.client.id } }),
    ).toBe(1);
    await expect(
      dispatcher.webhook(raw, '0'.repeat(64), randomUUID()),
    ).rejects.toThrow('signature');
  });
});
