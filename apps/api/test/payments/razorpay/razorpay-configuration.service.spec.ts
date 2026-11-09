import { describe, expect, it, vi } from 'vitest';
import { RazorpayConfigurationService } from '../../../src/payments/razorpay/razorpay-configuration.service.js';

function service(rows: unknown[], settings: Record<string, string> = {}) {
  const db = {
    clientPaymentProvider: { findFirst: vi.fn().mockResolvedValue(rows[0] ?? null) },
  };
  const config = {
    get: (key: string) => settings[key],
  };
  return { subject: new RazorpayConfigurationService(db as never, config as never), db };
}

describe('RazorpayConfigurationService', () => {
  it('resolves active client credentials from an environment secret reference', async () => {
    const { subject } = service([{
      keyId: 'rzp_client',
      secretReference: 'env:CLIENT_RAZORPAY',
      merchantAccountId: 'merchant-1',
      environment: 'PRODUCTION',
    }], {
      CLIENT_RAZORPAY: JSON.stringify({ keySecret: 'client-secret', webhookSecret: 'client-hook' }),
    });
    await expect(subject.resolve('client-1')).resolves.toEqual({
      keyId: 'rzp_client',
      keySecret: 'client-secret',
      webhookSecret: 'client-hook',
      merchantAccountId: 'merchant-1',
      environment: 'PRODUCTION',
    });
  });

  it('falls back to the legacy workspace credentials only for the allowlisted client', async () => {
    const { subject } = service([], {
      RAZORPAY_CLIENT_IDS: 'client-1,client-2',
      RAZORPAY_KEY_ID: 'rzp_legacy',
      RAZORPAY_KEY_SECRET: 'legacy-secret',
      RAZORPAY_WEBHOOK_SECRET: 'legacy-hook',
    });
    await expect(subject.resolve('client-1')).resolves.toMatchObject({ keyId: 'rzp_legacy', environment: 'LEGACY' });
    await expect(subject.resolve('client-3')).rejects.toMatchObject({ response: { code: 'RAZORPAY_UNAVAILABLE' } });
  });

  it('rejects a configured provider whose secret reference is missing or malformed', async () => {
    const { subject } = service([{ keyId: 'rzp_client', secretReference: 'env:MISSING', environment: 'TEST' }], {
      RAZORPAY_CLIENT_IDS: '',
    });
    await expect(subject.resolve('client-1')).rejects.toMatchObject({ response: { code: 'RAZORPAY_UNAVAILABLE' } });
  });

  it('passes the requested environment into provider selection', async () => {
    const { subject, db } = service([{
      keyId: 'rzp_live_client',
      secretReference: 'env:CLIENT_RAZORPAY',
      environment: 'PRODUCTION',
    }], {
      CLIENT_RAZORPAY: JSON.stringify({ keySecret: 'secret', webhookSecret: 'hook' }),
    });
    await subject.resolve('client-1', 'PRODUCTION');
    expect(db.clientPaymentProvider.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ environment: 'PRODUCTION' }),
    }));
  });
});
