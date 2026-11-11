import { Injectable } from '@nestjs/common';
import { KycProviderCode, KycVerificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRegistryService } from '../verification/provider-registry.service.js';
import { KycDistributedCircuitService } from './kyc-distributed-circuit.service.js';

@Injectable()
export class KycProviderHealthService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ProviderRegistryService,
    private readonly circuit: KycDistributedCircuitService) {}

  async snapshot(providerId: string, code: KycProviderCode, type: KycVerificationType, clientId?: string) {
    const attempts = await this.prisma.kycVerificationAttempt.findMany({ where: { providerId,
      verification: { verificationType: type, ...(clientId ? { clientId } : {}) },
      requestStartedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
      select: { failureType: true, failureCategory: true, normalizedStatus: true, latencyMs: true, requestStartedAt: true },
      orderBy: { requestStartedAt: 'desc' }, take: 100 });
    const technical = attempts.filter((attempt) => attempt.failureType === 'TECHNICAL_FAILURE');
    const business = attempts.filter((attempt) => attempt.failureType === 'BUSINESS_FAILURE');
    const successful = attempts.filter((attempt) => attempt.normalizedStatus === 'VERIFIED');
    const circuitOpen = this.registry.circuitOpen(code) || await this.circuit.isOpen(providerId, type);
    const recentOutage = technical.length >= 5 && attempts.length >= 5 && technical.length / attempts.length >= 0.8 &&
      technical[0].requestStartedAt.getTime() > Date.now() - 30_000;
    const status = circuitOpen || recentOutage ? 'UNAVAILABLE' : technical.length >= 3 &&
      technical.length / Math.max(1, attempts.length) >= 0.2 ? 'DEGRADED' : 'AVAILABLE';
    const latencies = attempts.flatMap((attempt) => attempt.latencyMs == null ? [] : [attempt.latencyMs]).sort((a, b) => a - b);
    const percentile = (p: number) => latencies.length ? latencies[Math.ceil(p * latencies.length) - 1] : null;
    return { providerId, verificationType: type, status, circuitOpen, recentRequests: attempts.length,
      successRate: attempts.length ? successful.length / attempts.length : null,
      technicalFailureRate: attempts.length ? technical.length / attempts.length : null,
      businessFailureRate: attempts.length ? business.length / attempts.length : null,
      timeoutRate: attempts.length ? technical.filter((item) => item.failureCategory === 'PROVIDER_TIMEOUT').length / attempts.length : null,
      rateLimitRate: attempts.length ? technical.filter((item) => item.failureCategory === 'RATE_LIMITED').length / attempts.length : null,
      p50LatencyMs: percentile(0.5), p95LatencyMs: percentile(0.95), p99LatencyMs: percentile(0.99) };
  }
}
