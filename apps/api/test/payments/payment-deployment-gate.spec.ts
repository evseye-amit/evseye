import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone production .mjs script has no declarations.
import { checkPaymentMerchants } from '../../scripts/payment-deployment-gate.mjs';
const keyId = 'rzp_test_readiness';
const secret = {
  keySecret: 'test-only-secret',
  webhookSecret: 'test-only-webhook',
};
const row = {
  clientId: 'client',
  provider: 'RAZORPAY',
  environment: 'TEST',
  keyId,
  secretReference: 'env:TEST_SECRET',
  status: 'ACTIVE',
  validFrom: new Date(0),
  validUntil: null,
  credentialFingerprint: createHash('sha256')
    .update(JSON.stringify([keyId, secret.keySecret, secret.webhookSecret]))
    .digest('hex'),
};
const env = { TEST_SECRET: JSON.stringify(secret) };
describe('staging payment deployment gate', () => {
  it('checks the sealed merchant with a bounded GET, without a charge', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ items: [] }) });
    expect(await checkPaymentMerchants([row], env, request)).toMatchObject({
      merchantsVerified: 1,
      credentialConnectivityVerified: true,
      livePaymentAcceptanceVerified: false,
    });
    expect(request).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/orders?count=1',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    'empty',
    'duplicate',
    'expired',
    'secret',
    'changed',
    'environment',
  ])('fails closed before a gateway request: %s', async (reason) => {
    const request = vi.fn();
    const rows =
      reason === 'empty'
        ? []
        : reason === 'duplicate'
          ? [row, row]
          : [
              {
                ...row,
                ...(reason === 'expired' ? { validUntil: new Date(0) } : {}),
                ...(reason === 'environment'
                  ? { environment: 'PRODUCTION' }
                  : {}),
              },
            ];
    await expect(
      checkPaymentMerchants(
        rows,
        reason === 'secret'
          ? {}
          : reason === 'changed'
            ? {
                TEST_SECRET: JSON.stringify({
                  ...secret,
                  keySecret: 'changed',
                }),
              }
            : env,
        request,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])(
    'blocks a gateway status %s',
    async (status) => {
      await expect(
        checkPaymentMerchants([row], env, async () => ({
          status,
          json: async () => ({ items: [] }),
        })),
      ).rejects.toThrow('PAYMENT_GATEWAY_AUTH_CHECK_FAILED');
    },
  );
  it('accepts only the explicit Cashfree order-not-found response', async () => {
    const cf = { ...row, provider: 'CASHFREE' };
    const request = vi
      .fn()
      .mockResolvedValue({
        status: 404,
        json: async () => ({ code: 'order_not_found' }),
      });
    expect(await checkPaymentMerchants([cf], env, request)).toMatchObject({
      merchantsVerified: 1,
    });
    expect(
      new URL(request.mock.calls[0][0]).pathname.split('/').at(-1)!.length,
    ).toBeLessThanOrEqual(45);
    expect(request.mock.calls[0][0]).toMatch(
      /^https:\/\/sandbox.cashfree.com\/pg\/orders\/EVS_READY_/,
    );
    await expect(
      checkPaymentMerchants([cf], env, async () => ({
        status: 404,
        json: async () => ({ code: 'authentication_failed' }),
      })),
    ).rejects.toThrow();
  });
  it('requires explicitly intended clients even when no matching merchant row exists', async () => {
    await expect(
      checkPaymentMerchants(
        [row],
        { ...env, PAYMENT_READINESS_CLIENT_IDS: 'missing-client' },
        vi.fn(),
      ),
    ).rejects.toThrow('PAYMENT_POLICY_UNAVAILABLE');
  });
});
