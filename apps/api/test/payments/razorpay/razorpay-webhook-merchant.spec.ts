import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { resolveWebhookMerchant } from '../../../src/payments/razorpay/razorpay-webhook-merchant.js';
import { RazorpayDeploymentService } from '../../../src/payments/razorpay/razorpay-deployment.service.js';
import { RazorpayClient } from '../../../src/payments/razorpay/razorpay.client.js';
import { RazorpayAutoPayWorker } from '../../../src/payments/razorpay/razorpay-autopay.worker.js';
import { RazorpayEventRouter } from '../../../src/payments/razorpay/razorpay-event-router.service.js';

function fixture() {
  const store = () => ({
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  });
  const events = new Map<string, any>();
  const db = {
    deploymentPaymentAttempt: store(),
    razorpayPenaltyOrder: store(),
    paymentTransaction: store(),
    paymentMandate: store(),
    deploymentPaymentCapture: store(),
    paymentCollectionRequest: store(),
    paymentProviderEvent: {
      createMany: vi.fn(async ({ data }) => {
        if (!events.has(data.eventKey))
          events.set(data.eventKey, {
            id: data.eventKey,
            status: 'RECEIVED',
            ...data,
          });
      }),
      findUniqueOrThrow: vi.fn(async ({ where }) =>
        events.get(where.provider_eventKey?.eventKey ?? where.id),
      ),
      update: vi.fn(),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = events.get(where.id);
        if (row && row.clientId == null) {
          Object.assign(row, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
  };
  const client = new RazorpayClient(
    { get: () => undefined } as never,
    {
      webhookVersions: vi.fn().mockResolvedValue([]),
      resolve: vi.fn(async (id: string) => ({
        keyId: `key-${id}`,
        keySecret: `secret-${id}`,
        webhookSecret: `hook-${id}`,
      })),
    } as never,
  );
  const service = new RazorpayDeploymentService(
    db as never,
    client,
    {} as never,
  );
  return { db, client, service, events };
}
const payload = (event = 'payment.captured') =>
  Buffer.from(
    JSON.stringify({
      event,
      payload: event.startsWith('token.')
        ? { token: { entity: { id: 'token_test' } } }
        : { payment: { entity: { id: 'pay_test', order_id: 'order_test' } } },
    }),
  );
const sign = (raw: Buffer, clientId: string) =>
  createHmac('sha256', `hook-${clientId}`).update(raw).digest('hex');

describe('Merchant-bound Razorpay webhook ingress', () => {
  it.each(['a', 'b'])(
    'resolves AutoPay debit merchant %s and persists it after signature verification',
    async (id) => {
      const f = fixture();
      f.db.paymentTransaction.findFirst.mockResolvedValue({ clientId: id });
      const raw = payload();
      await f.service.webhook(raw, sign(raw, id), 'evt');
      expect(f.events.get('evt').clientId).toBe(id);
      await expect(
        f.service.webhook(raw, sign(raw, 'other'), 'bad'),
      ).rejects.toThrow('signature');
      expect(f.events.has('bad')).toBe(false);
    },
  );
  it('resolves authorization orders and token-only events', async () => {
    const f = fixture();
    f.db.paymentMandate.findFirst.mockResolvedValue({ clientId: 'a' });
    const raw = payload();
    await f.service.webhook(raw, sign(raw, 'a'), 'authorization');
    f.db.paymentMandate.findMany.mockResolvedValue([{ clientId: 'b' }]);
    const token = payload('token.cancelled');
    await f.service.webhook(token, sign(token, 'b'), 'token');
    expect(f.events.get('token').clientId).toBe('b');
  });
  it('accepts an early unbound event only with an authenticated routed merchant', async () => {
    const f = fixture();
    const raw = payload();
    await expect(f.service.webhook(raw, sign(raw, 'a'), 'evt')).rejects.toThrow(
      'client-specific',
    );
    await expect(
      f.service.webhook(raw, sign(raw, 'b'), 'bad', 'a'),
    ).rejects.toThrow('signature');
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    expect(f.events.size).toBe(1);
    expect(f.events.get('evt').clientId).toBe('a');
  });
  it('rejects route/owner and mixed-reference conflicts before persisting', async () => {
    const f = fixture();
    const raw = payload();
    f.db.paymentTransaction.findFirst.mockResolvedValue({ clientId: 'b' });
    await expect(
      f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a'),
    ).rejects.toThrow('merchant mismatch');
    f.db.deploymentPaymentAttempt.findUnique.mockResolvedValue({
      clientId: 'a',
    });
    await expect(
      resolveWebhookMerchant(f.db as never, { orderId: 'order_test' }),
    ).rejects.toThrow('merchant mismatch');
    expect(f.db.paymentProviderEvent.createMany).not.toHaveBeenCalled();
  });
  it('does not allow replaying an event ID under another authenticated merchant', async () => {
    const f = fixture();
    const raw = payload();
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    await expect(
      f.service.webhook(raw, sign(raw, 'b'), 'evt', 'b'),
    ).rejects.toThrow('merchant mismatch');
    expect(f.events.get('evt').clientId).toBe('a');
  });
  it('binds a legacy inbox record only after revalidating the identical signed payload', async () => {
    const f = fixture();
    const raw = payload();
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    f.events.get('evt').clientId = null;
    await expect(
      f.service.webhook(raw, sign(raw, 'b'), 'evt', 'a'),
    ).rejects.toThrow('signature');
    expect(f.events.get('evt').clientId).toBeNull();
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    expect(f.events.get('evt').clientId).toBe('a');
  });
  it('rejects altered content reusing a signed event ID', async () => {
    const f = fixture();
    const raw = payload();
    await f.service.webhook(raw, sign(raw, 'a'), 'evt', 'a');
    const changed = payload('payment.failed');
    await expect(
      f.service.webhook(changed, sign(changed, 'a'), 'evt', 'a'),
    ).rejects.toThrow('different content');
  });
  it('resolves deployment refunds through the stored capture', async () => {
    const f = fixture();
    f.db.deploymentPaymentCapture.findUnique.mockResolvedValue({
      attempt: { clientId: 'a' },
    });
    expect(
      await resolveWebhookMerchant(f.db as never, { paymentId: 'pay_refund' }),
    ).toBe('a');
  });
});

describe('AutoPay worker merchant recovery', () => {
  it('fetches an unbound order with the verified client and scopes receipt lookup', async () => {
    const f = fixture();
    const gateway = {
      fetchOrder: vi.fn().mockResolvedValue({ receipt: 'local-tx' }),
    };
    const payments = { verify: vi.fn() };
    f.db.paymentTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'local-tx',
        clientId: 'a',
        riderId: 'r',
        mandateId: 'm',
      });
    const worker = new RazorpayAutoPayWorker(
      f.db as never,
      {} as never,
      payments as never,
      gateway as never,
      new RazorpayEventRouter(),
    );
    await expect(
      worker.processEvent({
        id: 'evt',
        clientId: 'a',
        eventType: 'payment.captured',
        deploymentPayload: { orderId: 'order_test', paymentId: 'pay_test' },
      }),
    ).resolves.toBe(true);
    expect(gateway.fetchOrder).toHaveBeenCalledWith('order_test', 'a', undefined);
    expect(f.db.paymentTransaction.findFirst).toHaveBeenLastCalledWith({
      where: { clientId: 'a', provider: 'RAZORPAY', id: 'local-tx' },
    });
    expect(payments.verify).toHaveBeenCalledWith('a', 'r', 'local-tx');
  });
  it('leaves unscoped legacy events for authenticated redelivery', async () => {
    const f = fixture();
    const gateway = { fetchOrder: vi.fn() };
    const worker = new RazorpayAutoPayWorker(
      f.db as never,
      {} as never,
      {} as never,
      gateway as never,
      new RazorpayEventRouter(),
    );
    await expect(
      worker.processEvent({
        id: 'old',
        eventType: 'payment.captured',
        deploymentPayload: {},
      }),
    ).rejects.toThrow('merchant-verified redelivery');
    expect(gateway.fetchOrder).not.toHaveBeenCalled();
  });
});
