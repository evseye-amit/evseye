import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RazorpayAutoPayProvider } from '../../../src/payments/razorpay/razorpay-autopay.provider.js';
import { RazorpayRecurringClient } from '../../../src/payments/razorpay/razorpay-recurring.client.js';

function fixture(clientId: string) {
  const mandate: any = {
    id: 'mandate',
    provider: 'RAZORPAY',
    clientId,
    riderId: 'rider',
    providerMandateId: 'mandate-ref',
    providerKeyId: null,
    maxAmount: new Prisma.Decimal(1000),
    expiresAt: new Date(Date.now() + 86400000 * 60),
    autoDebitEnabled: true,
    providerTokenId: 'token_test',
  };
  const transaction: any = {
    id: 'transaction',
    providerPaymentId: 'debit-ref',
    clientId,
    riderId: 'rider',
    mandateId: mandate.id,
    providerKeyId: null,
    amount: new Prisma.Decimal(100),
    currency: 'INR',
    scheduledAt: new Date(Date.now() + 48 * 3600000),
    providerOrderId: null,
    providerOrderClaimedAt: null,
  };
  const db = {
    paymentMandate: {
      findUnique: vi.fn(async () => mandate),
      updateMany: vi.fn(async ({ data }) => {
        Object.assign(mandate, data);
        return { count: 1 };
      }),
    },
    paymentTransaction: {
      findFirst: vi.fn(async () => transaction),
      updateMany: vi.fn(async ({ data }) => {
        Object.assign(transaction, data);
        return { count: 1 };
      }),
    },
    riderPaymentProfile: {
      findUnique: vi.fn().mockResolvedValue({ autoPayEnabled: true }),
    },
  };
  const config = {
    get: (key: string) =>
      key === 'RAZORPAY_AUTOPAY_ENABLED' ? 'true' : 'global-key',
  };
  const gateway = new RazorpayRecurringClient(
    config as never,
    {
      resolve: vi.fn(async () => ({
        keyId: `key-${clientId}`,
        keySecret: 'secret',
        webhookSecret: 'hook',
      })),
    } as never,
  );
  const register = vi
    .spyOn(gateway, 'createRegistration')
    .mockRejectedValue(new Error('transport timeout'));
  const debit = vi
    .spyOn(gateway, 'createDebitOrder')
    .mockRejectedValue(new Error('transport timeout'));
  const subject = new RazorpayAutoPayProvider(
    db as never,
    gateway,
    config as never,
  );
  const input = {
    providerMandateId: 'mandate-ref',
    idempotencyKey: 'request-key',
    customer: {
      name: 'Rider',
      email: 'rider@example.com',
      phone: '9999999999',
    },
    planName: 'Rental',
    mode: 'ON_DEMAND' as const,
    maxAmount: '1000.00',
    expiresAt: mandate.expiresAt.toISOString(),
    paymentMethods: ['UPI_AUTOPAY' as const],
  };
  return { mandate, transaction, db, gateway, register, debit, subject, input };
}

describe('AutoPay merchant credentials', () => {
  it('keeps new debits on the mandate merchant version after credential rotation', async () => {
    const f = fixture('a');
    f.mandate.providerKeyId = 'key-old';
    f.mandate.configurationVersionId = 'version-old';
    vi.spyOn(f.gateway, 'configurationFor').mockImplementation(async (_clientId, version) => ({
      keyId: version === 'version-old' ? 'key-old' : 'key-new',
      keySecret: 'secret', webhookSecret: 'hook', environment: 'TEST',
      configurationVersionId: version ?? 'version-new',
    }));
    vi.spyOn(f.subject, 'fetchMandate').mockResolvedValue({ providerMandateId: 'mandate-ref', status: 'ACTIVE', rawStatus: 'confirmed' });
    await expect(f.subject.createPayment({
      providerMandateId: 'mandate-ref', providerPaymentId: 'debit-ref', idempotencyKey: 'request-key',
      amount: '100.00', scheduledAt: f.transaction.scheduledAt.toISOString(),
    })).rejects.toThrow('transport timeout');
    expect(f.transaction).toMatchObject({ providerKeyId: 'key-old', configurationVersionId: 'version-old' });
    expect(f.debit).toHaveBeenCalledWith(10000, 'transaction', 'token_test', f.transaction.scheduledAt, 'a', 'version-old');
  });
  it.each(['a', 'b'])(
    'persists client %s key for registration and retains it after an uncertain create',
    async (clientId) => {
      const f = fixture(clientId);
      await expect(f.subject.createMandate(f.input)).rejects.toThrow(
        'transport timeout',
      );
      expect(f.mandate.providerKeyId).toBe(`key-${clientId}`);
      expect(f.register).toHaveBeenCalledWith(expect.any(Object), clientId, undefined);
    },
  );
  it.each(['a', 'b'])(
    'persists client %s key for a debit order',
    async (clientId) => {
      const f = fixture(clientId);
      f.mandate.providerKeyId = `key-${clientId}`;
      vi.spyOn(f.subject, 'fetchMandate').mockResolvedValue({
        providerMandateId: 'mandate-ref',
        status: 'ACTIVE',
        rawStatus: 'confirmed',
      });
      await expect(
        f.subject.createPayment({
          providerMandateId: 'mandate-ref',
          providerPaymentId: 'debit-ref',
          idempotencyKey: 'request-key',
          amount: '100.00',
          scheduledAt: f.transaction.scheduledAt.toISOString(),
        }),
      ).rejects.toThrow('transport timeout');
      expect(f.transaction.providerKeyId).toBe(`key-${clientId}`);
      expect(f.debit).toHaveBeenCalledWith(
        10000,
        'transaction',
        'token_test',
        f.transaction.scheduledAt,
        clientId,
        undefined,
      );
    },
  );
  it('rejects stale mandate credentials before registration mutation or a remote call', async () => {
    const f = fixture('a');
    f.mandate.providerKeyId = 'key-b';
    await expect(f.subject.createMandate(f.input)).rejects.toMatchObject({
      response: { code: 'RAZORPAY_CONFIGURATION_MISMATCH' },
    });
    expect(f.db.paymentMandate.updateMany).not.toHaveBeenCalled();
    expect(f.register).not.toHaveBeenCalled();
  });
  it('rejects a debit saved under a different merchant before reconciliation', async () => {
    const f = fixture('a');
    f.mandate.providerKeyId = 'key-a';
    f.transaction.providerKeyId = 'key-b';
    await expect(
      f.subject.fetchPayment('mandate-ref', 'debit-ref'),
    ).rejects.toMatchObject({
      response: { code: 'RAZORPAY_CONFIGURATION_MISMATCH' },
    });
    expect(f.db.paymentTransaction.updateMany).not.toHaveBeenCalled();
    expect(f.debit).not.toHaveBeenCalled();
  });
});
