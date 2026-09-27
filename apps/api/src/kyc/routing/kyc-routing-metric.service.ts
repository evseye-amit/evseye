import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycSlaAnalyticsService } from '../analytics/kyc-sla-analytics.service.js';

@Injectable()
export class KycRoutingMetricService {
  constructor(private readonly prisma: PrismaService, private readonly sla: KycSlaAnalyticsService) {}

  @Cron('*/5 * * * *')
  async refresh(now = new Date()) {
    const policies = await this.prisma.kycIntelligentRoutingPolicy.findMany({ where: { status: 'ACTIVE',
      effectiveFrom: { lte: now } }, select: { verificationType: true, observationWindowMinutes: true } });
    const windows = new Map(policies.map((policy) => [`${policy.verificationType}:${policy.observationWindowMinutes}`, policy]));
    for (const policy of windows.values()) {
      const from = new Date(now.getTime() - policy.observationWindowMinutes * 60000);
      const capabilities = await this.prisma.kycProviderCapability.findMany({ where: {
        verificationType: policy.verificationType, isSupported: true, isEnabled: true },
        select: { providerId: true, costPerRequest: true, currency: true } });
      for (const capability of capabilities) {
        const [metrics] = await this.prisma.$queryRaw<Array<{ sampleSize: number;
          technicalSuccessRate: Prisma.Decimal | null; timeoutRate: Prisma.Decimal | null; p95LatencyMs: number | null }>>(Prisma.sql`
          SELECT COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL)::int AS "sampleSize",
            (COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureType" IS DISTINCT FROM 'TECHNICAL_FAILURE')::numeric /
              NULLIF(COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL), 0)) AS "technicalSuccessRate",
            (COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL AND a."failureCategory" IN ('PROVIDER_TIMEOUT','TIMEOUT'))::numeric /
              NULLIF(COUNT(*) FILTER (WHERE a."responseReceivedAt" IS NOT NULL), 0)) AS "timeoutRate",
            ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY a."latencyMs")
              FILTER (WHERE a."latencyMs" >= 0))::int AS "p95LatencyMs"
          FROM "KycVerificationAttempt" a JOIN "KycVerification" v ON v.id = a."verificationId"
          WHERE a."providerId" = ${capability.providerId} AND v."verificationType" = ${policy.verificationType}::"KycVerificationType"
            AND a."requestStartedAt" >= ${from} AND a."requestStartedAt" < ${now}`);
        const sla = await this.sla.evaluate({ providerId: capability.providerId, verificationType: policy.verificationType,
          from: from.toISOString(), to: now.toISOString() });
        const slaStatus = sla.unconfigured ? 'NOT_CONFIGURED' : sla.rows.some((row) => row.status === 'BREACHED') ? 'BREACHED'
          : sla.rows.length && sla.rows.every((row) => row.status === 'MET') ? 'MET' : 'INSUFFICIENT_DATA';
        await this.prisma.kycRoutingMetricSnapshot.upsert({ where: { providerId_verificationType_windowMinutes: {
          providerId: capability.providerId, verificationType: policy.verificationType,
          windowMinutes: policy.observationWindowMinutes } },
        create: { providerId: capability.providerId, verificationType: policy.verificationType,
          windowMinutes: policy.observationWindowMinutes, sampleSize: metrics.sampleSize,
          technicalSuccessRate: metrics.technicalSuccessRate, timeoutRate: metrics.timeoutRate,
          p95LatencyMs: metrics.p95LatencyMs, knownUnitCost: capability.costPerRequest,
          currency: capability.currency, slaStatus, generatedAt: now },
        update: { sampleSize: metrics.sampleSize, technicalSuccessRate: metrics.technicalSuccessRate,
          timeoutRate: metrics.timeoutRate, p95LatencyMs: metrics.p95LatencyMs,
          knownUnitCost: capability.costPerRequest, currency: capability.currency, slaStatus, generatedAt: now } });
      }
    }
  }
}
