import { describe, expect, it, vi } from 'vitest';
import { DeploymentPaymentProviderRouter } from '../../src/payments/deployment-payment-provider-router.service.js';

describe('DeploymentPaymentProviderRouter', () => {
  const provider = {
    name: 'RAZORPAY',
    reconcile: vi.fn().mockResolvedValue({}),
    createOrder: vi.fn().mockResolvedValue({ provider: 'RAZORPAY', orderId: 'order_1' }),
    verify: vi.fn().mockResolvedValue({ nextAction: 'PAYMENT_COMPLETE' }),
  };

  it('routes using the active provider configured for the client', async () => {
    const db = {
      clientPaymentProvider: {
        findFirst: vi.fn().mockResolvedValue({ provider: 'razorpay' }),
      },
    };
    const router = new DeploymentPaymentProviderRouter(db as never, { getOrThrow: () => 'TEST' } as never, provider);

    await expect(router.createOrder('client-1', 'user-1', 'allocation-1')).resolves.toEqual({
      provider: 'RAZORPAY',
      orderId: 'order_1',
    });
    expect(provider.createOrder).toHaveBeenCalledWith('client-1', 'user-1', 'allocation-1');
  });

  it('fails explicitly when the configured provider has no adapter', async () => {
    const db = {
      clientPaymentProvider: {
        findFirst: vi.fn().mockResolvedValue({ provider: 'ADYEN' }),
      },
    };
    const router = new DeploymentPaymentProviderRouter(db as never, { getOrThrow: () => 'TEST' } as never, provider);

    await expect(router.createOrder('client-1', 'user-1', 'allocation-1')).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_UNSUPPORTED' },
    });
  });

  it('verifies the saved order provider without consulting the current policy', async () => {
    const db = { deploymentPaymentAttempt: { findFirst: vi.fn().mockResolvedValue({ provider: 'RAZORPAY' }) } };
    const policy = { resolve: vi.fn().mockRejectedValue(new Error('current provider disabled')) };
    const router = new DeploymentPaymentProviderRouter(db as never, {} as never, provider, policy as never);
    const body = { razorpayOrderId: 'order_old' };
    await router.verify('client-1', 'user-1', 'allocation-1', body);
    expect(db.deploymentPaymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-1', providerOrderId: 'order_old' }) }));
    expect(policy.resolve).not.toHaveBeenCalled();
    expect(provider.verify).toHaveBeenCalledWith('client-1', 'user-1', 'allocation-1', body);
  });
  it('recovers by saved provider after the active policy changes', async () => {
    const db = { deploymentPaymentAttempt: { findFirst: vi.fn().mockResolvedValue({ provider: 'RAZORPAY' }) } };
    const policy = { resolve: vi.fn().mockRejectedValue(new Error('disabled')) };
    const router = new DeploymentPaymentProviderRouter(db as never, {} as never, provider, policy as never);
    await router.reconcile('client-1', 'user-1', 'allocation-1', 'attempt-1');
    expect(provider.reconcile).toHaveBeenCalledWith('client-1', 'user-1', 'allocation-1', 'attempt-1');
    expect(policy.resolve).not.toHaveBeenCalled();
    db.deploymentPaymentAttempt.findFirst.mockResolvedValue(null);
    provider.reconcile.mockClear();
    await expect(router.reconcile('other-client', 'user-1', 'allocation-1', 'attempt-1')).rejects.toThrow('unavailable');
    expect(provider.reconcile).not.toHaveBeenCalled();
  });
});
