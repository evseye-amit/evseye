import { BadRequestException, Injectable } from '@nestjs/common';
import { KycVerificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export type ScoreWeights = { reliability: number; latency: number; cost: number; sla: number; health: number };
export type ScorePolicy = { verificationType: KycVerificationType; observationWindowMinutes: number; minimumSampleSize: number;
  maxSnapshotAgeMinutes: number; latencyTargetMs: number; unknownCostBehavior: string; weights: Prisma.JsonValue };
type Candidate = { config: { id: string; code: string }; capability: {
  costPerRequest: Prisma.Decimal | null; currency: string; billingRule?: string } };
type Health = { providerId: string; status: string; circuitOpen: boolean };

export function validateWeights(value: unknown): ScoreWeights {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('KYC_INVALID_SCORE_WEIGHTS');
  const row = value as Record<string, unknown>;
  const keys = ['reliability', 'latency', 'cost', 'sla', 'health'] as const;
  if (Object.keys(row).some((key) => !keys.includes(key as typeof keys[number])) ||
    keys.some((key) => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || (row[key] as number) < 0) ||
    keys.reduce((sum, key) => sum + (row[key] as number), 0) <= 0)
    throw new BadRequestException('KYC_INVALID_SCORE_WEIGHTS');
  return row as ScoreWeights;
}

@Injectable()
export class KycProviderScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async score<T extends Candidate>(candidates: T[], policy: ScorePolicy, health: Health[], now = new Date()) {
    const weights = validateWeights(policy.weights);
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const snapshots = await this.prisma.kycRoutingMetricSnapshot.findMany({ where: {
      providerId: { in: candidates.map((candidate) => candidate.config.id) },
      windowMinutes: policy.observationWindowMinutes,
      verificationType: policy.verificationType,
    } });
    const byProvider = new Map(snapshots.map((snapshot) => [snapshot.providerId, snapshot]));
    const fresh = candidates.every((candidate) => {
      const snapshot = byProvider.get(candidate.config.id);
      return snapshot && now.getTime() - snapshot.generatedAt.getTime() <= policy.maxSnapshotAgeMinutes * 60000;
    });
    if (!fresh) return { usable: false, reason: 'STALE_OR_MISSING_METRICS', selectedProviderId: null,
      scores: [] as Array<{ providerId: string; score: number; components: Record<string, number>; sampleSize: number }>,
      excluded: [] as { providerId: string; reason: string }[] };
    const knownCosts = candidates.flatMap((candidate) => candidate.capability.costPerRequest === null || candidate.capability.billingRule === 'UNKNOWN' ? [] :
      [{ amount: candidate.capability.costPerRequest, currency: candidate.capability.currency }]);
    const sameCurrency = new Set(knownCosts.map((cost) => cost.currency)).size <= 1;
    const minimumCost = sameCurrency && knownCosts.length ? Prisma.Decimal.min(...knownCosts.map((cost) => cost.amount)) : null;
    const excluded: { providerId: string; reason: string }[] = [];
    const scores = candidates.flatMap((candidate) => {
      const snapshot = byProvider.get(candidate.config.id)!;
      const current = health.find((item) => item.providerId === candidate.config.id);
      if (!current || current.circuitOpen || current.status === 'UNAVAILABLE') {
        excluded.push({ providerId: candidate.config.id, reason: current?.circuitOpen ? 'CIRCUIT_OPEN' : 'UNHEALTHY' });
        return [];
      }
      if (policy.unknownCostBehavior === 'EXCLUDE' &&
        (candidate.capability.costPerRequest === null || candidate.capability.billingRule === 'UNKNOWN')) {
        excluded.push({ providerId: candidate.config.id, reason: 'UNKNOWN_PROVIDER_COST' });
        return [];
      }
      const sufficient = snapshot.sampleSize >= policy.minimumSampleSize;
      const reliability = sufficient && snapshot.technicalSuccessRate !== null ? Number(snapshot.technicalSuccessRate) : 0.5;
      const latency = sufficient && snapshot.p95LatencyMs !== null ? Math.max(0, Math.min(1,
        policy.latencyTargetMs / Math.max(policy.latencyTargetMs, snapshot.p95LatencyMs))) : 0.5;
      const cost = minimumCost !== null && candidate.capability.costPerRequest !== null && candidate.capability.costPerRequest.gt(0)
        ? Number(minimumCost.div(candidate.capability.costPerRequest)) : 0.5;
      const sla = snapshot.slaStatus === 'MET' ? 1 : snapshot.slaStatus === 'BREACHED' ? 0 : 0.5;
      const healthScore = current.status === 'AVAILABLE' ? 1 : 0.5;
      const components = { reliability, latency, cost, sla, health: healthScore };
      const score = Object.entries(components).reduce((sum, [key, value]) => sum + value * weights[key as keyof ScoreWeights], 0) / totalWeight;
      return [{ providerId: candidate.config.id, score: Number(score.toFixed(6)), components,
        sampleSize: snapshot.sampleSize, observationGeneratedAt: snapshot.generatedAt.toISOString(),
        insufficientData: !sufficient }];
    }).sort((a, b) => b.score - a.score || a.providerId.localeCompare(b.providerId));
    return { usable: scores.length > 0, reason: scores.length ? 'SCORED' : 'NO_ELIGIBLE_SCORED_PROVIDER',
      selectedProviderId: scores[0]?.providerId ?? null, scores, excluded };
  }
}
