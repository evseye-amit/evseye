import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayClient } from '../../../src/payments/razorpay/razorpay.client.js';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const old = { configurationVersionId: 'v1', keyId: 'rzp_old', keySecret: 'old-secret', webhookSecret: 'old-hook', environment: 'TEST' };
  const current = { ...old, configurationVersionId: 'v2', keyId: 'rzp_new', keySecret: 'new-secret', webhookSecret: 'new-hook' };
  const configuration = {
    resolve: vi.fn(async () => current),
    resolveVersion: vi.fn(async (client: string, version: string) => {
      if (client !== 'tenant-a' || !['v1', 'v2'].includes(version)) throw new Error('merchant mismatch');
      return version === 'v1' ? old : current;
    }),
    webhookVersions: vi.fn(async () => ['v2', 'v1']),
  };
  return { client: new RazorpayClient({} as never, configuration as never), configuration, old, current };
}
describe('Originating merchant configuration', () => {
  it('uses the saved key and secret after rotation for recovery and refunds', async () => {
    const { client, configuration } = fixture();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'rfnd_1', payment_id: 'pay_1', amount: 100, status: 'processed' }) });
    vi.stubGlobal('fetch', fetch);
    await client.assertConfigured('tenant-a', 'rzp_old', 'v1');
    await client.refund('pay_1', 100, 'receipt', 'tenant-a', 'v1');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Basic ${Buffer.from('rzp_old:old-secret').toString('base64')}`);
    expect(configuration.resolve).not.toHaveBeenCalled();
  });
  it('verifies an old checkout callback with its saved secret', async () => {
    const { client } = fixture();
    const signature = createHmac('sha256', 'old-secret').update('order_1|pay_1').digest('hex');
    await expect(client.verifyCheckout('order_1', 'pay_1', signature, 'tenant-a', 'v1')).resolves.toBeUndefined();
    await expect(client.verifyCheckout('order_1', 'pay_1', signature, 'tenant-a', 'v2')).rejects.toThrow('signature');
  });
  it('identifies the historical webhook secret and retains its version', async () => {
    const { client } = fixture();
    const body = Buffer.from('event');
    const signature = createHmac('sha256', 'old-hook').update(body).digest('hex');
    await expect(client.verifyWebhook(body, signature, 'tenant-a')).resolves.toBe('v1');
  });
  it('does not fall back to current credentials for a foreign or missing saved version', async () => {
    const { client, configuration } = fixture();
    await expect(client.fetchPayment('pay_1', 'tenant-b', 'v1')).rejects.toThrow('merchant mismatch');
    await expect(client.fetchPayment('pay_1', 'tenant-a', 'missing')).rejects.toThrow('merchant mismatch');
    expect(configuration.resolve).not.toHaveBeenCalled();
  });
});
