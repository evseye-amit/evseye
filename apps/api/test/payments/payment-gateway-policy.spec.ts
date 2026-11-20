import { describe, expect, it, vi } from 'vitest';
import { PaymentGatewayPolicyService } from '../../src/payments/payment-gateway-policy.service.js';
import { DeploymentAutoPayPolicyService } from '../../src/payments/deployment-autopay-policy.service.js';

const merchant = { provider: 'RAZORPAY', status: 'ACTIVE', validFrom: new Date(0), validUntil: null };
function fixture(rows: unknown[] = [merchant]) {
  const db = { clientPaymentProvider: { findMany: vi.fn().mockResolvedValue(rows.map((row: any) => ({
    ...row, currentVersion: 1, keyId: 'key', secretReference: 'env:MERCHANT', versions: [{ clientId: 'client', version: 1, provider: 'RAZORPAY', environment: 'TEST', keyId: 'key', secretReference: 'env:MERCHANT', credentialFingerprint: 'fingerprint' }],
  }))) },
    clientDeploymentAutoPayPolicy: { findUnique: vi.fn().mockResolvedValue({ enabled: true, revision: 1 }) },
    clientSubscription: { findFirst: vi.fn().mockResolvedValue({ package: { isActive: true, features: [{ feature: { configuration: { mandateMaxAmount: '750', validityDays: 365, paymentMethods: ['UPI_AUTOPAY'] } } }] } }) },
  };
  const settings: Record<string, string> = { PAYMENT_PROVIDER: 'cashfree', AUTOPAY_PROVIDER: 'cashfree', RAZORPAY_ENVIRONMENT: 'TEST' };
  const config = { get: (key: string) => settings[key] } as never;
  return { db, settings, policy: new PaymentGatewayPolicyService(db as never, config, new DeploymentAutoPayPolicyService(db as never, config)) };
}
describe('Client gateway policy', () => {
  it('disables unconfigured shared Cashfree without blocking configured Razorpay merchants', async () => {
    await expect(fixture([]).policy.resolve('client', 'INVOICE')).rejects.toMatchObject({ response: { code: 'PAYMENT_MERCHANT_UNAVAILABLE' } });
    await expect(fixture().policy.resolve('client', 'INVOICE')).resolves.toBe('RAZORPAY');
  });
  it('advertises only supported policy capabilities, not connectivity', async () => {
    const result = await fixture().policy.capabilities('client-a');
    expect(result).toMatchObject({ contractVersion: 1, availabilityBasis: 'POLICY', connectivityVerified: false });
    expect(result.purposes.INVOICE).toEqual({ enabled: true, provider: 'RAZORPAY', platforms: ['ANDROID', 'IOS'] });
    expect(result.purposes.TOP_UP).toMatchObject({ enabled: true, provider: 'RAZORPAY', platforms: ['ANDROID', 'IOS'] });
    expect(JSON.stringify(result)).not.toMatch(/secret|keyId|configurationVersionId/);
  });
  it('advertises combined checkout only with both providers and all rollout flags', async () => {
    const f = fixture();
    expect((await f.policy.capabilities('client')).purposes.DEPLOYMENT.autoPaySetup).toBe(false);
    Object.assign(f.settings, { RAZORPAY_ENABLED: 'true', RAZORPAY_AUTOPAY_ENABLED: 'true', RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED: 'true' });
    expect((await f.policy.capabilities('client')).purposes.DEPLOYMENT.autoPaySetup).toBe(true);
    f.settings.RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED = 'false';
    expect((await f.policy.capabilities('client')).purposes.DEPLOYMENT.autoPaySetup).toBe(false);
  });
  it('disables every purpose for an unsupported client merchant', async () => {
    const result = await fixture([{ ...merchant, provider: 'UNSUPPORTED' }]).policy.capabilities('client-a');
    expect(Object.values(result.purposes).every(purpose => !purpose.enabled)).toBe(true);
  });
  it('does not disguise database failures as unsupported payment purposes', async () => {
    const { db, policy } = fixture(); db.clientPaymentProvider.findMany.mockRejectedValue(new Error('database offline'));
    await expect(policy.capabilities('client-a')).rejects.toThrow('database offline');
  });
  it.each(['DEPLOYMENT', 'INVOICE', 'SUBMISSION_PENALTY', 'UPI_AUTOPAY', 'TOP_UP', 'OUTSTANDING', 'SECURITY_DEPOSIT'] as const)('uses the client merchant for %s despite global defaults', async purpose => {
    const { policy, db } = fixture();
    await expect(policy.resolve('client-a', purpose)).resolves.toBe('RAZORPAY');
    expect(db.clientPaymentProvider.findMany).toHaveBeenCalledWith({ where: { clientId: 'client-a', environment: 'TEST' } });
  });
  it('rejects a caller-selected gateway outside client policy', async () => {
    await expect(fixture().policy.resolve('client-a', 'INVOICE', 'CASHFREE')).rejects.toMatchObject({ response: { code: 'PAYMENT_PROVIDER_POLICY_MISMATCH' } });
  });
  it.each(['ENACH'] as const)('does not silently route unsupported %s to a shared merchant', async purpose => {
    await expect(fixture().policy.resolve('client-a', purpose)).rejects.toMatchObject({ response: { code: 'PAYMENT_CAPABILITY_UNAVAILABLE' } });
  });
  it.each([
    [{ ...merchant, status: 'DISABLED' }],
    [{ ...merchant, validUntil: new Date(0) }],
    [{ ...merchant, validFrom: new Date('2099-01-01') }],
    [merchant, merchant],
  ])('fails closed for unusable or ambiguous policy', async (...rows) => {
    await expect(fixture(rows).policy.resolve('client-a', 'INVOICE')).rejects.toMatchObject({ response: { code: 'PAYMENT_POLICY_UNAVAILABLE' } });
  });
  it('retains explicit legacy shared-account checkout when there is no client configuration', async () => {
    const { policy, settings } = fixture([]);
    settings.CASHFREE_CLIENT_ID = 'legacy-id'; settings.CASHFREE_CLIENT_SECRET = 'legacy-secret';
    await expect(policy.resolve('legacy', 'TOP_UP')).resolves.toBe('CASHFREE');
  });
  it('selects Cashfree for a configured client merchant', async () => {
    await expect(fixture([{ ...merchant, provider: 'CASHFREE' }]).policy.resolve('client-a', 'INVOICE')).resolves.toBe('CASHFREE');
  });
});
