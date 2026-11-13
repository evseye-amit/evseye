import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RazorpayConfigurationService } from '../../../src/payments/razorpay/razorpay-configuration.service.js';

function service(rows: unknown[], settings: Record<string, string> = {}) {
  const row = rows[0] as Record<string, unknown> | undefined;
  const secret = JSON.parse(settings[String(row?.secretReference).replace('env:', '')] ?? '{}');
  const version = row ? {
    ...row, id: 'version-1', clientId: 'client-1', provider: 'RAZORPAY',
    credentialFingerprint: createHash('sha256').update(JSON.stringify([row.keyId, secret.keySecret, secret.webhookSecret])).digest('hex'),
  } : null;
  const db = {
    clientPaymentProvider: { findFirst: vi.fn().mockResolvedValue(rows[0] ?? null) },
    paymentProviderConfigurationVersion: {
      findUnique: vi.fn().mockResolvedValue(version),
      findFirst: vi.fn().mockResolvedValue(version),
    },
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
      configurationVersionId: 'version-1',
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

describe('Explicit merchant configuration fails closed', () => {
  it('rejects a missing configuration snapshot', async () => {
    const { subject, db } = service([{ keyId: 'client-key', environment: 'TEST' }]);
    db.paymentProviderConfigurationVersion.findUnique.mockResolvedValue(null);
    await expect(subject.resolve('client-1')).rejects.toMatchObject({ response: { code: 'RAZORPAY_UNAVAILABLE' } });
  });

  it('rejects a snapshot belonging to another merchant account', async () => {
    const { subject, db } = service([{ keyId: 'client-key', environment: 'TEST', merchantAccountId: 'merchant-a' }]);
    const snapshot = await db.paymentProviderConfigurationVersion.findUnique();
    db.paymentProviderConfigurationVersion.findUnique.mockResolvedValue({ ...snapshot!, merchantAccountId: 'merchant-b' });
    await expect(subject.resolve('client-1')).rejects.toMatchObject({ response: { code: 'RAZORPAY_UNAVAILABLE' } });
  });

  it.each([
    { status: 'ACTIVE', secretReference: 'env:MISSING' },
    { status: 'DISABLED', secretReference: 'env:VALID' },
    { status: 'ACTIVE', secretReference: 'env:VALID', validUntil: new Date(0) },
  ])('does not fall back to a global account for %j', async (row) => {
    const { subject } = service([{ keyId: 'client-key', environment: 'TEST', ...row }], {
      RAZORPAY_CLIENT_IDS: 'client', RAZORPAY_KEY_ID: 'global-key',
      RAZORPAY_KEY_SECRET: 'global-secret', RAZORPAY_WEBHOOK_SECRET: 'global-hook',
      VALID: JSON.stringify({ keySecret: 'secret', webhookSecret: 'hook' }),
    });
    await expect(subject.resolve('client')).rejects.toMatchObject({ response: { code: 'RAZORPAY_UNAVAILABLE' } });
  });
});
