import { RazorpayConfigurationService } from '../../../src/payments/razorpay/razorpay-configuration.service.js';
import { validateEnvironment } from '../../../src/config/environment.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { CashfreePaymentProvider } from '../../../src/payments/cashfree/cashfree-payment.provider.js';
import { CashfreeHttpClient } from '../../../src/payments/cashfree/cashfree-http.client.js';
const credentials = (client: string, version = 'v1') => ({
  keyId: client,
  keySecret: `${client}-${version}-secret`,
  webhookSecret: `${client}-${version}-hook`,
  configurationVersionId: `${client}-${version}`,
  environment: 'TEST',
});
afterEach(() => vi.unstubAllGlobals());
describe('optional tenant-bound Cashfree', () => {
  it('accepts deployment settings without any Cashfree credentials when it is unused', () => {
    const env = validateEnvironment({
      NODE_ENV: 'test',
      PAYMENT_PROVIDER: 'disabled',
      AUTOPAY_PROVIDER: 'configured',
    });
    expect(env.CASHFREE_CLIENT_ID).toBeUndefined();
    expect(env.CASHFREE_CLIENT_SECRET).toBeUndefined();
  });
  it('uses the deployment policy environment rather than the legacy Cashfree environment for new merchants', async () => {
    const db = {
      clientPaymentProvider: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const resolver = new RazorpayConfigurationService(
      db as never,
      new ConfigService({
        RAZORPAY_ENVIRONMENT: 'PRODUCTION',
        CASHFREE_ENVIRONMENT: 'SANDBOX',
      }),
    );
    await expect(
      resolver.resolve('client', undefined, 'CASHFREE'),
    ).rejects.toThrow();
    expect(db.clientPaymentProvider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client',
          provider: 'CASHFREE',
          environment: 'PRODUCTION',
        },
      }),
    );
  });
  it('constructs without credentials and does not resolve any merchant at startup', async () => {
    const resolver = {
      resolve: vi.fn().mockRejectedValue(new Error('unconfigured')),
    };
    const config = new ConfigService({});
    const root = new CashfreePaymentProvider(
      new CashfreeHttpClient(config as never),
      config as never,
      resolver as never,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
    await expect(root.forClient('absent')).rejects.toThrow('unconfigured');
    expect(await root.forClient('legacy', null)).toBe(root);
  });
  it('isolates simultaneous HTTP requests and verifies webhook signatures against retained versions', async () => {
    const config = new ConfigService({
      CASHFREE_CLIENT_ID: 'shared',
      CASHFREE_CLIENT_SECRET: 'shared-secret',
      CASHFREE_WEBHOOK_SECRET: 'shared-hook',
      CASHFREE_ENVIRONMENT: 'SANDBOX',
      CASHFREE_API_VERSION: '2025-01-01',
    });
    const resolver = {
      resolve: vi.fn(async (client: string) => credentials(client)),
      resolveVersion: vi.fn(async (client: string, version: string) => {
        if (!version.startsWith(`${client}-`)) throw new Error('wrong tenant');
        return credentials(client, version.split('-')[1]);
      }),
    };
    const root = new CashfreePaymentProvider(
      new CashfreeHttpClient(config as never),
      config as never,
      resolver as never,
    );
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          order_id: body.order_id,
          payment_session_id: 'session',
          order_status: 'ACTIVE',
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await Promise.all([
      root.forClient('a'),
      root.forClient('b'),
    ]);
    await Promise.all(
      [a, b].map((provider, index) =>
        provider.createCheckoutOrder({
          orderId: `order-${index}`,
          amount: '10.00',
          currency: 'INR',
          idempotencyKey: `id-${index}`,
          customer: { id: 'rider', phone: '9999999999' },
        }),
      ),
    );
    expect(
      fetcher.mock.calls.map(
        (call) => (call[1].headers as Record<string, string>)['x-client-id'],
      ),
    ).toEqual(['a', 'b']);
    expect(config.get('CASHFREE_CLIENT_ID')).toBe('shared');
    const old = await root.forClient('a', 'a-v0'),
      raw = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK"}'),
      timestamp = '1234';
    const signature = createHmac('sha256', 'a-v0-secret')
      .update(timestamp)
      .update(raw)
      .digest('base64');
    expect(old.verifyCheckoutWebhook(raw, timestamp, signature)).toHaveProperty(
      'payload',
    );
    expect(() => b.verifyCheckoutWebhook(raw, timestamp, signature)).toThrow();
    await expect(root.forClient('b', 'a-v0')).rejects.toThrow('wrong tenant');
  });
});
