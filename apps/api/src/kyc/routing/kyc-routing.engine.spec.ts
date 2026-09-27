import { describe, expect, it, vi } from 'vitest';
import { KycRoutingEngine, type RoutingPlan } from './kyc-routing.engine.js';
import { KycResultArbitrator } from './kyc-result-arbitrator.js';
import type { ProviderResult } from '../verification/kyc-types.js';

const verified: ProviderResult = { status: 'VERIFIED', data: { ifsc: 'HDFC0001234' } };
const timeout = new Error('timeout');
const invalid: ProviderResult = { status: 'FAILED', data: {}, failureType: 'BUSINESS_FAILURE',
  failureCategory: 'IDENTITY_MISMATCH', failureCode: 'IDENTITY_MISMATCH' };

function fixture(strategy: RoutingPlan['strategy'], responses: Array<() => Promise<ProviderResult>>,
  mode: 'FIRST_VERIFIED' | 'MANUAL_REVIEW_ON_CONFLICT' = 'MANUAL_REVIEW_ON_CONFLICT') {
  const calls = responses.map((response) => vi.fn(response));
  const candidates = calls.map((verify, index) => ({
    config: { id: `provider-${index}`, code: ['SANDBOX', 'CASHFREE', 'SUREPASS'][index] },
    capability: { costPerRequest: null, currency: 'INR', timeoutMs: 10000 },
    provider: { verify },
    routing: { priority: index + 1, weight: index === 0 ? 60 : 40, hedgeDelayMs: 1, timeoutMs: null },
  }));
  let attemptNumber = 0;
  const attempts: Array<{ id: string; reason: string; status?: string }> = [];
  const results: Array<{ attemptId: string; status: string }> = [];
  const prisma = {
    kycRoutingDecision: { create: vi.fn().mockResolvedValue({ id: 'decision' }) },
    kycVerificationAttempt: {
      create: vi.fn(async ({ data }: { data: { reason: string } }) => {
        const row = { id: `attempt-${++attemptNumber}`, reason: data.reason, requestStartedAt: new Date(), status: 'PROCESSING' };
        attempts.push(row); return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
        const row = attempts.find((item) => item.id === where.id)!;
        if (data.status) row.status = data.status;
        return row;
      }),
    },
    kycVerificationResult: { create: vi.fn(async ({ data }: { data: { attemptId: string; status: string } }) => {
      results.push({ attemptId: data.attemptId, status: data.status }); return data;
    }) },
    kycProviderConflict: { create: vi.fn(async ({ data }: { data: object }) => data) },
    $transaction: async (value: ((tx: object) => Promise<unknown>) | Promise<unknown>[]) =>
      Array.isArray(value) ? Promise.all(value) : value(prisma),
  };
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const engine = new KycRoutingEngine(prisma as never, {} as never, new KycResultArbitrator(), audit as never, {} as never);
  const plan = { strategy, candidates, maxAttempts: responses.length, fallbackCategories: ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT'],
    skipped: [], policy: { id: 'policy', version: 1, arbitrationMode: mode, providers: candidates.map((item) => item.routing) } } as unknown as RoutingPlan;
  const execute = () => engine.execute({ clientId: 'client', verificationId: 'verification', type: 'IFSC_VERIFICATION' },
    { type: 'IFSC_VERIFICATION', ifsc: 'HDFC0001234' }, plan);
  return { engine, plan, execute, calls, attempts, results, audit, prisma };
}

describe('KYC routing strategies', () => {
  it('uses a client-assigned policy only for the matching verification type', async () => {
    const policy = { id: 'assigned', version: 2, strategy: 'PRIORITY', maxProvidersPerVerification: 1,
      maxAttempts: 1, fallbackCategories: null,
      providers: [{ providerId: 'provider-0', priority: 1, timeoutMs: null }] };
    const findFirst = vi.fn().mockResolvedValue(policy);
    const registry = { eligible: vi.fn().mockResolvedValue([{ config: { id: 'provider-0', code: 'SANDBOX' },
      capability: {}, provider: { verify: vi.fn() } }]) };
    const health = { snapshot: vi.fn().mockResolvedValue({ status: 'AVAILABLE' }) };
    const engine = new KycRoutingEngine({ kycRoutingPolicy: { findFirst } } as never, registry as never,
      new KycResultArbitrator(), {} as never, health as never);
    expect((await engine.plan('client-a', 'PAN_VERIFICATION', 'assigned')).policy?.id).toBe('assigned');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: 'assigned', verificationType: 'PAN_VERIFICATION', OR: [{ clientId: 'client-a' }, { clientId: null }],
    }) }));
  });

  it('priority calls only the first eligible provider', async () => {
    const f = fixture('PRIORITY', [async () => verified, async () => verified]);
    expect((await f.execute()).providerId).toBe('provider-0');
    expect(f.calls[1]).not.toHaveBeenCalled();
    expect(f.attempts).toHaveLength(1);
  });

  it('fallback advances after a technical provider failure', async () => {
    const f = fixture('FALLBACK', [async () => { throw timeout; }, async () => verified]);
    expect((await f.execute()).result.status).toBe('VERIFIED');
    expect(f.attempts.map((item) => item.reason)).toEqual(['PRIMARY', 'FALLBACK']);
    expect(f.results).toHaveLength(2);
  });

  it('does not shop providers after a business identity mismatch', async () => {
    const f = fixture('FALLBACK', [async () => invalid, async () => verified]);
    expect((await f.execute()).result.status).toBe('FAILED');
    expect(f.calls[1]).not.toHaveBeenCalled();
  });

  it('normalizes weights without requiring a total of 100', () => {
    const f = fixture('WEIGHTED', [async () => verified, async () => verified]);
    expect(f.engine.selectWeighted([{ routing: { weight: 6 } }, { routing: { weight: 4 } }], 0.59))
      .toEqual({ routing: { weight: 6 } });
    expect(f.engine.selectWeighted([{ routing: { weight: 6 } }, { routing: { weight: 4 } }], 0.60))
      .toEqual({ routing: { weight: 4 } });
  });

  it('parallel persists both results and sends a conflict to review', async () => {
    const f = fixture('PARALLEL', [async () => verified, async () => invalid]);
    expect((await f.execute()).result.status).toBe('MANUAL_REVIEW');
    expect(f.attempts).toHaveLength(2);
    expect(f.results).toHaveLength(2);
    expect(f.prisma.kycProviderConflict.create).toHaveBeenCalledTimes(2);
  });

  it('hedging avoids a second call when primary finishes before the delay', async () => {
    const f = fixture('HEDGED', [async () => verified, async () => verified]);
    expect((await f.execute()).result.status).toBe('VERIFIED');
    expect(f.calls[1]).not.toHaveBeenCalled();
  });

  it('hedging starts a second provider and sends conflicting outcomes to manual review', async () => {
    const f = fixture('HEDGED', [async () => new Promise((resolve) => setTimeout(() => resolve(invalid), 5)), async () => verified], 'FIRST_VERIFIED');
    expect((await f.execute()).result.status).toBe('MANUAL_REVIEW');
    expect(f.calls[1]).toHaveBeenCalledTimes(1);
    expect(f.attempts).toHaveLength(2);
  });
});

describe('KYC result arbitration', () => {
  const arbitrator = new KycResultArbitrator();
  const outcomes = [
    { attemptId: 'a', providerId: 'a', result: verified, completedAt: 1 },
    { attemptId: 'b', providerId: 'b', result: invalid, completedAt: 2 },
  ];
  it('requires agreement when configured', () => {
    expect(arbitrator.arbitrate(outcomes, 'ALL_MUST_AGREE').winner.result.status).toBe('MANUAL_REVIEW');
  });
  it('selects first verified only under that explicit arbitration rule', () => {
    expect(arbitrator.arbitrate(outcomes, 'FIRST_VERIFIED').winner.providerId).toBe('a');
  });
  it('requires a strict majority', () => {
    expect(arbitrator.arbitrate(outcomes, 'MAJORITY').winner.result.status).toBe('MANUAL_REVIEW');
  });
});
