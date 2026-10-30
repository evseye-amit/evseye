import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RazorpayClient, verifyRazorpaySignature } from '../../../src/payments/razorpay/razorpay.client.js';
import { toPaise } from '../../../src/payments/razorpay/razorpay-deployment.service.js';
function fixture(overrides: Record<string, string> = {}) {
  const settings: Record<string, string> = {
    RAZORPAY_ENABLED: 'true',
    RAZORPAY_CLIENT_IDS: 'client',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: 'api-secret',
    RAZORPAY_WEBHOOK_SECRET: 'hook-secret',
    ...overrides,
  };
  return new RazorpayClient({
    get: (key: string) => settings[key],
    getOrThrow: (key: string) => settings[key],
  } as never);
}
afterEach(() => vi.unstubAllGlobals());
describe('Razorpay authentication and provider requests', () => {
  it('uses the stored order in checkout signature verification and a separate secret for webhooks', () => {
    const client = fixture();
    const sign = (body: string, key: string) =>
      createHmac('sha256', key).update(body).digest('hex');
    client.verifyCheckout(
      'order_1',
      'pay_1',
      sign('order_1|pay_1', 'api-secret'),
    );
    expect(() =>
      client.verifyCheckout(
        'order_2',
        'pay_1',
        sign('order_1|pay_1', 'api-secret'),
      ),
    ).toThrow('signature');
    client.verifyWebhook(
      Buffer.from('{ "event": 1 }'),
      sign('{ "event": 1 }', 'hook-secret'),
    );
    expect(() =>
      client.verifyWebhook(
        Buffer.from('{"event":1}'),
        sign('{ "event": 1 }', 'hook-secret'),
      ),
    ).toThrow('signature');
    expect(() =>
      client.verifyWebhook(Buffer.from('body'), sign('body', 'api-secret')),
    ).toThrow('signature');
  });
  it.each(['', 'a', 'z'.repeat(64), 'a'.repeat(66)])(
    'rejects malformed signature %s without comparison errors',
    (signature) => {
      expect(() =>
        verifyRazorpaySignature('body', signature, 'secret'),
      ).toThrow('Invalid Razorpay signature');
    },
  );
  it('is disabled by default and enforces merchant/client binding', () => {
    expect(() =>
      fixture({ RAZORPAY_ENABLED: 'false' }).assertConfigured('client'),
    ).toThrow('unavailable');
    expect(() => fixture().assertConfigured('foreign')).toThrow('unavailable');
    expect(() =>
      fixture().assertConfigured('client', 'rzp_live_other'),
    ).toThrow('unavailable');
    expect(() =>
      fixture().assertConfigured('client', 'rzp_test_fixture'),
    ).not.toThrow();
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
