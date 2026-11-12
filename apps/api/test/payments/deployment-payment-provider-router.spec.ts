import { describe, expect, it, vi } from 'vitest';
import { DeploymentPaymentProviderRouter } from '../../src/payments/deployment-payment-provider-router.service.js';

describe('DeploymentPaymentProviderRouter', () => {
  const provider = {
    name: 'RAZORPAY',
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
});
