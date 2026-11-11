import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export type AnalyticsFilter = {
  from?: string; to?: string; clientId?: string; providerId?: string;
  verificationType?: string; strategy?: string; currency?: string;
};

@Injectable()
export class KycAnalyticsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  range(input: AnalyticsFilter) {
    const to = input.to ? new Date(input.to) : new Date();
    const from = input.from ? new Date(input.from) : new Date(to.getTime() - 30 * 86400000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to ||
      to.getTime() - from.getTime() > 366 * 86400000 || to.getTime() > Date.now() + 86400000)
      throw new BadRequestException('KYC_INVALID_ANALYTICS_RANGE');
    return { from, to, timezone: 'UTC', generatedAt: new Date().toISOString() };
  }

  verificationWhere(q: AnalyticsFilter, range: { from: Date; to: Date }) {
    return Prisma.sql`v."requestedAt" >= ${range.from} AND v."requestedAt" < ${range.to}
      ${q.clientId ? Prisma.sql`AND v."clientId" = ${q.clientId}` : Prisma.empty}
      ${q.verificationType ? Prisma.sql`AND v."verificationType"::text = ${q.verificationType}` : Prisma.empty}
      ${q.providerId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "KycVerificationAttempt" provider_filter
        WHERE provider_filter."verificationId" = v.id AND provider_filter."providerId" = ${q.providerId})` : Prisma.empty}
      ${q.strategy ? Prisma.sql`AND rd."strategy"::text = ${q.strategy}` : Prisma.empty}`;
  }

  attemptWhere(q: AnalyticsFilter, range: { from: Date; to: Date }) {
    return Prisma.sql`${this.verificationWhere(q, range)}
      ${q.providerId ? Prisma.sql`AND a."providerId" = ${q.providerId}` : Prisma.empty}`;
  }

  async verificationFacts(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{
      clientId: string; verificationType: string; strategy: string; count: number; success: number;
      technicalFailure: number; businessFailure: number; fallback: number; fallbackRecovered: number;
      p95DecisionMs: number | null;
    }>>(Prisma.sql`
      SELECT v."clientId", v."verificationType"::text AS "verificationType",
        COALESCE(rd."strategy"::text, 'UNROUTED') AS strategy,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE v.status = 'VERIFIED')::int AS success,
        COUNT(*) FILTER (WHERE v.status = 'FAILED' AND last_attempt."failureType" = 'TECHNICAL_FAILURE')::int AS "technicalFailure",
        COUNT(*) FILTER (WHERE v.status IN ('FAILED','REJECTED') AND last_attempt."failureType" = 'BUSINESS_FAILURE')::int AS "businessFailure",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "KycVerificationAttempt" fa WHERE fa."verificationId" = v.id AND fa.reason = 'FALLBACK'))::int AS fallback,
        COUNT(*) FILTER (WHERE v.status = 'VERIFIED' AND EXISTS (SELECT 1 FROM "KycVerificationAttempt" fa WHERE fa."verificationId" = v.id AND fa.reason = 'FALLBACK'))::int AS "fallbackRecovered",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v."completedAt" - v."requestedAt")) * 1000)
          FILTER (WHERE v."completedAt" IS NOT NULL AND v."completedAt" >= v."requestedAt") AS "p95DecisionMs"
      FROM "KycVerification" v
      LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
      LEFT JOIN LATERAL (SELECT a."failureType" FROM "KycVerificationAttempt" a
        WHERE a."verificationId" = v.id ORDER BY a."attemptNumber" DESC LIMIT 1) last_attempt ON true
      WHERE ${this.verificationWhere(q, range)}
      GROUP BY v."clientId", v."verificationType", rd."strategy"`);
    return { metadata: range, rows };
  }

  async attemptFacts(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{
      clientId: string; providerId: string; provider: string; verificationType: string; strategy: string;
      currency: string | null; requests: number; billableKnownCostAttempts: number;
      unknownCostAttempts: number; unknownBillabilityAttempts: number; knownSpend: Prisma.Decimal;
      fallbackCost: Prisma.Decimal; parallelCost: Prisma.Decimal; hedgeCost: Prisma.Decimal;
      technicalFailureCost: Prisma.Decimal; businessFailureCost: Prisma.Decimal;
      successfulVerificationCost: Prisma.Decimal; failedVerificationCost: Prisma.Decimal;
      technicalSuccess: number; technicalFailure: number; businessFailure: number; timeout: number;
      rateLimited: number; unavailable: number; missingLatency: number;
      authenticationFailure: number; providerError: number; malformedResponse: number; webhookFailure: number;
      successfulVerificationsTouched: number;
      p50LatencyMs: number | null; p95LatencyMs: number | null; p99LatencyMs: number | null;
      fallbackAttempts: number; hedgeAttempts: number; parallelAttempts: number;
      hedgeWins: number;
    }>>(Prisma.sql`
      SELECT v."clientId", a."providerId", p.name AS provider,
        v."verificationType"::text AS "verificationType",
        COALESCE(rd."strategy"::text, 'UNROUTED') AS strategy, a.currency,
        COUNT(*)::int AS requests,
        COUNT(*) FILTER (WHERE a.billable = true AND a.cost IS NOT NULL AND a.currency IS NOT NULL)::int AS "billableKnownCostAttempts",
        COUNT(*) FILTER (WHERE a.billable = true AND (a.cost IS NULL OR a.currency IS NULL))::int AS "unknownCostAttempts",
        COUNT(*) FILTER (WHERE a.billable IS NULL)::int AS "unknownBillabilityAttempts",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL), 0) AS "knownSpend",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND a.reason = 'FALLBACK'), 0) AS "fallbackCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND a.reason = 'PARALLEL'), 0) AS "parallelCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND a.reason = 'HEDGE'), 0) AS "hedgeCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND a."failureType" = 'TECHNICAL_FAILURE'), 0) AS "technicalFailureCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND a."failureType" = 'BUSINESS_FAILURE'), 0) AS "businessFailureCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND v.status = 'VERIFIED'), 0) AS "successfulVerificationCost",
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL AND v.status NOT IN ('VERIFIED','CREATED','QUEUED','PROCESSING','ACTION_REQUIRED','OTP_REQUIRED','MANUAL_REVIEW')), 0) AS "failedVerificationCost",
        COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureType" IS DISTINCT FROM 'TECHNICAL_FAILURE')::int AS "technicalSuccess",
        COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureType" = 'TECHNICAL_FAILURE')::int AS "technicalFailure",
        COUNT(*) FILTER (WHERE a."failureType" = 'BUSINESS_FAILURE')::int AS "businessFailure",
        COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureCategory" IN ('PROVIDER_TIMEOUT','TIMEOUT'))::int AS timeout,
        COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureCategory" = 'RATE_LIMITED')::int AS "rateLimited",
        COUNT(*) FILTER (WHERE a."failureCategory" = 'PROVIDER_UNAVAILABLE')::int AS unavailable,
        COUNT(*) FILTER (WHERE a."failureCategory" = 'AUTHENTICATION_FAILED')::int AS "authenticationFailure",
        COUNT(*) FILTER (WHERE a."failureCategory" = 'PROVIDER_ERROR')::int AS "providerError",
        COUNT(*) FILTER (WHERE a."failureCategory" = 'MALFORMED_RESPONSE')::int AS "malformedResponse",
        COUNT(*) FILTER (WHERE a."failureCategory" = 'WEBHOOK_FAILURE')::int AS "webhookFailure",
        COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'VERIFIED')::int AS "successfulVerificationsTouched",
        COUNT(*) FILTER (WHERE a."latencyMs" IS NULL)::int AS "missingLatency",
        percentile_cont(0.50) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."latencyMs" >= 0) AS "p50LatencyMs",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."latencyMs" >= 0) AS "p95LatencyMs",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."latencyMs" >= 0) AS "p99LatencyMs",
        COUNT(*) FILTER (WHERE a.reason = 'FALLBACK')::int AS "fallbackAttempts",
        COUNT(*) FILTER (WHERE a.reason = 'HEDGE')::int AS "hedgeAttempts",
        COUNT(*) FILTER (WHERE a.reason = 'HEDGE' AND v."finalAttemptId" = a.id)::int AS "hedgeWins",
        COUNT(*) FILTER (WHERE a.reason = 'PARALLEL')::int AS "parallelAttempts"
      FROM "KycVerificationAttempt" a
      JOIN "KycVerification" v ON v.id = a."verificationId"
      JOIN "KycProviderConfig" p ON p.id = a."providerId"
      LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
      WHERE ${this.attemptWhere(q, range)}
        ${q.currency ? Prisma.sql`AND a.currency = ${q.currency}` : Prisma.empty}
      GROUP BY v."clientId", a."providerId", p.name, v."verificationType", rd."strategy", a.currency`);
    return { metadata: range, rows };
  }

  async consumptionFacts(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{
      clientId: string; verificationType: string; source: string; currency: string | null;
      count: number; quantity: Prisma.Decimal; missingPrice: number; baseValue: Prisma.Decimal;
      discountValue: Prisma.Decimal; netRevenue: Prisma.Decimal;
    }>>(Prisma.sql`
      SELECT c."clientId", v."verificationType"::text AS "verificationType", c.source::text,
        c.currency, COUNT(*)::int AS count, SUM(c.quantity) AS quantity,
        COUNT(*) FILTER (WHERE c.source = 'OVERAGE' AND (c."effectivePrice" IS NULL OR c.currency IS NULL))::int AS "missingPrice",
        COALESCE(SUM(c."basePrice" * c.quantity) FILTER (WHERE c.source = 'OVERAGE' AND c."reversedAt" IS NULL), 0) AS "baseValue",
        COALESCE(SUM(c.discount * c.quantity) FILTER (WHERE c.source = 'OVERAGE' AND c."reversedAt" IS NULL), 0) AS "discountValue",
        COALESCE(SUM(c."effectivePrice" * c.quantity) FILTER (WHERE c.source = 'OVERAGE' AND c."reversedAt" IS NULL), 0) AS "netRevenue"
      FROM "FeatureUsageConsumption" c
      JOIN "KycVerification" v ON v.id = c."verificationId"
      LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
      WHERE c."occurredAt" >= ${range.from} AND c."occurredAt" < ${range.to}
        ${q.clientId ? Prisma.sql`AND c."clientId" = ${q.clientId}` : Prisma.empty}
        ${q.verificationType ? Prisma.sql`AND v."verificationType"::text = ${q.verificationType}` : Prisma.empty}
        ${q.providerId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "KycVerificationAttempt" provider_filter
          WHERE provider_filter."verificationId" = v.id AND provider_filter."providerId" = ${q.providerId})` : Prisma.empty}
        ${q.strategy ? Prisma.sql`AND rd."strategy"::text = ${q.strategy}` : Prisma.empty}
        ${q.currency ? Prisma.sql`AND c.currency = ${q.currency}` : Prisma.empty}
      GROUP BY c."clientId", v."verificationType", c.source, c.currency`);
    return { metadata: range, rows };
  }

  async addOnPurchases(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; featureCode: string; currency: string;
      purchases: number; quantityPurchased: Prisma.Decimal; baseAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal; netAmount: Prisma.Decimal }>>(Prisma.sql`
      SELECT p."clientId", f.code AS "featureCode", p.currency, COUNT(*)::int AS purchases,
        SUM(p."quantityPurchased") AS "quantityPurchased", SUM(p.amount) AS "baseAmount",
        SUM(p."discountAmount") AS "discountAmount", SUM(p."totalAmount") AS "netAmount"
      FROM "ClientFeatureAddOnPurchase" p JOIN "Feature" f ON f.id = p."featureId"
      WHERE p."purchasedAt" >= ${range.from} AND p."purchasedAt" < ${range.to}
        AND p.status IN ('ACTIVE','CONSUMED','EXPIRED')
        ${q.clientId ? Prisma.sql`AND p."clientId" = ${q.clientId}` : Prisma.empty}
        ${q.currency ? Prisma.sql`AND p.currency = ${q.currency}` : Prisma.empty}
      GROUP BY p."clientId", f.code, p.currency`);
    return { metadata: range, rows };
  }

  async consumptionCostFacts(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; verificationType: string;
      source: string; currency: string | null; knownCost: Prisma.Decimal;
      unknownCostAttempts: number; unknownBillabilityAttempts: number }>>(Prisma.sql`
      SELECT c."clientId", v."verificationType"::text AS "verificationType", c.source::text,
        a.currency, COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL), 0) AS "knownCost",
        COUNT(*) FILTER (WHERE a.billable = true AND (a.cost IS NULL OR a.currency IS NULL))::int AS "unknownCostAttempts",
        COUNT(*) FILTER (WHERE a.billable IS NULL)::int AS "unknownBillabilityAttempts"
      FROM "FeatureUsageConsumption" c
      JOIN "KycVerification" v ON v.id = c."verificationId"
      JOIN "KycVerificationAttempt" a ON a."verificationId" = v.id
      LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
      WHERE c."occurredAt" >= ${range.from} AND c."occurredAt" < ${range.to}
        AND c."reversedAt" IS NULL
        ${q.clientId ? Prisma.sql`AND c."clientId" = ${q.clientId}` : Prisma.empty}
        ${q.verificationType ? Prisma.sql`AND v."verificationType"::text = ${q.verificationType}` : Prisma.empty}
        ${q.providerId ? Prisma.sql`AND a."providerId" = ${q.providerId}` : Prisma.empty}
        ${q.strategy ? Prisma.sql`AND rd."strategy"::text = ${q.strategy}` : Prisma.empty}
        ${q.currency ? Prisma.sql`AND a.currency = ${q.currency}` : Prisma.empty}
      GROUP BY c."clientId", v."verificationType", c.source, a.currency`);
    return { metadata: range, rows };
  }

  async fallbackPairs(q: AnalyticsFilter) {
    const range = this.range(q);
    const rows = await this.prisma.$queryRaw<Array<{ primaryProvider: string; fallbackProvider: string;
      verificationType: string; currency: string | null; fallbackAttempts: number; recovered: number;
      fallbackVerifications: number;
      knownIncrementalCost: Prisma.Decimal; unknownCostAttempts: number; unknownBillabilityAttempts: number }>>(Prisma.sql`
      SELECT primary_provider.name AS "primaryProvider", fallback_provider.name AS "fallbackProvider",
        v."verificationType"::text AS "verificationType", a.currency,
        COUNT(*)::int AS "fallbackAttempts",
        COUNT(DISTINCT v.id)::int AS "fallbackVerifications",
        COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'VERIFIED')::int AS recovered,
        COALESCE(SUM(a.cost) FILTER (WHERE a.billable = true AND a.currency IS NOT NULL), 0) AS "knownIncrementalCost",
        COUNT(*) FILTER (WHERE a.billable = true AND (a.cost IS NULL OR a.currency IS NULL))::int AS "unknownCostAttempts",
        COUNT(*) FILTER (WHERE a.billable IS NULL)::int AS "unknownBillabilityAttempts"
      FROM "KycVerificationAttempt" a
      JOIN "KycVerification" v ON v.id = a."verificationId"
      JOIN "KycProviderConfig" fallback_provider ON fallback_provider.id = a."providerId"
      JOIN LATERAL (SELECT first_attempt."providerId" FROM "KycVerificationAttempt" first_attempt
        WHERE first_attempt."verificationId" = v.id ORDER BY first_attempt."attemptNumber" LIMIT 1) first_provider ON true
      JOIN "KycProviderConfig" primary_provider ON primary_provider.id = first_provider."providerId"
      LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
      WHERE a.reason = 'FALLBACK' AND ${this.attemptWhere(q, range)}
        ${q.currency ? Prisma.sql`AND a.currency = ${q.currency}` : Prisma.empty}
      GROUP BY primary_provider.name, fallback_provider.name, v."verificationType", a.currency`);
    return { metadata: range, rows };
  }
}
