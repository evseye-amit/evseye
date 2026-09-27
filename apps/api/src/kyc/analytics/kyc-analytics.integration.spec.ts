import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { KycAnalyticsQueryService } from './kyc-analytics-query.service.js';
import { KycAnalyticsService } from './kyc-analytics.service.js';
import { KycSlaAnalyticsService } from './kyc-sla-analytics.service.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('KYC Phase 7 PostgreSQL analytics', () => {
  it('uses one verification as the denominator and sums billable fallback cost', async () => {
    const db = new PrismaClient({ datasources: { db: { url: url! } } });
    const rollback = new Error('ROLLBACK_ANALYTICS_FIXTURE');
    try {
      await expect(db.$transaction(async (tx) => {
        const marker = randomUUID();
        const client = await tx.client.create({ data: { name: 'KYC Analytics Test', slug: `kyc-analytics-${marker}` } });
        const rider = await tx.rider.create({ data: { clientId: client.id, name: 'Analytics Rider', mobile: '9000000019' } });
        const provider = await tx.kycProviderConfig.findFirst() ??
          await tx.kycProviderConfig.create({ data: { code: 'SANDBOX', name: 'Sandbox' } });
        const requestedAt = new Date('2026-09-15T10:00:00Z');
        const verification = await tx.kycVerification.create({ data: { clientId: client.id, riderId: rider.id,
          verificationType: 'PAN_VERIFICATION', status: 'VERIFIED', inputFingerprint: marker,
          idempotencyKey: marker, requestedAt, completedAt: new Date('2026-09-15T10:00:03Z') } });
        await tx.kycRoutingDecision.create({ data: { verificationId: verification.id, routingPolicyVersion: 1,
          strategy: 'FALLBACK', selectedProviders: [provider.id], decisionReason: 'TEST' } });
        await tx.kycVerificationAttempt.createMany({ data: [
          { verificationId: verification.id, providerId: provider.id, attemptNumber: 1, reason: 'PRIMARY',
            status: 'FAILED', normalizedStatus: 'FAILED', failureType: 'TECHNICAL_FAILURE',
            failureCategory: 'PROVIDER_TIMEOUT', cost: '1.5000', currency: 'INR', billable: true,
            latencyMs: 100, requestStartedAt: requestedAt, responseReceivedAt: new Date('2026-09-15T10:00:00.100Z') },
          { verificationId: verification.id, providerId: provider.id, attemptNumber: 2, reason: 'FALLBACK',
            status: 'VERIFIED', normalizedStatus: 'VERIFIED', cost: '2.0000', currency: 'INR', billable: true,
            latencyMs: 300, requestStartedAt: new Date('2026-09-15T10:00:01Z'),
            responseReceivedAt: new Date('2026-09-15T10:00:01.300Z') },
        ] });
        const query = new KycAnalyticsQueryService(tx as never);
        const service = new KycAnalyticsService(query, tx as never);
        const range = { clientId: client.id, from: '2026-09-01T00:00:00Z', to: '2026-09-27T00:00:00Z' };
        const cost = await service.cost(range);
        expect(cost.rows).toHaveLength(1);
        expect(cost.rows[0]).toMatchObject({ knownSpend: '3.5000', providerAttempts: 2,
          successfulBusinessVerifications: 1, fallbackIncrementalCost: '2.0000',
          effectiveKnownCostPerSuccessfulBusinessVerification: '3.5000' });
        const routing = await service.routing(range);
        expect(routing.rows[0]).toMatchObject({ fallback: 1, fallbackRecovered: 1, providerAttempts: 2 });
        const providers = await service.providers(range);
        expect(providers.rows[0]).toMatchObject({ sampleSize: 2, technicalSuccess: 1,
          technicalFailure: 1, p50LatencyMs: 200, p95LatencyMs: 290 });
        await tx.kycProviderSlaPolicy.create({ data: { providerId: provider.id,
          verificationType: 'PAN_VERIFICATION', effectiveFrom: new Date('2026-09-01T00:00:00Z'),
          minimumSampleSize: 2, technicalSuccessTarget: '50', p95LatencyTargetMs: 300 } });
        const sla = await new KycSlaAnalyticsService(tx as never, query, {} as never).evaluate(range);
        expect(sla.rows.map((row) => row.status)).toEqual(['MET', 'MET']);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await db.$disconnect(); }
  });
});
