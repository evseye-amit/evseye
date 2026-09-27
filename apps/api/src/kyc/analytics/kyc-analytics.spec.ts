import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { KycAnalyticsService } from './kyc-analytics.service.js';

const decimal = (value: string) => new Prisma.Decimal(value);
const metadata = { from: new Date('2026-09-01'), to: new Date('2026-10-01'), timezone: 'UTC', generatedAt: '2026-10-01' };
const verification = { clientId: 'client-a', verificationType: 'PAN_VERIFICATION', strategy: 'FALLBACK',
  count: 1, success: 1, technicalFailure: 0, businessFailure: 0, fallback: 1, fallbackRecovered: 1, p95DecisionMs: 100 };
function attempt(providerId: string, reason: 'primary' | 'fallback', cost: string, currency = 'INR') {
  return { clientId: 'client-a', providerId, provider: providerId, verificationType: 'PAN_VERIFICATION', strategy: 'FALLBACK', currency,
    requests: 1, billableKnownCostAttempts: 1, unknownCostAttempts: 0, unknownBillabilityAttempts: 0,
    knownSpend: decimal(cost), fallbackCost: decimal(reason === 'fallback' ? cost : '0'),
    parallelCost: decimal('0'), hedgeCost: decimal('0'), technicalFailureCost: decimal(reason === 'primary' ? cost : '0'),
    businessFailureCost: decimal('0'), successfulVerificationCost: decimal(cost), failedVerificationCost: decimal('0'),
    technicalSuccess: reason === 'fallback' ? 1 : 0, technicalFailure: reason === 'primary' ? 1 : 0,
    businessFailure: 0, timeout: reason === 'primary' ? 1 : 0, rateLimited: 0, unavailable: 0, missingLatency: 0,
    authenticationFailure: 0, providerError: 0, malformedResponse: 0, webhookFailure: 0, successfulVerificationsTouched: 1,
    p50LatencyMs: 100, p95LatencyMs: 100, p99LatencyMs: 100, fallbackAttempts: reason === 'fallback' ? 1 : 0,
    hedgeAttempts: 0, parallelAttempts: 0, hedgeWins: 0 };
}

describe('KYC Phase 7 financial analytics', () => {
  it('counts one business verification and two vendor attempts; fallback cost is incremental', async () => {
    const query = { verificationFacts: async () => ({ metadata, rows: [verification] }),
      attemptFacts: async () => ({ metadata, rows: [attempt('primary', 'primary', '1.5000'),
        attempt('secondary', 'fallback', '2.0000')] }),
      fallbackPairs: async () => ({ metadata, rows: [] }),
      consumptionFacts: async () => ({ metadata, rows: [] }) };
    const service = new KycAnalyticsService(query as never, {} as never);
    const result = await service.cost({});
    expect(result.rows[0]).toMatchObject({ providerAttempts: 2, successfulBusinessVerifications: 1,
      knownSpend: '3.5000', fallbackIncrementalCost: '2.0000',
      effectiveKnownCostPerSuccessfulBusinessVerification: '3.5000' });
    const routing = await service.routing({});
    expect(routing.rows[0]).toMatchObject({ count: 1, fallbackRate: '100', fallbackRecoveryRate: '100', providerAttempts: 2 });
  });

  it('does not combine currencies or claim complete cost with unknown billability', async () => {
    const uncertain = { ...attempt('primary', 'primary', '2.0000', 'USD'), unknownBillabilityAttempts: 1 };
    const query = { verificationFacts: async () => ({ metadata, rows: [verification] }),
      attemptFacts: async () => ({ metadata, rows: [attempt('primary', 'primary', '1.5000'), uncertain] }) };
    const service = new KycAnalyticsService(query as never, {} as never);
    const result = await service.cost({});
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.currency === 'USD')?.effectiveCostComplete).toBe(false);
  });

  it('does not assign package included usage a direct price or margin', async () => {
    const query = { consumptionFacts: async () => ({ metadata, rows: [{ clientId: 'client-a',
      verificationType: 'PAN_VERIFICATION', source: 'INCLUDED', currency: null, count: 1,
      quantity: decimal('1'), missingPrice: 0, baseValue: decimal('0'), discountValue: decimal('0'), netRevenue: decimal('0') }] }),
      consumptionCostFacts: async () => ({ metadata, rows: [{ clientId: 'client-a', verificationType: 'PAN_VERIFICATION',
        source: 'INCLUDED', currency: 'INR', knownCost: decimal('2.0000'), unknownCostAttempts: 0, unknownBillabilityAttempts: 0 }] }),
      addOnPurchases: async () => ({ metadata, rows: [] }) };
    const service = new KycAnalyticsService(query as never, {} as never);
    expect((await service.commercial({})).rows[0]).toMatchObject({ netDirectRevenue: null,
      packageRevenueAllocation: 'NOT_ALLOCATED', knownDirectGrossMargin: null });
  });

  it('uses saved overage price and same-source provider cost for direct margin', async () => {
    const query = { consumptionFacts: async () => ({ metadata, rows: [{ clientId: 'client-a',
      verificationType: 'PAN_VERIFICATION', source: 'OVERAGE', currency: 'INR', count: 1,
      quantity: decimal('1'), missingPrice: 0, baseValue: decimal('6'), discountValue: decimal('1'),
      netRevenue: decimal('5') }] }),
      consumptionCostFacts: async () => ({ metadata, rows: [{ clientId: 'client-a',
        verificationType: 'PAN_VERIFICATION', source: 'OVERAGE', currency: 'INR',
        knownCost: decimal('3.5'), unknownCostAttempts: 0, unknownBillabilityAttempts: 0 }] }),
      addOnPurchases: async () => ({ metadata, rows: [] }) };
    const service = new KycAnalyticsService(query as never, {} as never);
    expect((await service.commercial({})).rows[0]).toMatchObject({ baseSaleValue: '6.0000',
      discountValue: '1.0000', netDirectRevenue: '5.0000', knownDirectGrossMargin: '1.5000' });
  });
});
