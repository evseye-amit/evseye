import { describe, expect, it, vi } from 'vitest';
import { PaymentReconciliationService } from '../../src/payments/payment-reconciliation.service.js';

function fixture() {
  const db = Object.fromEntries(['rider', 'paymentCollectionRequest', 'paymentTransaction', 'riderPayment', 'paymentRefund', 'paymentProviderEvent', 'providerPaymentObservation', 'providerSettlementItem', 'deploymentPaymentAttempt'].map(name => [name, { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) }]));
  const deployment = { reconcileAllocation: vi.fn() };
  const checkout = { verify: vi.fn() }, auto = { verify: vi.fn() };
  return { db, deployment, checkout, auto, service: new PaymentReconciliationService(db as never, checkout as never, auto as never, deployment as never) };
}
describe('payment operations', () => {
  it('includes deployment captures without leaking BigInt or gateway credentials', async () => {
    const f = fixture();
    f.db.deploymentPaymentAttempt.findMany.mockResolvedValue([{ id: 'attempt', provider: 'RAZORPAY', providerOrderId: 'order_1', amountPaise: 50000n,
      payment: { workflow: { allocationId: 'allocation', allocation: { riderId: 'rider' } } },
      captures: [{ id: 'capture', providerPaymentId: 'pay_1', amountPaise: 50000n, status: 'REFUND_PENDING', reason: 'DUPLICATE_PAYMENT' }],
    }]);
    const report = await f.service.report('client', 'rider');
    expect(report.reviewRequired).toBe(1);
    expect(report.items[0]).toMatchObject({ source: 'DEPLOYMENT', amount: '500.00', state: 'MANUAL_REVIEW_REQUIRED', captures: [{ amount: '500.00' }] });
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(f.db.deploymentPaymentAttempt.findMany.mock.calls[0][0].where).toEqual({ clientId: 'client', payment: { workflow: { allocation: { clientId: 'client', riderId: 'rider' } } } });
  });
  it('does not reconcile another rider deployment and rejects unknown sources', async () => {
    const f = fixture();
    await expect(f.service.retry('client', 'rider', 'DEPLOYMENT', 'foreign')).rejects.toThrow('not found');
    expect(f.deployment.reconcileAllocation).not.toHaveBeenCalled();
    await expect(f.service.retry('client', 'rider', 'OTHER' as never, 'id')).rejects.toThrow('Unsupported');
    expect(f.auto.verify).not.toHaveBeenCalled();
  });
  it('recovers an owned deployment and includes its allocation scope', async () => {
    const f = fixture();
    f.db.deploymentPaymentAttempt.findFirst.mockResolvedValue({ provider: 'RAZORPAY', payment: { workflow: { allocationId: 'allocation' } } });
    await f.service.retry('client', 'rider', 'DEPLOYMENT', 'attempt');
    expect(f.deployment.reconcileAllocation).toHaveBeenCalledWith('client', 'allocation');
  });
});

describe('reconciliation history navigation', () => {
  it('reads the next tenant-scoped batch with a deterministic tie-breaker', async () => {
    const f = fixture();
    await f.service.report('client-a', undefined, 2);
    for (const name of ['paymentCollectionRequest', 'paymentTransaction', 'riderPayment', 'paymentRefund', 'paymentProviderEvent', 'providerPaymentObservation', 'providerSettlementItem', 'deploymentPaymentAttempt']) {
      expect(f.db[name].findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-a' }), skip: 200, take: 201, orderBy: expect.arrayContaining([{ id: 'desc' }]) }));
    }
  });
  it('uses the extra record for hasMore without returning it', async () => {
    const f = fixture();
    f.db.paymentProviderEvent.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ id: `event-${index}`, collectionRequest: null })));
    const result = await f.service.report('client-a');
    expect(result.items).toHaveLength(200);
    expect(result.hasMore).toBe(true);
    expect(result.items.at(-1)?.id).toBe('event-199');
  });
});
