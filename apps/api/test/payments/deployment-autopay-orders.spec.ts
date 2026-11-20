import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RazorpayDeploymentService } from '../../src/payments/razorpay/razorpay-deployment.service.js';
import { DeploymentAutoPayBridge } from '../../src/payments/razorpay/deployment-autopay-bridge.js';
import { deploymentRequestHash } from '../../src/payments/deployment-autopay.input.js';

const options = {
  setupAutoPay: true,
  email: 'r@example.com',
  requestKey: 'checkout-key',
  autoPayConsent: {
    accepted: true as const,
    version: 'deployment-autopay-v1' as const,
    maxAmount: '15000.00',
    validityDays: 365,
  },
};
function fixture() {
  const attempts: any[] = [];
  const allocation = {
    id: 'allocation',
    status: 'INITIATED',
    rider: { userId: 'user' },
    mobileDeployment: {
      status: 'PAYMENT_PENDING',
      payment: {
        id: 'payment',
        status: 'PENDING',
        amount: new Prisma.Decimal(500),
        currency: 'INR',
      },
    },
  };
  const db: any = {
    $queryRaw: vi.fn(),
    allocation: { findFirst: vi.fn(async () => allocation) },
    deploymentPaymentCapture: { findFirst: vi.fn(async () => null) },
    deploymentPaymentAttempt: {
      findFirst: vi.fn(
        async ({ where }) =>
          attempts.find((a) =>
            Object.entries(where).every(([k, v]) => a[k] === v),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }) => {
        const a = {
          id: `attempt${attempts.length}`,
          createdAt: new Date(0),
          providerOrderId: null,
          status: 'CREATING',
          ...data,
        };
        attempts.push(a);
        return a;
      }),
      update: vi.fn(async ({ where, data }) =>
        Object.assign(
          attempts.find((a) => a.id === where.id),
          data,
        ),
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        for (const a of attempts)
          if (Object.entries(where).every(([k, v]) => a[k] === v))
            Object.assign(a, data);
        return { count: 1 };
      }),
    },
  };
  db.$transaction = vi.fn((fn) => fn(db));
  const gateway: any = {
    assertConfigured: vi.fn(),
    configurationFor: vi.fn(async () => ({
      keyId: 'key',
      configurationVersionId: 'version',
      environment: 'TEST',
    })),
    createOrder: vi.fn(async (amount, currency, receipt) => ({
      id: `order_${receipt}`,
      amount,
      currency,
      receipt,
    })),
    findOrders: vi.fn(),
  };
  const bridge = new DeploymentAutoPayBridge();
  const handler: any = {
    prepare: vi.fn(async () => ({
      maxAmount: new Prisma.Decimal(15000),
      expiresAt: new Date(Date.now() + 86400000),
      consent: options.autoPayConsent,
    })),
    createOrder: vi.fn(async (a) => ({
      id: `order_${a.id}`,
      amount: Number(a.amountPaise),
      currency: a.currency,
      receipt: a.id,
    })),
    recover: vi.fn(),
  };
  bridge.register(handler);
  const commercial: any = { assertPaymentQuote: vi.fn() };
  const service = new RazorpayDeploymentService(
    db,
    gateway,
    commercial,
    undefined,
    undefined,
    undefined,
    undefined,
    bridge,
  );
  vi.spyOn(service, 'reconcileOrder').mockResolvedValue(undefined);
  return { db, service, gateway, attempts, handler };
}
describe('deployment order mode safety', () => {
  it('reuses an accepted attempt after new AutoPay checkouts are disabled', async () => {
    const f = fixture();
    await f.service.createOrder('client', 'user', 'allocation', options);
    f.handler.prepare.mockRejectedValue(new Error('Client AutoPay disabled'));
    await f.service.createOrder('client', 'user', 'allocation', options);
    expect(f.handler.prepare).toHaveBeenCalledTimes(1);
    expect(f.handler.createOrder).toHaveBeenCalledTimes(1);
    expect(f.attempts).toHaveLength(1);
  });
  it('uses the ordinary gateway for normal checkout and reuses its open attempt', async () => {
    const f = fixture();
    await f.service.createOrder('client', 'user', 'allocation');
    await f.service.createOrder('client', 'user', 'allocation');
    expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
    expect(f.handler.prepare).not.toHaveBeenCalled();
  });
  it('supersedes a combined open order on an explicit mode switch and retains cleanup intent', async () => {
    const f = fixture();
    await f.service.createOrder('client', 'user', 'allocation', options);
    await f.service.createOrder('client', 'user', 'allocation');
    expect(f.attempts[0]).toMatchObject({
      status: 'SUPERSEDED',
      autoPayFailureCode: 'AUTOPAY_SUPERSEDED',
    });
    expect(f.attempts[1].autoPayRequested).toBe(false);
    expect(f.handler.createOrder).toHaveBeenCalledTimes(1);
    expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
  });
  it('blocks mode changes when a previous create outcome is uncertain', async () => {
    const f = fixture();
    f.attempts.push({
      deploymentPaymentId: 'payment',
      providerOrderId: null,
      status: 'CREATING',
      autoPayRequested: true,
      autoPayRequestKey: options.requestKey,
      autoPayRequestHash: deploymentRequestHash('allocation', options),
    });
    await expect(
      f.service.createOrder('client', 'user', 'allocation'),
    ).rejects.toMatchObject({ response: { code: 'RAZORPAY_ORDER_UNKNOWN' } });
    expect(f.gateway.createOrder).not.toHaveBeenCalled();
    expect(f.handler.createOrder).not.toHaveBeenCalled();
  });
  it('does not create a new attempt when eligibility fails', async () => {
    const f = fixture();
    f.handler.prepare.mockRejectedValue(new Error('Package disabled'));
    await expect(
      f.service.createOrder('client', 'user', 'allocation', options),
    ).rejects.toThrow('Package disabled');
    expect(f.db.deploymentPaymentAttempt.create).not.toHaveBeenCalled();
  });
  it('preserves the unresolved capture guard before combined setup', async () => {
    const f = fixture();
    f.db.deploymentPaymentCapture.findFirst.mockResolvedValue({
      id: 'received',
    });
    await expect(
      f.service.createOrder('client', 'user', 'allocation', options),
    ).rejects.toMatchObject({
      response: { code: 'RAZORPAY_PAYMENT_UNDER_REVIEW' },
    });
    expect(f.handler.prepare).not.toHaveBeenCalled();
  });
});
