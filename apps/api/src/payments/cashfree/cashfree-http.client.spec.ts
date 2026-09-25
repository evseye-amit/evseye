import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CashfreeHttpClient,
  CashfreeProviderError,
} from './cashfree-http.client.js';

const config = {
  getOrThrow: (key: string) =>
    ({
      CASHFREE_ENVIRONMENT: 'SANDBOX',
      CASHFREE_CLIENT_ID: 'test-id',
      CASHFREE_CLIENT_SECRET: 'test-secret',
      CASHFREE_API_VERSION: '2025-01-01',
    })[key as 'CASHFREE_CLIENT_ID'],
};
const client = new CashfreeHttpClient(config as never);
afterEach(() => vi.unstubAllGlobals());

describe('CashfreeHttpClient', () => {
  it('uses official sandbox URL, version and idempotency header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscription_id: 'sub-1' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await expect(
      client.request(
        'POST',
        '/subscriptions',
        { subscription_id: 'sub-1' },
        'op-1',
      ),
    ).resolves.toEqual({ subscription_id: 'sub-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sandbox.cashfree.com/pg/subscriptions',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          'x-api-version': '2025-01-01',
          'x-idempotency-key': 'op-1',
        }),
      }),
    );
  });
  it('does not retry POST on timeout or provider error and sanitizes the error', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error('secret transport detail'));
    vi.stubGlobal('fetch', mockFetch);
    await expect(
      client.request('POST', '/subscriptions/pay', {}, 'op-1'),
    ).rejects.toMatchObject({ category: 'NETWORK_ERROR' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(
      client.request('POST', '/subscriptions/pay', {}, 'op-1'),
    ).rejects.toBeInstanceOf(CashfreeProviderError);
  });
  it('requires idempotency for financial mutations', async () => {
    await expect(client.request('POST', '/subscriptions', {})).rejects.toThrow(
      'idempotency',
    );
  });
});
