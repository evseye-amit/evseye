import { describe, expect, it, vi } from 'vitest';
import { PaymentAutomationService } from '../../src/payments/payment-automation.service.js';
describe('payment recovery leases', () => {
  it('does not run work if another replica owns it', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn() }; const work = vi.fn();
    expect(await new PaymentAutomationService(db as never).run('refund:one', work)).toBe(false);
    expect(work).not.toHaveBeenCalled(); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('records retry/backoff without exposing provider errors', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ attempts: 2 }]), $executeRaw: vi.fn() };
    await new PaymentAutomationService(db as never).run('refund:one', async () => { throw new Error('secret-provider-payload'); });
    const args = db.$executeRaw.mock.calls[0];
    expect(args).toContain(3); expect(args).toContain(480); expect(args).toContain('VERIFICATION_FAILED');
    expect(JSON.stringify(args)).not.toContain('secret-provider-payload');
  });
});

describe('scheduled worker cadence', () => {
  it('uses a short success delay for minute workers without changing failure backoff', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ attempts: 0 }]), $executeRaw: vi.fn() };
    const automation = new PaymentAutomationService(db as never);
    await automation.run('worker:minute', async () => true, 30);
    expect(db.$executeRaw.mock.calls[0]).toContain(30);
    await automation.run('worker:minute', async () => false, 30);
    expect(db.$executeRaw.mock.calls[1]).toContain(120);
  });
  it('rejects invalid scheduling intervals before claiming a lease', async () => {
    const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    for (const delay of [0, -1, 1.5, NaN, Infinity, 86401])
      await expect(new PaymentAutomationService(db as never).run('worker:bad', async () => true, delay)).rejects.toThrow(RangeError);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
