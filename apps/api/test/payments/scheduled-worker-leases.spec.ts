import { describe, expect, it, vi } from 'vitest';
import { AutoCollectionService } from '../../src/payments/auto-collection.service.js';
import { RazorpayAutoPayWorker } from '../../src/payments/razorpay/razorpay-autopay.worker.js';
import { RazorpayDeploymentService } from '../../src/payments/razorpay/razorpay-deployment.service.js';

describe('scheduled payment workers', () => {
  it('does not query or charge without a claimed shared lease', async () => {
    const db = { paymentMandate: { findMany: vi.fn() }, paymentProviderEvent: { findMany: vi.fn() } };
    const automation = { run: vi.fn().mockResolvedValue(false) };
    const collection = new AutoCollectionService(db as never, {} as never, {} as never, {} as never, {} as never, automation as never);
    const processDue = vi.spyOn(collection, 'processDue');
    await collection.run();
    await new RazorpayAutoPayWorker(db as never, {} as never, {} as never, { enabled: true } as never, {} as never, automation as never).reconcile();
    await new RazorpayDeploymentService(db as never, { enabled: true } as never, {} as never, undefined, undefined, undefined, automation as never).reconcile();
    expect(processDue).not.toHaveBeenCalled();
    expect(db.paymentMandate.findMany).not.toHaveBeenCalled();
    expect(db.paymentProviderEvent.findMany).not.toHaveBeenCalled();
    expect(automation.run.mock.calls.map(([key]) => key)).toEqual(['worker:auto-collection', 'worker:razorpay-autopay', 'worker:razorpay-deployment']);
  });
  it('runs collection steps in order only after the lease is claimed', async () => {
    const calls: string[] = [];
    const automation = { run: vi.fn(async (_key, work) => { calls.push('claimed'); return work(); }) };
    const collection = new AutoCollectionService({} as never, {} as never, {} as never, {} as never, {} as never, automation as never);
    for (const name of ['expireMandates', 'reconcileDunning', 'processDue', 'reconcileOpen'] as const)
      vi.spyOn(collection, name).mockImplementation(async () => { calls.push(name); return {} as never; });
    await collection.run();
    expect(calls).toEqual(['claimed', 'expireMandates', 'reconcileDunning', 'processDue', 'reconcileOpen']);
  });
});
