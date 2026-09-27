import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class KycIntelligentGuardrailService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * *')
  async scan(now = new Date()) {
    const policies = await this.prisma.kycIntelligentRoutingPolicy.findMany({ where: {
      status: 'ACTIVE', mode: { in: ['SCORED', 'RULE_BASED'] },
      OR: [{ maxTechnicalFailurePercent: { not: null } }, { maxP95LatencyMs: { not: null } }],
    } });
    for (const policy of policies) {
      const from = new Date(now.getTime() - policy.observationWindowMinutes * 60000);
      const [metrics] = await this.prisma.$queryRaw<Array<{ completed: number; technicalFailures: number;
        p95LatencyMs: number | null }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL)::int AS completed,
          COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureType" = 'TECHNICAL_FAILURE')::int AS "technicalFailures",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY a."latencyMs")
            FILTER (WHERE a."latencyMs" >= 0) AS "p95LatencyMs"
        FROM "KycVerificationAttempt" a
        JOIN "KycRoutingDecision" d ON d."verificationId" = a."verificationId"
        WHERE d."intelligentPolicyId" = ${policy.id} AND d."intelligentMode" IN ('SCORED','RULE_BASED')
          AND a."requestStartedAt" >= ${from} AND a."requestStartedAt" < ${now}`);
      if (metrics.completed < policy.minimumSampleSize) continue;
      const rate = new Prisma.Decimal(metrics.technicalFailures).div(metrics.completed).mul(100);
      const failureBreach = policy.maxTechnicalFailurePercent !== null && rate.gt(policy.maxTechnicalFailurePercent);
      const latencyBreach = policy.maxP95LatencyMs !== null && metrics.p95LatencyMs !== null &&
        metrics.p95LatencyMs > policy.maxP95LatencyMs;
      if (!failureBreach && !latencyBreach) continue;
      const changed = await this.prisma.kycIntelligentRoutingPolicy.updateMany({ where: { id: policy.id, status: 'ACTIVE' },
        data: { status: 'PAUSED' } });
      if (!changed.count) continue;
      const reason = failureBreach ? 'TECHNICAL_FAILURE_GUARDRAIL' : 'P95_LATENCY_GUARDRAIL';
      await this.prisma.auditLog.create({ data: { action: 'KYC_INTELLIGENT_CANARY_AUTO_PAUSED',
        entityType: 'KYC_INTELLIGENT_ROUTING_POLICY', entityId: policy.id,
        newData: { reason, sampleSize: metrics.completed, technicalFailurePercent: rate.toString(),
          p95LatencyMs: metrics.p95LatencyMs } } });
      const dedupeKey = ['KYC_CANARY_GUARDRAIL', 'GLOBAL', policy.id, '', ''].join(':');
      await this.prisma.kycOperationalAlert.upsert({ where: { dedupeKey },
        create: { dedupeKey, type: 'KYC_CANARY_GUARDRAIL', severity: 'CRITICAL', entityId: policy.id },
        update: { status: 'OPEN', lastSeenAt: now, occurrenceCount: { increment: 1 }, resolvedAt: null } });
    }
  }
}
