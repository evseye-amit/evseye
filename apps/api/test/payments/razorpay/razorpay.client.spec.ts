import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RazorpayClient, verifyRazorpaySignature, razorpayPaymentMethod } from '../../../src/payments/razorpay/razorpay.client.js';
import { toPaise } from '../../../src/payments/razorpay/razorpay-deployment.service.js';
function configFixture(overrides: Record<string, string> = {}) {
  const settings: Record<string, string> = {
    RAZORPAY_ENABLED: 'true',
    RAZORPAY_CLIENT_IDS: 'client',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: 'api-secret',
    RAZORPAY_WEBHOOK_SECRET: 'hook-secret',
    ...overrides,
  };
  return {
    get: (key: string) => settings[key],
    getOrThrow: (key: string) => settings[key],
  } as never;
}
function fixture(overrides: Record<string, string> = {}) {
  return new RazorpayClient(configFixture(overrides));
}
afterEach(() => vi.unstubAllGlobals());
describe('Razorpay authentication and provider requests', () => {
  it('uses the stored order in checkout signature verification and a separate secret for webhooks', async () => {
    const client = fixture();
    const sign = (body: string, key: string) =>
      createHmac('sha256', key).update(body).digest('hex');
    await client.verifyCheckout(
      'order_1',
      'pay_1',
      sign('order_1|pay_1', 'api-secret'),
    );
    await expect(
      client.verifyCheckout(
        'order_2',
        'pay_1',
        sign('order_1|pay_1', 'api-secret'),
      ),
    ).rejects.toThrow('signature');
    await client.verifyWebhook(
      Buffer.from('{ "event": 1 }'),
      sign('{ "event": 1 }', 'hook-secret'),
    );
    await expect(
      client.verifyWebhook(
        Buffer.from('{"event":1}'),
        sign('{ "event": 1 }', 'hook-secret'),
      ),
    ).rejects.toThrow('signature');
    await expect(
      client.verifyWebhook(Buffer.from('body'), sign('body', 'api-secret')),
    ).rejects.toThrow('signature');
  });
  it('verifies checkout with the client-specific Razorpay secret', async () => {
    const resolve = vi.fn().mockResolvedValue({
      keyId: 'rzp_test_client',
      keySecret: 'client-secret',
      webhookSecret: 'client-webhook-secret',
    });
    const client = new RazorpayClient(configFixture(), { resolve, webhookVersions: vi.fn().mockResolvedValue([]) } as never);
    const signature = createHmac('sha256', 'client-secret')
      .update('order_1|pay_1')
      .digest('hex');

    await expect(
      client.verifyCheckout('order_1', 'pay_1', signature, 'client'),
    ).resolves.toBeUndefined();
    expect(resolve).toHaveBeenCalledWith('client');
    await expect(
      client.verifyCheckout(
        'order_1',
        'pay_1',
        createHmac('sha256', 'api-secret')
          .update('order_1|pay_1')
          .digest('hex'),
        'client',
      ),
    ).rejects.toThrow('Invalid Razorpay signature');
  });
  it('verifies webhooks with the client-specific webhook secret', async () => {
    const resolve = vi.fn().mockResolvedValue({
      keyId: 'rzp_test_client',
      keySecret: 'client-secret',
      webhookSecret: 'client-webhook-secret',
    });
    const client = new RazorpayClient(configFixture(), { resolve, webhookVersions: vi.fn().mockResolvedValue([]) } as never);
    const body = Buffer.from('{"event":"payment.captured"}');
    const signature = createHmac('sha256', 'client-webhook-secret')
      .update(body)
      .digest('hex');

    await expect(client.verifyWebhook(body, signature, 'client')).resolves
      .toBeNull();
    expect(resolve).toHaveBeenCalledWith('client');
  });
  it.each(['', 'a', 'z'.repeat(64), 'a'.repeat(66)])(
    'rejects malformed signature %s without comparison errors',
    (signature) => {
      expect(() =>
        verifyRazorpaySignature('body', signature, 'secret'),
      ).toThrow('Invalid Razorpay signature');
    },
  );
  it('is disabled by default and enforces merchant/client binding', async () => {
    await expect(fixture({ RAZORPAY_ENABLED: 'false' }).assertConfigured('client')).rejects.toThrow('unavailable');
    await expect(fixture().assertConfigured('foreign')).rejects.toThrow('unavailable');
    await expect(fixture().assertConfigured('client', 'rzp_live_other')).rejects.toThrow('unavailable');
    await expect(fixture().assertConfigured('client', 'rzp_test_fixture')).resolves.toBeUndefined();
  });
  it('rejects a saved key from another merchant even with client configuration enabled', async () => {
    const client = new RazorpayClient(configFixture(), {
      resolve: vi.fn().mockResolvedValue({ keyId: 'client-key' }),
    } as never);
    await expect(client.assertConfigured('client', 'global-key')).rejects.toMatchObject({ response: { code: 'RAZORPAY_CONFIGURATION_MISMATCH' } });
    await expect(client.assertConfigured('client', 'client-key')).resolves.toBeUndefined();
  });
  it('sends server amount, unique receipt and no partial payment to the fixed gateway URL', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order_1',
        amount: 300,
        currency: 'INR',
        receipt: 'attempt',
        status: 'created',
      }),
    });
    vi.stubGlobal('fetch', request);
    expect(
      await fixture().createOrder(300, 'INR', 'attempt', {
        clientId: 'client',
      }),
    ).toMatchObject({ id: 'order_1' });
    expect(request).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/orders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          amount: 300,
          currency: 'INR',
          receipt: 'attempt',
          notes: { clientId: 'client' },
          partial_payment: false,
        }),
      }),
    );
  });
  it('does not expose provider credentials or raw provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('api-secret')));
    await expect(fixture().fetchPayment('pay_1')).rejects.toThrow(
      'temporarily unavailable',
    );
  });
  it('rejects unsafe provider IDs before sending network requests', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(fixture().fetchPayment('../orders')).rejects.toThrow(
      'Invalid',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('converts exact decimal amounts to paise and rejects invalid ranges', () => {
    expect(toPaise(new Prisma.Decimal('123.45'))).toBe(12345);
    for (const amount of ['0', '-1', '0.50', '1.001', '9007199254740992'])
      expect(() => toPaise(new Prisma.Decimal(amount))).toThrow();
  });
});

describe('Client-specific outbound credentials', () => {
  it.each(['a', 'b'])('uses merchant %s credentials on provider requests', async (clientId) => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'order_test', amount: 100, currency: 'INR', receipt: 'receipt', status: 'created' }) });
    vi.stubGlobal('fetch', request);
    const client = new RazorpayClient(configFixture(), { resolve: vi.fn(async (id: string) => ({ keyId: `key-${id}`, keySecret: `secret-${id}`, webhookSecret: `hook-${id}` })) } as never);
    await client.createOrder(100, 'INR', 'receipt', {}, clientId);
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from(`key-${clientId}:secret-${clientId}`).toString('base64')}` }) }));
  });
});

describe('normal refund request idempotency', () => {
  it('sends the stable receipt as X-Refund-Idempotency using saved credentials', async () => {
    const client = fixture();
    vi.spyOn(client, 'configurationFor').mockResolvedValue({ keyId: 'rzp_test_saved', keySecret: 'saved-secret', webhookSecret: 'saved-hook', environment: 'TEST', configurationVersionId: 'v1' });
    const remote = { id: 'rfnd_test', payment_id: 'pay_test', amount: 500, status: 'pending', receipt: 'refund-key-123' };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => remote }); vi.stubGlobal('fetch', fetcher);
    await client.createPaymentRefund('pay_test', 500, 'refund-key-123', 'client', 'v1');
    expect(fetcher).toHaveBeenCalledWith('https://api.razorpay.com/v1/payments/pay_test/refund', expect.objectContaining({ headers: expect.objectContaining({ 'X-Refund-Idempotency': 'refund-key-123' }), body: JSON.stringify({ amount: 500, receipt: 'refund-key-123', speed: 'normal' }) }));
    expect(client.configurationFor).toHaveBeenCalledWith('client', 'v1');
  });
});


describe('verified payment method evidence', () => {
  it.each([['upi', 'UPI'], ['card', 'CARD'], ['netbanking', 'NETBANKING'],
    ['wallet', 'WALLET'], ['future_method', 'UNKNOWN'], [null, 'UNKNOWN'], [undefined, 'UNKNOWN']])(
    'maps %s without assuming UPI', (method, expected) => {
      expect(razorpayPaymentMethod({ method })).toBe(expected);
    },
  );
  it('retains the fetched method without returning payer details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: 'pay_1', order_id: 'order_1', amount: 50000, currency: 'INR',
      status: 'captured', captured: true, method: 'upi', vpa: 'private@example',
      card: { number: 'private' },
    }) }));
    const payment = await fixture().fetchPayment('pay_1');
    expect(payment.method).toBe('upi');
    expect(payment).not.toHaveProperty('vpa');
    expect(payment).not.toHaveProperty('card');
  });
});
