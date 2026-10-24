import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayRecurringClient } from './razorpay-recurring.client.js';
import { AutoPayProviderRouter } from '../autopay-provider-router.service.js';
import { RazorpayAutoPayWorker } from './razorpay-autopay.worker.js';
import { RazorpayEventRouter } from './razorpay-event-router.service.js';
const values: Record<string, string> = {
  RAZORPAY_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_example',
  RAZORPAY_KEY_SECRET: 'fake-secret',
  RAZORPAY_WEBHOOK_SECRET: 'fake-hook',
  RAZORPAY_CLIENT_IDS: 'client-1',
  PAYMENT_PROVIDER: 'mock',
  AUTOPAY_PROVIDER: 'razorpay',
};
const config = {
  get: (key: string) => values[key],
  getOrThrow: (key: string) => values[key],
};
afterEach(() => vi.unstubAllGlobals());
describe('Razorpay recurring HTTP contract and routing', () => {
  it('creates a hosted UPI registration with the current auth-links endpoint', async () => {
    const fetch = vi.fn(async (_url: string, _options: unknown) => ({
      ok: true,
      json: async () => ({
        id: 'inv_test',
        receipt: 'local-1',
        customer_id: 'cust_test',
        order_id: 'order_test',
        payment_id: null,
        status: 'issued',
        amount: 100,
        currency: 'INR',
        short_url: 'https://rzp.io/test',
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const client = new RazorpayRecurringClient(config as never);
    await client.createRegistration({
      receipt: 'local-1',
      subscription_registration: { method: 'upi', frequency: 'as_presented' },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.razorpay.com/v1/subscription_registration/auth_links',
    );
  });
  it('recovers registrations by receipt without parsing unrelated merchant invoices as mandates', async () => {
    const fetch = vi.fn(async (_url: string, _options: unknown) => ({
      ok: true,
      json: async () => ({
        items: [
          { id: 'inv_other', receipt: 'other', notes: [], customer_id: null },
          {
            id: 'inv_test',
            receipt: 'local-1',
            customer_id: 'cust_test',
            order_id: 'order_test',
            payment_id: null,
            status: 'issued',
            amount: 100,
            currency: 'INR',
            short_url: 'https://rzp.io/test',
            notes: [],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const matches = await new RazorpayRecurringClient(
      config as never,
    ).findRegistrations('local-1', new Date());
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('inv_test');
  });
  it('cancels the bank mandate using PUT cancel, never token deletion', async () => {
    const fetch = vi.fn(async (_url: string, _options: unknown) => ({
      ok: true,
      json: async () => ({ status: 'cancellation_initiated' }),
    }));
    vi.stubGlobal('fetch', fetch);
    await new RazorpayRecurringClient(config as never).cancelToken(
      'cust_test',
      'token_test',
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/customers/cust_test/tokens/token_test/cancel',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
  it('sends paise, notification token and earliest debit time to orders; recurring payment uses the same order', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order_test',
          amount: 50000,
          receipt: 'local-1',
          currency: 'INR',
          status: 'created',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ razorpay_payment_id: 'pay_test' }),
      });
    vi.stubGlobal('fetch', fetch);
    const client = new RazorpayRecurringClient(config as never);
    const at = new Date(Date.now() + 48 * 3600000);
    await client.createDebitOrder(50000, 'local-1', 'token_test', at);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      amount: 50000,
      notification: {
        token_id: 'token_test',
        payment_after: Math.ceil(at.getTime() / 1000),
      },
    });
    await client.createRecurringPayment({
      customerId: 'cust_test',
      tokenId: 'token_test',
      orderId: 'order_test',
      amount: 50000,
      email: 'rider@example.com',
      contact: '9876543210',
    });
    expect(fetch.mock.calls[1][0]).toBe(
      'https://api.razorpay.com/v1/payments/create/recurring',
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      recurring: true,
      token: 'token_test',
      order_id: 'order_test',
    });
  });
  it('routes saved Cashfree mandates independently of the newly selected provider', () => {
    const configured = {},
      cashfree = { verifyWebhook: vi.fn() },
      razorpay = {};
    const router = new AutoPayProviderRouter(
      config as never,
      configured as never,
      cashfree as never,
      razorpay as never,
    );
    expect(router.selected()).toBe('RAZORPAY');
    expect(router.selected('ENACH')).toBe('MOCK');
    expect(router.forProvider('CASHFREE')).toBe(cashfree);
    expect(router.forProvider('RAZORPAY')).toBe(razorpay);
    router.verifyCashfreeWebhook(Buffer.from('test'), 'time', 'sig');
    expect(cashfree.verifyWebhook).toHaveBeenCalledOnce();
  });
  it('uses the shared event handler for AutoPay while leaving unrelated checkout events to existing handlers', async () => {
    const db = {
      paymentMandate: { findFirst: vi.fn().mockResolvedValue(null) },
      paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
      paymentProviderEvent: { update: vi.fn() },
    };
    const mandates = { reconcileStored: vi.fn() },
      payments = { verify: vi.fn() },
      gateway = { fetchOrder: vi.fn().mockResolvedValue({ receipt: null }) };
    const router = new RazorpayEventRouter();
    const worker = new RazorpayAutoPayWorker(
      db as never,
      mandates as never,
      payments as never,
      gateway as never,
      router,
    );
    worker.onModuleInit();
    const event = {
      id: 'event-1',
      eventType: 'payment.captured',
      deploymentPayload: { orderId: 'order_test', paymentId: 'pay_test' },
    };
    expect(await router.process(event)).toBe(false);
    db.paymentTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      clientId: 'c-1',
      riderId: 'r-1',
      mandateId: 'm-1',
    } as never);
    expect(await router.process(event)).toBe(true);
    expect(payments.verify).toHaveBeenCalledWith('c-1', 'r-1', 'tx-1');
    db.paymentMandate.findFirst.mockResolvedValue({
      id: 'm-1',
      clientId: 'c-1',
    } as never);
    expect(
      await router.process({
        id: 'event-2',
        eventType: 'token.cancelled',
        recurringPayload: { tokenId: 'token_test' },
        deploymentPayload: null,
      }),
    ).toBe(true);
    expect(mandates.reconcileStored).toHaveBeenCalledWith('m-1');
  });
});
