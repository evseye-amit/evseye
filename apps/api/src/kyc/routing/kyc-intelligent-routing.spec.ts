import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { canaryBucket, KycIntelligentRoutingService } from './kyc-intelligent-routing.service.js';
import { KycProviderScoringService, validateWeights } from './kyc-provider-scoring.service.js';

const weights = { reliability: 3, latency: 1, cost: 1, sla: 1, health: 1 };
const policy = { id: 'policy', version: 2, code: 'PAN_ROUTING', clientId: null,
  verificationType: 'PAN_VERIFICATION' as const, environment: 'TEST' as const, mode: 'SCORED', status: 'ACTIVE',
  weights, observationWindowMinutes: 60, minimumSampleSize: 2, maxSnapshotAgeMinutes: 10,
  latencyTargetMs: 1000, unknownCostBehavior: 'NEUTRAL', rolloutPercent: 100 };
const candidates = [
  { config: { id: 'a', code: 'SANDBOX' }, capability: { costPerRequest: new Prisma.Decimal(3), currency: 'INR' }, routing: { priority: 1 } },
  { config: { id: 'b', code: 'CASHFREE' }, capability: { costPerRequest: new Prisma.Decimal(2), currency: 'INR' }, routing: { priority: 2 } },
];
const health = candidates.map((item) => ({ providerId: item.config.id, status: 'AVAILABLE', circuitOpen: false }));
function scoreService(generatedAt = new Date()) {
  return new KycProviderScoringService({ kycRoutingMetricSnapshot: { findMany: async () => [
    { providerId: 'a', sampleSize: 100, technicalSuccessRate: new Prisma.Decimal('0.99'), p95LatencyMs: 500,
      slaStatus: 'MET', generatedAt },
    { providerId: 'b', sampleSize: 100, technicalSuccessRate: new Prisma.Decimal('0.80'), p95LatencyMs: 900,
      slaStatus: 'MET', generatedAt },
  ] } } as never);
}

describe('intelligent routing safety', () => {
  it('normalizes configurable weights and deterministically scores eligible capability snapshots', async () => {
    expect(validateWeights(weights)).toEqual(weights);
    expect(() => validateWeights({ ...weights, reliability: -1 })).toThrow();
    expect(() => validateWeights({ reliability: 0, latency: 0, cost: 0, sla: 0, health: 0 })).toThrow();
    const first = await scoreService().score(candidates, policy, health);
    const second = await scoreService().score(candidates, policy, health);
    expect(first.selectedProviderId).toBe('a');
    expect(first.scores.map((item) => item.score)).toEqual(second.scores.map((item) => item.score));
    expect(first.scores[0].components).toHaveProperty('reliability');
  });

  it('rejects stale snapshots and never interprets unknown cost as free', async () => {
    expect((await scoreService(new Date(Date.now() - 20 * 60000)).score(candidates, policy, health)).usable).toBe(false);
    const unknown = [{ ...candidates[0], capability: { costPerRequest: null, currency: 'INR' } }, candidates[1]];
    const scored = await scoreService().score(unknown, { ...policy, unknownCostBehavior: 'EXCLUDE' }, health);
    expect(scored.selectedProviderId).toBe('b');
  });

  it('keeps shadow execution static and assigns canary cohorts deterministically', async () => {
    const prisma = { kycIntelligentRoutingPolicy: { findFirst: async () => ({ ...policy, mode: 'SHADOW' }) },
      kycIntelligentRoutingControl: { findMany: async () => [] } };
    const service = new KycIntelligentRoutingService(prisma as never,
      { score: async () => ({ usable: true, reason: 'SCORED', selectedProviderId: 'b', scores: [] }) } as never);
    const result = await service.evaluate('client', 'PAN_VERIFICATION', candidates, health, 'request-key');
    expect(result.candidates[0].config.id).toBe('a');
    expect(result.intelligence).toMatchObject({ actualMode: 'STATIC', selectedProviderId: 'b', reason: 'SHADOW_ONLY' });
    expect(canaryBucket('client', 'request-key', 2)).toBe(canaryBucket('client', 'request-key', 2));
  });

  it('honors the global kill switch before scoring', async () => {
    const prisma = { kycIntelligentRoutingPolicy: { findFirst: async () => policy },
      kycIntelligentRoutingControl: { findMany: async () => [{ scopeKey: 'GLOBAL' }] } };
    const service = new KycIntelligentRoutingService(prisma as never, { score: () => { throw new Error('called'); } } as never);
    const result = await service.evaluate('client', 'PAN_VERIFICATION', candidates, health, 'key');
    expect(result.intelligence?.actualMode).toBe('STATIC');
  });
});
