import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeploymentAutoPayService } from '../../src/payments/deployment-autopay.service.js';
import { DeploymentAutoPayBridge } from '../../src/payments/razorpay/deployment-autopay-bridge.js';
import { deploymentRequestHash } from '../../src/payments/deployment-autopay.input.js';
import { parseOrderInput } from '../../src/payments/common-payment.input.js';
import { RazorpayAutoPayProvider } from '../../src/payments/razorpay/razorpay-autopay.provider.js';

const consent = {
  accepted: true as const,
  version: 'deployment-autopay-v1' as const,
  maxAmount: '15000.00',
  validityDays: 365,
};
const options = {
  setupAutoPay: true,
  email: 'rider@example.com',
  autoPayConsent: consent,
  requestKey: 'request-key-123',
};
function fixture() {
  const capture: any = {
    id: 'capture',
    providerPaymentId: 'pay_first',
    status: 'SETTLED',
  };
  const attempt: any = {
    id: 'attempt',
    clientId: 'client',
    deploymentPaymentId: 'deployment',
    providerOrderId: 'order_first',
    providerKeyReference: 'key',
    configurationVersionId: 'version',
    providerEnvironment: 'TEST',
    autoPayRequested: true,
    autoPayStatus: 'NOT_STARTED',
    autoPayMandateId: null,
    autoPayFailureCode: null,
    autoPayOrderClaimedAt: null,
    autoPayCustomerId: 'cust_first',
    autoPayEmail: options.email,
    autoPayMaxAmount: new Prisma.Decimal(15000),
    autoPayExpiresAt: new Date(Date.now() + 86400000),
    autoPayConsent: { riderId: 'rider', riderName: 'Rider', mobile: '9999999999', ...consent },
    amountPaise: 50000n,
    currency: 'INR',
    captures: [capture],
    payment: {
      status: 'PAID',
      providerReference: 'pay_first',
      workflow: { allocationId: 'allocation' },
    },
  };
  let mandate: any;
  const db: any = {
    $queryRaw: vi.fn(),
    deploymentPaymentAttempt: {
      findUniqueOrThrow: vi.fn(async () => ({ ...attempt })),
      update: vi.fn(async ({ data }) => Object.assign(attempt, data)),
      updateMany: vi.fn(async ({ where, data }) => {
        if (
          where.autoPayOrderClaimedAt === null &&
          attempt.autoPayOrderClaimedAt
        )
          return { count: 0 };
        if (where.autoPayMandateId === null && attempt.autoPayMandateId)
          return { count: 0 };
        if (
          where.OR &&
          attempt.autoPayFailureCode &&
          attempt.autoPayFailureCode !== 'AUTOPAY_RECOVERY_PENDING'
        )
          return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      }),
    },
    deploymentPaymentCapture: {
      findFirst: vi.fn(async () =>
        capture.status === 'SETTLED' ? capture : null,
      ),
      update: vi.fn(async ({ where, data }) =>
        Object.assign(
          attempt.captures.find((c: { id: string }) => c.id === where.id),
          data,
        ),
      ),
    },
    allocation: {
      findFirstOrThrow: vi.fn(async () => ({
        riderId: 'rider',
        status: 'ACTIVE',
      })),
      findFirst: vi.fn(async () => ({ id: 'allocation' })),
    },
    paymentMandate: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => {
        mandate = { id: 'mandate', ...data };
        return mandate;
      }),
      findUniqueOrThrow: vi.fn(async () => mandate),
    },
  };
  db.$transaction = vi.fn((fn) => fn(db));
  const token = {
    id: 'token_first',
    method: 'upi',
    recurring: true,
    max_amount: 1500000,
    recurring_details: { status: 'confirmed' },
  };
  const gateway: any = {
    configurationFor: vi.fn(async () => ({
      keyId: 'key',
      configurationVersionId: 'version',
      environment: 'TEST',
    })),
    recurringPayment: vi.fn(async () => ({
      id: 'pay_first',
      order_id: 'order_first',
      customer_id: 'cust_first',
      method: 'upi',
      currency: 'INR',
      amount: 50000,
      status: 'captured',
      captured: true,
      token_id: token.id,
    })),
    fetchToken: vi.fn(async () => ({
      ...token,
      recurring_details: { ...token.recurring_details },
    })),
    cancelToken: vi.fn(async () => {
      token.recurring_details.status = 'cancelled';
    }),
    createAuthorizationOrder: vi.fn(async () => ({ id: 'order_first' })),
    findOrders: vi.fn(async () => [{ id: 'order_first' }]),
    createCustomer: vi.fn(async () => ({ id: 'cust_first' })),
  };
  const mandates: any = {
    deploymentContext: vi.fn(async () => ({
      rider: { id: 'rider', name: 'Rider', mobile: '9999999999' },
      maxAmount: new Prisma.Decimal(15000),
      validityDays: 365,
    })),
    assertNoOpenMandate: vi.fn(),
    reconcileStored: vi.fn(),
  };
  const config: any = { get: vi.fn(() => 'true') },
    policy: any = { resolve: vi.fn(async () => 'RAZORPAY'), deploymentAutoPay: vi.fn(async () => ({ effectiveEnabled: true })) };
  const bridge = new DeploymentAutoPayBridge();
  const service = new DeploymentAutoPayService(
    db,
    mandates,
    gateway,
    policy,
    config,
    bridge,
  );
  service.onModuleInit();
  return {
    service,
    db,
    attempt,
    capture,
    token,
    gateway,
    mandates,
    config,
    policy,
    bridge,
  };
}

describe('combined deployment AutoPay', () => {
  it('requires explicit versioned consent and accepts legacy deployment input', () => {
    const allocationId = '11111111-1111-4111-8111-111111111111';
    expect(parseOrderInput({ purpose: 'DEPLOYMENT', allocationId })).toEqual({
      purpose: 'DEPLOYMENT',
      allocationId,
    });
    expect(() =>
      parseOrderInput({
        purpose: 'DEPLOYMENT',
        allocationId,
        setupAutoPay: true,
        email: options.email,
      }),
    ).toThrow();
    expect(() =>
      parseOrderInput({ purpose: 'TOP_UP', amount: '500', ...options }),
    ).toThrow();
    expect(
      parseOrderInput({
        purpose: 'DEPLOYMENT',
        allocationId,
        setupAutoPay: true,
        email: options.email,
        autoPayConsent: consent,
      }),
    ).toMatchObject({ setupAutoPay: true });
  });
  it('fingerprints payment mode and consent terms, and requires a key for combined checkout', () => {
    expect(() =>
      deploymentRequestHash('allocation', {
        ...options,
        requestKey: undefined,
      }),
    ).toThrow();
    const hash = deploymentRequestHash('allocation', options);
    expect(deploymentRequestHash('allocation', { ...options })).toBe(hash);
    expect(
      deploymentRequestHash('allocation', { ...options, setupAutoPay: false }),
    ).not.toBe(hash);
    expect(
      deploymentRequestHash('allocation', {
        ...options,
        email: 'different@example.com',
      }),
    ).not.toBe(hash);
    expect(
      deploymentRequestHash('allocation', {
        ...options,
        autoPayConsent: { ...consent, maxAmount: '5000' },
      }),
    ).not.toBe(hash);
  });
  it('checks rollout, merchant, amount and consent before creating a gateway order', async () => {
    const f = fixture(),
      merchant = await f.gateway.configurationFor();
    const prepare = () =>
      f.service.prepare(
        'client',
        'user',
        merchant,
        new Prisma.Decimal(500),
        'INR',
        options,
      );
    expect((await prepare()).maxAmount.toFixed(2)).toBe('15000.00');
    f.config.get.mockReturnValueOnce('false');
    await expect(prepare()).rejects.toThrow('disabled');
    await expect(
      f.service.prepare(
        'client',
        'user',
        { ...merchant, keyId: 'other' },
        new Prisma.Decimal(500),
        'INR',
        options,
      ),
    ).rejects.toThrow('same merchant');
    await expect(
      f.service.prepare(
        'client',
        'user',
        merchant,
        new Prisma.Decimal(16000),
        'INR',
        options,
      ),
    ).rejects.toThrow('limit');
    await expect(
      f.service.prepare(
        'client',
        'user',
        merchant,
        new Prisma.Decimal(500),
        'INR',
        { ...options, autoPayConsent: { ...consent, maxAmount: '5000' } },
      ),
    ).rejects.toThrow('terms changed');
    expect(f.gateway.createAuthorizationOrder).not.toHaveBeenCalled();
  });
  it('rejects new combined checkout when the client policy is disabled', async () => {
    const f = fixture();
    f.policy.deploymentAutoPay.mockResolvedValue({ effectiveEnabled: false, reasonMessage: null });
    await expect(f.service.prepare('client', 'user', await f.gateway.configurationFor(), new Prisma.Decimal(500), 'INR', options)).rejects.toThrow('disabled for this client');
    expect(f.gateway.createAuthorizationOrder).not.toHaveBeenCalled();
    expect(f.mandates.deploymentContext).not.toHaveBeenCalled();
  });
  it('creates one recurring order and recovers a timeout without a second POST', async () => {
    const f = fixture();
    f.attempt.autoPayCustomerId = null;
    f.gateway.createAuthorizationOrder.mockRejectedValueOnce(
      new Error('timeout'),
    );
    await expect(f.service.createOrder(f.attempt)).rejects.toThrow('timeout');
    expect(await f.service.createOrder(f.attempt)).toEqual({
      id: 'order_first',
    });
    expect(f.gateway.createAuthorizationOrder).toHaveBeenCalledTimes(1);
    expect(f.gateway.createAuthorizationOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 50000,
        customer_id: 'cust_first',
        receipt: 'attempt',
        token: expect.objectContaining({
          max_amount: 1500000,
          frequency: 'as_presented',
        }),
      }),
      'client',
      'version',
    );
    expect(f.gateway.createCustomer).toHaveBeenCalledTimes(1);
  });
  it('binds only the accepted capture and reuses the mandate on callback replay', async () => {
    const f = fixture();
    await f.service.recover('attempt', 'pay_first');
    await f.service.recover('attempt', 'pay_first');
    expect(f.db.paymentMandate.create).toHaveBeenCalledTimes(1);
    expect(f.db.paymentMandate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerAuthorizationPaymentId: 'pay_first',
        }),
      }),
    );
    expect(f.attempt.autoPayMandateId).toBe('mandate');
    expect(f.mandates.reconcileStored).toHaveBeenCalledWith('mandate');
  });
  it('keeps missing tokens recoverable without losing payment settlement', async () => {
    const f = fixture();
    f.gateway.recurringPayment.mockResolvedValueOnce({
      ...(await f.gateway.recurringPayment()),
      token_id: null,
    });
    await f.service.recover('attempt');
    expect(f.attempt.autoPayStatus).toBe('UNKNOWN');
    expect(f.attempt.payment.status).toBe('PAID');
    expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
    await f.service.recover('attempt');
    expect(f.attempt.autoPayMandateId).toBe('mandate');
  });
  it.each(['AUTOPAY_MANDATE_EXISTS', 'AUTOPAY_CAPTURE_NOT_ACCEPTED'])(
    'cancels an unbound authorization on %s and retries cancellation safely',
    async (reason) => {
      const f = fixture();
      f.mandates.assertNoOpenMandate.mockRejectedValue(
        new ConflictException({ code: reason }),
      );
      f.gateway.cancelToken.mockRejectedValueOnce(new Error('timeout'));
      await f.service.recover('attempt');
      expect(f.capture.autoPayCleanupStatus).toBe('PENDING');
      expect(f.attempt.autoPayFailureCode).toBe(reason);
      await f.service.recover('attempt');
      expect(f.capture.autoPayCleanupStatus).toBe('DONE');
      expect(f.attempt.autoPayStatus).toBe('FAILED');
      expect(f.attempt.payment.status).toBe('PAID');
      expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
    },
  );
  it('cancels late superseded authorizations instead of enabling AutoPay', async () => {
    const f = fixture();
    f.attempt.autoPayFailureCode = 'AUTOPAY_SUPERSEDED';
    await f.service.recover('attempt');
    expect(f.gateway.cancelToken).toHaveBeenCalled();
    expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
  });
  it('cleans up a duplicate capture token without disabling the accepted mandate', async () => {
    const f = fixture();
    await f.service.recover('attempt', 'pay_first');
    f.attempt.captures.push({
      id: 'duplicate',
      providerPaymentId: 'pay_second',
      status: 'REFUND_PENDING',
    });
    f.gateway.recurringPayment.mockResolvedValue({
      ...(await f.gateway.recurringPayment()),
      id: 'pay_second',
      token_id: 'token_second',
    });
    f.token.id = 'token_second';
    await f.service.recover('attempt', 'pay_second');
    expect(f.gateway.cancelToken).toHaveBeenCalledWith(
      'cust_first',
      'token_second',
      'client',
      'version',
    );
    expect(f.attempt.autoPayMandateId).toBe('mandate');
    expect(f.attempt.autoPayFailureCode).toBeNull();
    expect(f.db.paymentMandate.create).toHaveBeenCalledTimes(1);
  });
  it('does not cancel the accepted token when a duplicate capture shares it', async () => {
    const f = fixture();
    await f.service.recover('attempt', 'pay_first');
    f.attempt.captures.push({
      id: 'duplicate',
      providerPaymentId: 'pay_second',
      status: 'REFUND_PENDING',
    });
    f.gateway.recurringPayment.mockResolvedValue({
      ...(await f.gateway.recurringPayment()),
      id: 'pay_second',
    });
    await f.service.recover('attempt', 'pay_second');
    expect(f.gateway.cancelToken).not.toHaveBeenCalled();
  });
  it('defers duplicate cleanup until the primary authorization is resolved', async () => {
    const f = fixture();
    f.attempt.captures.push({
      id: 'duplicate',
      providerPaymentId: 'pay_second',
      status: 'REFUND_PENDING',
    });
    const primary = await f.gateway.recurringPayment();
    f.gateway.recurringPayment.mockResolvedValueOnce({
      ...primary,
      id: 'pay_second',
    });
    await f.service.recover('attempt', 'pay_second');
    expect(f.gateway.cancelToken).not.toHaveBeenCalled();
    expect(f.attempt.autoPayFailureCode).toBeNull();
    await f.service.recover('attempt', 'pay_first');
    expect(f.attempt.autoPayMandateId).toBe('mandate');
  });
  it('does not attach a mandate to a different rider after allocation reassignment', async () => {
    const f = fixture();
    f.db.allocation.findFirstOrThrow.mockResolvedValue({
      riderId: 'other-rider',
      status: 'ACTIVE',
    });
    await f.service.recover('attempt');
    expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
    expect(f.gateway.cancelToken).toHaveBeenCalled();
  });
  it('rejects customer and token-limit mismatches without activating a mandate', async () => {
    const f = fixture();
    f.token.max_amount = 2000000;
    await f.service.recover('attempt');
    expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
    f.token.max_amount = 1500000;
    f.gateway.recurringPayment.mockResolvedValueOnce({
      ...(await f.gateway.recurringPayment()),
      customer_id: 'cust_other',
    });
    await f.service.recover('attempt');
    expect(f.db.paymentMandate.create).not.toHaveBeenCalled();
  });
  it('recovers checkout mandates without looking up a registration link', async () => {
    const f = fixture();
    const mandate: any = {
      id: 'mandate',
      clientId: 'client',
      provider: 'RAZORPAY',
      providerMandateId: 'EVSEYE_1',
      providerKeyId: 'key',
      configurationVersionId: 'version',
      providerTermsSnapshot: { flow: 'DEPLOYMENT_CHECKOUT' },
      providerAuthorizationPaymentId: 'pay_first',
      providerAuthorizationOrderId: 'order_first',
      providerCustomerId: 'cust_first',
      providerTokenId: 'token_first',
      authorizationAmount: new Prisma.Decimal(500),
      maxAmount: new Prisma.Decimal(15000),
      currency: 'INR',
      expiresAt: f.attempt.autoPayExpiresAt,
    };
    f.db.paymentMandate.findUnique = vi.fn(async () => mandate);
    f.db.paymentMandate.update = vi.fn(async () => mandate);
    f.gateway.assertConfigured = vi.fn();
    f.gateway.fetchRegistration = vi.fn();
    const provider = new RazorpayAutoPayProvider(f.db, f.gateway, f.config);
    expect(await provider.fetchMandate('EVSEYE_1')).toMatchObject({
      status: 'ACTIVE',
    });
    f.token.recurring_details.status = 'initiated';
    expect(await provider.fetchMandate('EVSEYE_1')).toMatchObject({
      status: 'AUTHORIZATION_PENDING',
    });
    f.token.recurring_details.status = 'paused';
    expect(await provider.fetchMandate('EVSEYE_1')).toMatchObject({
      status: 'PAUSED',
    });
    expect(f.gateway.fetchRegistration).not.toHaveBeenCalled();
  });
});
