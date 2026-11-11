import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { KycVerificationType, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AnalyticsFilter, KycAnalyticsQueryService } from './kyc-analytics-query.service.js';

export type SlaPolicyInput = {
  providerId: string; verificationType?: KycVerificationType; effectiveFrom: string; effectiveUntil?: string;
  availabilityTarget?: string; technicalSuccessTarget?: string; p95LatencyTargetMs?: number;
  timeoutRateTarget?: string; minimumSampleSize: number; contractReference?: string;
};

@Injectable()
export class KycSlaAnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly query: KycAnalyticsQueryService,
    private readonly audit: AuditService) {}

  async createPolicy(input: SlaPolicyInput, actorId: string) {
    const from = new Date(input.effectiveFrom);
    const until = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (!Number.isFinite(from.getTime()) || until && (!Number.isFinite(until.getTime()) || until <= from) ||
      ![input.availabilityTarget, input.technicalSuccessTarget, input.timeoutRateTarget, input.p95LatencyTargetMs]
        .some((value) => value !== undefined)) throw new BadRequestException('KYC_INVALID_SLA_POLICY');
    for (const value of [input.availabilityTarget, input.technicalSuccessTarget, input.timeoutRateTarget]) {
      if (value !== undefined && (!new Prisma.Decimal(value).isFinite() || new Prisma.Decimal(value).lt(0) ||
        new Prisma.Decimal(value).gt(100))) throw new BadRequestException('KYC_INVALID_SLA_TARGET');
    }
    const overlap = await this.prisma.kycProviderSlaPolicy.findFirst({ where: {
      providerId: input.providerId, verificationType: input.verificationType ?? null, status: 'ACTIVE',
      effectiveFrom: { lt: until ?? new Date('9999-12-31') },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: from } }],
    } });
    if (overlap) throw new ConflictException('KYC_SLA_POLICY_OVERLAP');
    const policy = await this.prisma.kycProviderSlaPolicy.create({ data: {
      providerId: input.providerId, verificationType: input.verificationType ?? null,
      effectiveFrom: from, effectiveUntil: until,
      availabilityTarget: input.availabilityTarget, technicalSuccessTarget: input.technicalSuccessTarget,
      p95LatencyTargetMs: input.p95LatencyTargetMs, timeoutRateTarget: input.timeoutRateTarget,
      minimumSampleSize: input.minimumSampleSize, contractReference: input.contractReference,
    } });
    await this.audit.record({ actorId, action: 'KYC_PROVIDER_SLA_CONFIGURED', entityType: 'KYC_PROVIDER_SLA_POLICY',
      entityId: policy.id, newData: { providerId: policy.providerId, verificationType: policy.verificationType,
        effectiveFrom: policy.effectiveFrom.toISOString(), effectiveUntil: policy.effectiveUntil?.toISOString() ?? null,
        availabilityTarget: policy.availabilityTarget?.toString() ?? null,
        technicalSuccessTarget: policy.technicalSuccessTarget?.toString() ?? null,
        p95LatencyTargetMs: policy.p95LatencyTargetMs, timeoutRateTarget: policy.timeoutRateTarget?.toString() ?? null } });
    return policy;
  }

  async closePolicy(id: string, effectiveUntil: string, actorId: string) {
    const until = new Date(effectiveUntil);
    const policy = await this.prisma.kycProviderSlaPolicy.findUniqueOrThrow({ where: { id } });
    if (!Number.isFinite(until.getTime()) || until <= policy.effectiveFrom ||
      policy.effectiveUntil && until >= policy.effectiveUntil)
      throw new BadRequestException('KYC_INVALID_SLA_END');
    const updated = await this.prisma.kycProviderSlaPolicy.update({ where: { id }, data: { effectiveUntil: until } });
    await this.audit.record({ actorId, action: 'KYC_PROVIDER_SLA_CLOSED', entityType: 'KYC_PROVIDER_SLA_POLICY',
      entityId: id, previousData: { effectiveUntil: policy.effectiveUntil?.toISOString() ?? null },
      newData: { effectiveUntil: until.toISOString() } });
    return updated;
  }

  async evaluate(q: AnalyticsFilter) {
    const range = this.query.range(q);
    const policies = await this.prisma.kycProviderSlaPolicy.findMany({ where: {
      status: 'ACTIVE', effectiveFrom: { lt: range.to },
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: range.from } }] },
        ...(q.verificationType ? [{ OR: [{ verificationType: q.verificationType as KycVerificationType }, { verificationType: null }] }] : [])],
      ...(q.providerId ? { providerId: q.providerId } : {}),
    }, include: { provider: { select: { name: true } } }, orderBy: { effectiveFrom: 'asc' } });
    const rows = [];
    for (const policy of policies) {
      const from = policy.effectiveFrom > range.from ? policy.effectiveFrom : range.from;
      const to = policy.effectiveUntil && policy.effectiveUntil < range.to ? policy.effectiveUntil : range.to;
      const [facts] = await this.prisma.$queryRaw<Array<{ count: number; completed: number; technicalSuccess: number;
        unavailable: number; timeout: number; latencySample: number; p95LatencyMs: number | null }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL)::int AS completed,
          COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureType" IS DISTINCT FROM 'TECHNICAL_FAILURE')::int AS "technicalSuccess",
          COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureCategory" IN ('PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','TIMEOUT'))::int AS unavailable,
          COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureCategory" IN ('PROVIDER_TIMEOUT','TIMEOUT'))::int AS timeout,
          COUNT(*) FILTER (WHERE a."latencyMs" >= 0)::int AS "latencySample",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."latencyMs" >= 0) AS "p95LatencyMs"
        FROM "KycVerificationAttempt" a JOIN "KycVerification" v ON v.id = a."verificationId"
        LEFT JOIN "KycRoutingDecision" rd ON rd."verificationId" = v.id
        WHERE a."providerId" = ${policy.providerId} AND a."requestStartedAt" >= ${from} AND a."requestStartedAt" < ${to}
          ${policy.verificationType ? Prisma.sql`AND v."verificationType" = ${policy.verificationType}::"KycVerificationType"` : Prisma.empty}
          ${q.verificationType ? Prisma.sql`AND v."verificationType" = ${q.verificationType}::"KycVerificationType"` : Prisma.empty}
          ${q.strategy ? Prisma.sql`AND rd."strategy"::text = ${q.strategy}` : Prisma.empty}
          ${q.clientId ? Prisma.sql`AND v."clientId" = ${q.clientId}` : Prisma.empty}`);
      const percent = (n: number, d: number) => d ? new Prisma.Decimal(n).div(d).mul(100) : null;
      const indicators = [
        { metric: 'TECHNICAL_SUCCESS', target: policy.technicalSuccessTarget, actual: percent(facts.technicalSuccess, facts.completed),
          pass: (actual: Prisma.Decimal, target: Prisma.Decimal) => actual.gte(target) },
        { metric: 'AVAILABILITY', target: policy.availabilityTarget, actual: percent(facts.completed - facts.unavailable, facts.completed),
          pass: (actual: Prisma.Decimal, target: Prisma.Decimal) => actual.gte(target) },
        { metric: 'TIMEOUT_RATE', target: policy.timeoutRateTarget, actual: percent(facts.timeout, facts.completed),
          pass: (actual: Prisma.Decimal, target: Prisma.Decimal) => actual.lte(target) },
        { metric: 'P95_LATENCY_MS', target: policy.p95LatencyTargetMs === null ? null : new Prisma.Decimal(policy.p95LatencyTargetMs),
          actual: facts.p95LatencyMs === null ? null : new Prisma.Decimal(facts.p95LatencyMs),
          pass: (actual: Prisma.Decimal, target: Prisma.Decimal) => actual.lte(target) },
      ].filter((metric) => metric.target !== null);
      for (const indicator of indicators) rows.push({ policyId: policy.id, providerId: policy.providerId,
        provider: policy.provider.name, verificationType: policy.verificationType, metric: indicator.metric,
        target: indicator.target?.toString(), actual: indicator.actual?.toDecimalPlaces(2).toString() ?? null,
        status: (indicator.metric === 'P95_LATENCY_MS' ? facts.latencySample :
          facts.completed) < policy.minimumSampleSize || !indicator.actual ? 'INSUFFICIENT_DATA'
          : indicator.pass(indicator.actual, indicator.target!) ? 'MET' : 'BREACHED',
        sampleSize: indicator.metric === 'P95_LATENCY_MS' ? facts.latencySample :
          facts.completed,
        minimumSampleSize: policy.minimumSampleSize, from, to });
    }
    const [workflow] = await this.prisma.$queryRaw<Array<{ completedWorkflows: number;
      p95CompletionMs: number | null; resolvedReviews: number; p95ReviewTurnaroundMs: number | null }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE w."completedAt" IS NOT NULL)::int AS "completedWorkflows",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (w."completedAt" - w."startedAt")) * 1000)
          FILTER (WHERE w."completedAt" >= w."startedAt") AS "p95CompletionMs",
        COUNT(*) FILTER (WHERE w."reviewResolvedAt" IS NOT NULL)::int AS "resolvedReviews",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (w."reviewResolvedAt" - w."createdAt")) * 1000)
          FILTER (WHERE w."reviewResolvedAt" >= w."createdAt") AS "p95ReviewTurnaroundMs"
      FROM "KycWorkflowExecution" w
      WHERE w."startedAt" >= ${range.from} AND w."startedAt" < ${range.to}
        ${q.clientId ? Prisma.sql`AND w."clientId" = ${q.clientId}` : Prisma.empty}`);
    return { metadata: range, rows, unconfigured: policies.length === 0, internalService: workflow };
  }
}
