import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  CommonPaymentService,
  commonPaymentStatus,
} from '../../src/payments/common-payment.service.js';
import {
  parseOrderInput,
  parsePaymentRequestId,
  parseRazorpayCallback,
} from '../../src/payments/common-payment.input.js';
import { CommonPaymentController } from '../../src/payments/common-payment.controller.js';
import { RiderCheckoutController } from '../../src/payments/checkout-collection.controller.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { CheckoutCollectionService } from '../../src/payments/checkout-collection.service.js';
const id = randomUUID();
const callback = {
  razorpayOrderId: 'order_test',
  razorpayPaymentId: 'pay_test',
  razorpaySignature: 'a'.repeat(64),
};
function fixture() {
  const c = {
    id,
    collectionType: 'OUTSTANDING_PAYMENT',
    clientId: 'client',
    riderId: 'rider',
    provider: 'CASHFREE',
    status: 'PENDING',
    amount: new Prisma.Decimal(500),
    currency: 'INR',
    invoiceId: null,
    depositId: null,
    providerOrderId: 'order_test',
    providerPaymentId: null,
    paymentSessionId: 'cashfree_session',
    failureCode: null,
    razorpayPenaltyOrder: {
      keyId: 'rzp_test',
      providerOrderId: 'order_test',
      amountPaise: 50000n,
      captures: [] as {
        status: string;
        reason: string | null;
        providerPaymentId: string;
      }[],
    },
  };
  const order = {
    id,
    clientId: 'client',
    providerOrderId: 'order_test',
    keyId: 'rzp_test',
    amountPaise: 50000n,
    currency: 'INR',
    status: 'OPEN',
    payment: {
      status: 'PENDING',
      workflow: {
        allocationId: id,
        status: 'PAYMENT_PENDING',
        allocation: { status: 'INITIATED' },
      },
    },
    captures: [] as {
      status: string;
      reason: string | null;
      providerPaymentId: string;
    }[],
  };
  const db = {
    paymentCollectionRequest: { findFirst: vi.fn().mockResolvedValue(c) },
    razorpayDeploymentOrder: { findFirst: vi.fn().mockResolvedValue(order) },
  };
  const billing = { riderForUser: vi.fn().mockResolvedValue('rider') };
  const checkout = {
    payInvoice: vi.fn().mockResolvedValue({ collectionId: id }),
    payDeposit: vi.fn().mockResolvedValue({ collectionId: id }),
    payOutstanding: vi.fn().mockResolvedValue({ collectionId: id }),
    verify: vi.fn(),
  };
  const deployments = {
    createOrder: vi.fn().mockResolvedValue({ orderId: 'order_test' }),
    verify: vi.fn().mockResolvedValue({}),
  };
  const penalties = {
    createOrder: vi.fn().mockResolvedValue({ orderId: 'order_test' }),
    verify: vi.fn().mockResolvedValue({}),
  };
  const invoices = { payInvoice: vi.fn().mockResolvedValue({ collectionId: id }) };
  const service = new CommonPaymentService(
    db as never,
    billing as never,
    checkout as never,
    deployments as never,
    penalties as never,
    invoices as never,
  );
  return { c, order, db, billing, checkout, deployments, penalties, invoices, service };
}
describe('common payment purpose contract', () => {
  it.each([
    { purpose: 'DEPLOYMENT', allocationId: id, amount: '1' },
    { purpose: 'DEPLOYMENT' },
    { purpose: 'SUBMISSION_PENALTY', invoiceId: id },
    { purpose: 'INVOICE', invoiceId: id, amount: '1' },
    { purpose: 'INVOICE', invoiceId: id, provider: 'UNSUPPORTED' },
    { purpose: 'SECURITY_DEPOSIT', depositId: id, allocationId: id },
    { purpose: 'OUTSTANDING', amount: 5 },
    { purpose: 'OUTSTANDING', amount: '1.001' },
    { purpose: 'AUTOPAY' },
    { purpose: 'SUBMISSION_PENALTY', clientId: id },
  ])('rejects unsupported purpose fields %j', (body) =>
    expect(() => parseOrderInput(body)).toThrow(),
  );
  it('routes explicit Razorpay rental invoices without changing default and Cashfree routes', async () => {
    const f = fixture();
    f.c.collectionType = 'INVOICE_PAYMENT'; f.c.provider = 'RAZORPAY';
    const body = { purpose: 'INVOICE', provider: 'RAZORPAY', invoiceId: id, useWallet: false };
    expect(parseOrderInput(body)).toEqual(body);
    await f.service.create('client', 'user', body, 'rental-key-1');
    expect(f.invoices.payInvoice).toHaveBeenCalledWith('client', 'rider', id, 'rental-key-1', false, 'user');
    expect(f.checkout.payInvoice).not.toHaveBeenCalled();
    await f.service.create('client', 'user', { purpose: 'INVOICE', invoiceId: id }, 'cashfree-key-1');
    expect(f.checkout.payInvoice).toHaveBeenCalledWith('client', 'rider', id, 'cashfree-key-1', true, 'user');
  });
  it('rejects invalid IDs and caller-supplied verification purpose, amount and status', () => {
    expect(() => parsePaymentRequestId(id)).toThrow();
    expect(() =>
      parseRazorpayCallback({ ...callback, purpose: 'DEPLOYMENT' }),
    ).toThrow();
    expect(() => parseRazorpayCallback({ ...callback, amount: '1' })).toThrow();
    expect(() =>
      parseRazorpayCallback({ ...callback, status: 'SUCCESS' }),
    ).toThrow();
    expect(() =>
      parseRazorpayCallback({ ...callback, razorpaySignature: 'fake' }),
    ).toThrow();
  });
  it.each([
    [
      'INVOICE',
      { invoiceId: id, useWallet: false },
      'payInvoice',
      ['client', 'rider', id, 'request-key', false, 'user'],
    ],
    [
      'SECURITY_DEPOSIT',
      { depositId: id },
      'payDeposit',
      ['client', 'rider', id, 'request-key'],
    ],
    [
      'OUTSTANDING',
      { amount: '500.00' },
      'payOutstanding',
      ['client', 'rider', 'request-key', { scope: 'ALL', amount: '500.00' }],
    ],
  ] as const)(
    'reuses configured checkout for %s',
    async (purpose, fields, method, args) => {
      const f = fixture();
      expect(
        await f.service.create(
          'client',
          'user',
          { purpose, ...fields },
          'request-key',
        ),
      ).toMatchObject({
        provider: 'CASHFREE',
        amount: '500.00',
        status: 'PENDING',
        checkout: { paymentSessionId: 'cashfree_session' },
      });
      expect(f.checkout[method]).toHaveBeenCalledWith(...args);
      expect(f.deployments.createOrder).not.toHaveBeenCalled();
      expect(f.penalties.createOrder).not.toHaveBeenCalled();
    },
  );
  it('retains wallet-only invoice settlement without manufacturing a gateway request', async () => {
    const f = fixture();
    f.checkout.payInvoice.mockResolvedValue({
      collectionId: null,
      amount: '0.00',
      currency: 'INR',
    } as never);
    expect(
      await f.service.create(
        'client',
        'user',
        { purpose: 'INVOICE', invoiceId: id },
        'request-key',
      ),
    ).toMatchObject({
      paymentRequestId: null,
      provider: 'WALLET',
      status: 'SUCCEEDED',
      checkout: null,
    });
    expect(f.checkout.payInvoice).toHaveBeenCalledWith(
      'client',
      'rider',
      id,
      'request-key',
      true,
      'user',
    );
    expect(f.db.paymentCollectionRequest.findFirst).not.toHaveBeenCalled();
  });
  it('creates allocation checkout using only the server-priced deployment handler', async () => {
    const f = fixture();
    expect(
      await f.service.create('client', 'user', {
        purpose: 'DEPLOYMENT',
        allocationId: id,
      }),
    ).toMatchObject({
      paymentRequestId: `deployment:${id}`,
      purpose: 'DEPLOYMENT',
      provider: 'RAZORPAY',
      amount: '500.00',
      checkout: { amountPaise: 50000 },
    });
    expect(f.deployments.createOrder).toHaveBeenCalledWith(
      'client',
      'user',
      id,
    );
    expect(f.checkout.payOutstanding).not.toHaveBeenCalled();
  });
  it('defaults penalties to Razorpay while retaining explicit Cashfree partial penalty checkout', async () => {
    const f = fixture();
    f.c.provider = 'RAZORPAY';
    f.c.collectionType = 'SUBMISSION_PENALTY_PAYMENT';
    expect(
      await f.service.create('client', 'user', {
        purpose: 'SUBMISSION_PENALTY',
        amount: '500',
      }),
    ).toMatchObject({
      purpose: 'SUBMISSION_PENALTY',
      provider: 'RAZORPAY',
      checkout: { amountPaise: 50000 },
    });
    expect(f.penalties.createOrder).toHaveBeenCalledWith('client', 'user', {
      amount: '500',
    });
    f.c.provider = 'CASHFREE';
    await f.service.create(
      'client',
      'user',
      { purpose: 'SUBMISSION_PENALTY', provider: 'CASHFREE', amount: '500' },
      'request-key',
    );
    expect(f.checkout.payOutstanding).toHaveBeenCalledWith(
      'client',
      'rider',
      'request-key',
      { scope: 'SUBMISSION_PENALTY', amount: '500' },
    );
  });
  it('verifies using stored purpose/provider and rejects a callback for another order', async () => {
    const f = fixture();
    f.c.provider = 'RAZORPAY';
    f.c.collectionType = 'SUBMISSION_PENALTY_PAYMENT';
    await expect(
      f.service.verify('client', 'user', `collection:${id}`, {
        ...callback,
        razorpayOrderId: 'order_foreign',
      }),
    ).rejects.toThrow('does not match');
    expect(f.penalties.verify).not.toHaveBeenCalled();
    await f.service.verify('client', 'user', `collection:${id}`, callback);
    expect(f.penalties.verify).toHaveBeenCalledWith('client', 'user', callback);
    await f.service.verify('client', 'user', `deployment:${id}`, callback);
    expect(f.deployments.verify).toHaveBeenCalledWith(
      'client',
      'user',
      id,
      callback,
    );
    expect(f.checkout.verify).not.toHaveBeenCalled();
  });
  it('fetches Cashfree verification server-side without accepting caller success', async () => {
    const f = fixture();
    await expect(
      f.service.verify('client', 'user', `collection:${id}`, {
        status: 'SUCCESS',
      }),
    ).rejects.toThrow();
    expect(f.checkout.verify).not.toHaveBeenCalled();
    await f.service.verify('client', 'user', `collection:${id}`, {});
    expect(f.checkout.verify).toHaveBeenCalledWith('client', 'rider', id);
  });
  it('scopes every request lookup to the authenticated client and rider', async () => {
    const f = fixture();
    await f.service.detail('client', 'user', `collection:${id}`);
    expect(f.db.paymentCollectionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, clientId: 'client', riderId: 'rider' },
      }),
    );
    await f.service.detail('client', 'user', `deployment:${id}`);
    expect(f.db.razorpayDeploymentOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id,
          clientId: 'client',
          payment: {
            clientId: 'client',
            workflow: { allocation: { clientId: 'client', riderId: 'rider' } },
          },
        }),
      }),
    );
    f.db.paymentCollectionRequest.findFirst.mockResolvedValue(null);
    await expect(
      f.service.verify('client', 'user', `collection:${id}`, callback),
    ).rejects.toThrow('not found');
    expect(f.checkout.verify).not.toHaveBeenCalled();
    expect(f.penalties.verify).not.toHaveBeenCalled();
  });
  it('keeps paid payments with review/refund captures out of the successful state', async () => {
    const f = fixture();
    f.order.payment.status = 'PAID';
    f.order.captures.push({
      status: 'REFUND_PENDING',
      reason: 'DUPLICATE_PAYMENT',
      providerPaymentId: 'pay_duplicate',
    });
    expect(
      await f.service.detail('client', 'user', `deployment:${id}`),
    ).toMatchObject({
      status: 'REFUND_PENDING',
      nextAction: 'CONTACT_SUPPORT',
      checkout: null,
    });
    expect(
      commonPaymentStatus('SUCCESS', 'UNAPPLIED_PROVIDER_PAYMENT_REVIEW'),
    ).toBe('REVIEW_REQUIRED');
    expect(commonPaymentStatus('SUCCESS')).toBe('SUCCEEDED');
    expect(commonPaymentStatus('EXPIRED')).toBe('EXPIRED');
  });
  it('does not offer checkout for cancelled allocations or manually submitted payments', async () => {
    const f = fixture();
    f.order.payment.workflow.allocation.status = 'CANCELLED';
    const cancelled = await f.service.detail('client', 'user', `deployment:${id}`);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', checkout: null });
    expect(cancelled).not.toHaveProperty('nextAction');
    f.order.payment.workflow.allocation.status = 'INITIATED';
    f.order.payment.status = 'SUBMITTED';
    expect(
      await f.service.detail('client', 'user', `deployment:${id}`),
    ).toMatchObject({ checkout: null });
  });
  it('keeps the settled primary payment successful after a duplicate capture was refunded', async () => {
    const f = fixture();
    f.order.payment.status = 'PAID';
    f.order.captures.push(
      {
        status: 'REFUNDED',
        reason: 'DUPLICATE_PAYMENT',
        providerPaymentId: 'pay_duplicate',
      },
      { status: 'SETTLED', reason: null, providerPaymentId: 'pay_primary' },
    );
    expect(
      await f.service.detail('client', 'user', `deployment:${id}`),
    ).toMatchObject({
      status: 'SUCCEEDED',
      providerPaymentId: 'pay_primary',
      checkout: null,
    });
  });
  it('uses the Rider role/client context and removes replaced rider create/verify methods', async () => {
    const f = fixture();
    const clients = { requireClientId: vi.fn().mockReturnValue('client') };
    const controller = new CommonPaymentController(
      f.service as never,
      clients as never,
    );
    await controller.create(
      { id: 'user', roles: ['RIDER'] } as never,
      { purpose: 'OUTSTANDING' },
      'request-key',
    );
    expect(f.billing.riderForUser).toHaveBeenCalledWith('client', 'user');
    expect(Reflect.getMetadata(ROLES_KEY, CommonPaymentController)).toEqual([
      'RIDER',
    ]);
    for (const name of ['pay', 'payOutstanding', 'payDeposit', 'verify'])
      expect(RiderCheckoutController.prototype).not.toHaveProperty(name);
  });
});

describe('deposit duplicate collection guard', () => {
  it('blocks an existing pending deposit under another key without filtering by a newly generated payment number', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      riderDeposit: {
        findFirst: vi.fn().mockResolvedValue({
          id,
          status: 'ACTIVE',
          currency: 'INR',
          depositType: 'RIDER_SECURITY',
          requiredAmount: new Prisma.Decimal(500),
          availableAmount: new Prisma.Decimal(0),
        }),
      },
      paymentCollectionRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: 'existing' }),
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
    };
    const provider = { createCheckoutOrder: vi.fn() };
    const checkout = new CheckoutCollectionService(
      db as never,
      { getOrThrow: () => 'cashfree' } as never,
      provider as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      checkout.payDeposit('client', 'rider', id, 'another-key'),
    ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
    const query = tx.paymentCollectionRequest.findFirst.mock.calls[0][0];
    expect(query.where).not.toHaveProperty('paymentNumber');
    expect(query.where).toMatchObject({
      clientId: 'client',
      riderId: 'rider',
      OR: expect.arrayContaining([{ depositId: id }]),
      status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
    });
    expect(provider.createCheckoutOrder).not.toHaveBeenCalled();
    expect(tx.paymentCollectionRequest.create).not.toHaveBeenCalled();
  });
});
