import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../config/environment.js';

describe('payment provider environment', () => {
  it('keeps payment processing disabled by default', () => {
    expect(validateEnvironment({}).PAYMENT_PROVIDER).toBe('disabled');
  });
  it('requires credentials and callback URLs when Cashfree is selected', () => {
    expect(() => validateEnvironment({ PAYMENT_PROVIDER: 'cashfree' })).toThrow(
      'Cashfree configuration is missing',
    );
    expect(
      validateEnvironment({
        PAYMENT_PROVIDER: 'cashfree',
        CASHFREE_CLIENT_ID: 'id',
        CASHFREE_CLIENT_SECRET: 'secret',
        CASHFREE_WEBHOOK_SECRET: 'webhook-secret',
        CASHFREE_SUBSCRIPTION_RETURN_URL: 'http://localhost:3001/return',
        CASHFREE_WEBHOOK_URL: 'http://localhost:3000/webhook',
      }).CASHFREE_API_VERSION,
    ).toBe('2026-01-01');
  });
  it('blocks the mock provider in production', () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' }),
    ).toThrow();
  });
});
