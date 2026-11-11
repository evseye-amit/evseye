import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KycProviderEnvironment, KycVerificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycProviderScoringService } from './kyc-provider-scoring.service.js';

type Candidate = { config: { id: string; code: string }; capability: { costPerRequest: Prisma.Decimal | null; currency: string };
  routing: { priority: number } | null };
type Health = { providerId: string; status: string; circuitOpen: boolean };
export type Intelligence = { policyId: string; policyVersion: number; requestedMode: string; actualMode: string;
  selectedProviderId: string | null; scores: unknown[]; eligibleProviderIds: string[];
  excluded: { providerId: string; reason: string }[]; reason: string; canaryBucket: number | null };

export function canaryBucket(clientId: string, key: string, version: number) {
  const hash = createHash('sha256').update(`${clientId}:${key}:${version}`).digest();
  return hash.readUInt32BE(0) % 10000 / 100;
}

@Injectable()
export class KycIntelligentRoutingService {
  constructor(private readonly prisma: PrismaService, private readonly scoring: KycProviderScoringService) {}

  async policy(clientId: string, type: KycVerificationType, environment: KycProviderEnvironment = 'TEST') {
    const now = new Date();
    const where = { verificationType: type, environment, status: 'ACTIVE', effectiveFrom: { lte: now } };
    return await this.prisma.kycIntelligentRoutingPolicy.findFirst({ where: { ...where, clientId },
      orderBy: { version: 'desc' } }) ?? this.prisma.kycIntelligentRoutingPolicy.findFirst({ where: { ...where, clientId: null },
      orderBy: { version: 'desc' } });
  }

  async disabled(clientId: string, type: KycVerificationType) {
    const controls = await this.prisma.kycIntelligentRoutingControl.findMany({ where: {
      scopeKey: { in: ['GLOBAL', `TYPE:${type}`, `CLIENT:${clientId}`] }, disabled: true }, select: { scopeKey: true } });
    return controls.map((control) => control.scopeKey);
  }

  async evaluate<T extends Candidate>(clientId: string, type: KycVerificationType, candidates: T[],
    health: Health[], key: string, environment: KycProviderEnvironment = 'TEST') {
    const policy = await this.policy(clientId, type, environment);
    if (!policy) return { candidates, intelligence: null as Intelligence | null };
    const blocked = await this.disabled(clientId, type);
    const base = { policyId: policy.id, policyVersion: policy.version, requestedMode: policy.mode,
      selectedProviderId: candidates[0]?.config.id ?? null, scores: [] as unknown[],
      eligibleProviderIds: candidates.map((candidate) => candidate.config.id), excluded: [] as { providerId: string; reason: string }[],
      canaryBucket: null as number | null };
    if (blocked.length || policy.mode === 'STATIC') return { candidates, intelligence: { ...base, actualMode: 'STATIC',
      reason: blocked.length ? `KILL_SWITCH:${blocked.join(',')}` : 'STATIC_POLICY' } };
    try {
      const scored = await this.scoring.score(candidates, policy, health);
      if (!scored.usable) return { candidates, intelligence: { ...base, actualMode: 'STATIC',
        reason: scored.reason, scores: scored.scores, excluded: scored.excluded ?? [] } };
      const selected = scored.selectedProviderId!;
      const snapshot = { ...base, selectedProviderId: selected, scores: scored.scores, excluded: scored.excluded ?? [] };
      if (policy.mode === 'SHADOW') return { candidates, intelligence: { ...snapshot, actualMode: 'STATIC',
        reason: 'SHADOW_ONLY' } };
      const bucket = canaryBucket(clientId, key, policy.version);
      if (bucket >= policy.rolloutPercent) return { candidates, intelligence: { ...snapshot, actualMode: 'STATIC',
        canaryBucket: bucket, reason: 'OUTSIDE_CANARY' } };
      const ordered = policy.mode === 'RULE_BASED'
        ? [...candidates].sort((a, b) => {
          const ah = health.find((item) => item.providerId === a.config.id)?.status === 'AVAILABLE' ? 0 : 1;
          const bh = health.find((item) => item.providerId === b.config.id)?.status === 'AVAILABLE' ? 0 : 1;
          return ah - bh || (a.routing?.priority ?? 999) - (b.routing?.priority ?? 999);
        }) : [...candidates].sort((a, b) => a.config.id === selected ? -1 : b.config.id === selected ? 1 : 0);
      return { candidates: ordered, intelligence: { ...snapshot, actualMode: policy.mode,
        selectedProviderId: ordered[0].config.id, canaryBucket: bucket, reason: `${policy.mode}_CANARY` } };
    } catch {
      return { candidates, intelligence: { ...base, actualMode: 'STATIC', reason: 'SCORING_ERROR_STATIC_FALLBACK' } };
    }
  }
}
