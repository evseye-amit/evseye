import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycAttemptReason, KycRoutingStrategy, KycVerificationType, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Environment } from '../../config/environment.js';
import { ProviderRegistryService } from '../verification/provider-registry.service.js';
import { safeVerificationData } from '../verification/kyc-security.js';
import type { ProviderResult, VerificationInput } from '../verification/kyc-types.js';
import { SandboxHttpError } from '../verification/sandbox-http.service.js';
import { KycResultArbitrator, type RoutedOutcome } from './kyc-result-arbitrator.js';
import { KycProviderHealthService } from './kyc-provider-health.service.js';
import { KycIntelligentRoutingService, type Intelligence } from './kyc-intelligent-routing.service.js';
import { KycDistributedCircuitService } from './kyc-distributed-circuit.service.js';

type Eligible = Awaited<ReturnType<ProviderRegistryService['eligible']>>[number];
type Policy = Prisma.KycRoutingPolicyGetPayload<{ include: { providers: true } }>;
type Candidate = Eligible & { routing: Policy['providers'][number] | null };
export interface RoutingPlan {
  policy: Policy | null;
  strategy: KycRoutingStrategy;
  candidates: Candidate[];
  maxAttempts: number;
  fallbackCategories: string[];
  skipped: { providerId: string; reason: string }[];
  intelligence?: Intelligence | null;
}
const technicalCategories = new Set(['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'RATE_LIMITED',
  'AUTHENTICATION_FAILED', 'MALFORMED_RESPONSE', 'WEBHOOK_FAILURE']);
const businessCategories = new Set(['INVALID_INPUT', 'IDENTITY_MISMATCH', 'OTP_FAILED', 'DOCUMENT_INVALID', 'PAN_NOT_VERIFIED']);
const fallbackDefault = ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'RATE_LIMITED'];

@Injectable()
export class KycRoutingEngine {
  constructor(private readonly prisma: PrismaService, private readonly registry: ProviderRegistryService,
    private readonly arbitrator: KycResultArbitrator, private readonly audit: AuditService,
    private readonly health: KycProviderHealthService, private readonly intelligence?: KycIntelligentRoutingService,
    private readonly config?: ConfigService<Environment, true>, private readonly circuit?: KycDistributedCircuitService) {}

  async plan(clientId: string, type: KycVerificationType, assignedPolicyId?: string | null,
    canaryKey = clientId): Promise<RoutingPlan> {
    const include = { providers: { where: { isEnabled: true }, orderBy: { priority: 'asc' as const } } };
    const assigned = assignedPolicyId ? await this.prisma.kycRoutingPolicy.findFirst({ where: {
      id: assignedPolicyId, verificationType: type, status: 'ACTIVE', OR: [{ clientId }, { clientId: null }] }, include }) : null;
    if (assignedPolicyId && !assigned) throw new BadRequestException('KYC_COMMERCIAL_CONFIGURATION_ERROR');
    const policy = assigned ?? await this.prisma.kycRoutingPolicy.findFirst({ where: { clientId, verificationType: type, status: 'ACTIVE', isDefault: true },
      orderBy: { version: 'desc' }, include }) ??
      await this.prisma.kycRoutingPolicy.findFirst({ where: { clientId: null, verificationType: type, status: 'ACTIVE', isDefault: true },
        orderBy: { version: 'desc' }, include });
    const capabilityCandidates = await this.registry.eligible(clientId, type);
    const checked = await Promise.all(capabilityCandidates.map(async (item) => ({ item,
      health: await this.health.snapshot(item.config.id, item.config.code, type) })));
    const eligible = checked.filter(({ health }) => health.status !== 'UNAVAILABLE').map(({ item }) => item);
    if (!eligible.length) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    if (!policy) return { policy: null, strategy: 'PRIORITY', candidates: [{ ...eligible[0], routing: null }],
      maxAttempts: 1, fallbackCategories: fallbackDefault, skipped: [] };
    this.validate(policy, type);
    const candidates = policy.providers.flatMap((routing) => {
      const found = eligible.find((item) => item.config.id === routing.providerId);
      return found ? [{ ...found, routing }] : [];
    }).slice(0, policy.maxProvidersPerVerification);
    if (!candidates.length) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    const skipped = policy.providers.filter((routing) => !candidates.some((item) => item.config.id === routing.providerId)).map((routing) => ({
      providerId: routing.providerId,
      reason: checked.some(({ item, health }) => item.config.id === routing.providerId && health.status === 'UNAVAILABLE')
        ? 'CAPABILITY_UNHEALTHY' : eligible.some((item) => item.config.id === routing.providerId)
          ? 'POLICY_BUDGET' : 'PROVIDER_INELIGIBLE',
    }));
    const intelligence = this.intelligence ? await this.intelligence.evaluate(clientId, type, candidates,
      checked.map(({ item, health }) => ({ providerId: item.config.id, status: health.status,
        circuitOpen: health.circuitOpen })), canaryKey) : { candidates, intelligence: null };
    return { policy, strategy: policy.strategy, candidates: intelligence.candidates, maxAttempts: policy.maxAttempts,
      fallbackCategories: this.fallbackCategories(policy.fallbackCategories), skipped, intelligence: intelligence.intelligence };
  }

  selectWeighted<T extends { routing: { weight: number | null } | null }>(candidates: T[], sample: number): T {
    const total = candidates.reduce((sum, item) => sum + (item.routing?.weight ?? 0), 0);
    if (total <= 0 || sample < 0 || sample >= 1) throw new BadRequestException('KYC_INVALID_ROUTING_WEIGHT');
    let cursor = sample * total;
    for (const item of candidates) {
      cursor -= item.routing?.weight ?? 0;
      if (cursor < 0) return item;
    }
    return candidates[candidates.length - 1];
  }

  async execute(context: { clientId: string; verificationId: string; type: KycVerificationType }, input: VerificationInput,
    plan: RoutingPlan, recovery?: { attemptOffset: number }) {
    const deadlineAt = Date.now() + (this.config?.get('KYC_ROUTING_DEADLINE_MS') ?? 30000);
    let routingCandidates = plan.candidates;
    let intelligence = plan.intelligence;
    if (intelligence && intelligence.actualMode !== 'STATIC' && this.intelligence &&
      (await this.intelligence.disabled(context.clientId, context.type)).length) {
      routingCandidates = [...plan.candidates].sort((a, b) => (a.routing?.priority ?? 999) - (b.routing?.priority ?? 999));
      intelligence = { ...intelligence, actualMode: 'STATIC', reason: 'KILL_SWITCH_AT_EXECUTION' };
    }
    const candidates = plan.strategy === 'WEIGHTED' && intelligence?.actualMode === 'STATIC'
      ? [this.selectWeighted(routingCandidates, Math.random())] :
      plan.strategy === 'WEIGHTED' ? routingCandidates.slice(0, 1) :
      plan.strategy === 'PRIORITY' ? routingCandidates.slice(0, 1) : routingCandidates.slice(0, plan.maxAttempts);
    const healthFailover = !!plan.policy && !!candidates[0]?.routing &&
      candidates[0].routing.priority > plan.policy.providers[0]?.priority;
    if (!recovery) await this.prisma.kycRoutingDecision.create({ data: {
      verificationId: context.verificationId, routingPolicyId: plan.policy?.id, routingPolicyVersion: plan.policy?.version ?? 0,
      strategy: plan.strategy, selectedProviders: candidates.map((item) => item.config.code),
      decisionReason: plan.policy ? 'POLICY_ELIGIBLE_PROVIDER_SELECTION' : 'LEGACY_SINGLE_PROVIDER',
      intelligentPolicyId: intelligence?.policyId, intelligentMode: intelligence?.actualMode,
      intelligenceSnapshot: intelligence as Prisma.InputJsonValue | undefined,
    } });
    if (!recovery && intelligence?.requestedMode === 'SHADOW') await this.prisma.kycShadowDecision.create({ data: {
      verificationId: context.verificationId, clientId: context.clientId, policyId: intelligence.policyId,
      policyVersion: intelligence.policyVersion, actualProviderId: candidates[0]?.config.id,
      shadowProviderId: intelligence.selectedProviderId, scoreSnapshot: intelligence as Prisma.InputJsonValue,
      reason: intelligence.reason } });
    await this.audit.record({ clientId: context.clientId, action: 'KYC_ROUTING_STARTED', entityType: 'KYC_VERIFICATION',
      entityId: context.verificationId, newData: { policyId: plan.policy?.id, version: plan.policy?.version ?? 0,
        strategy: plan.strategy, providers: candidates.map((item) => item.config.code), recovery: !!recovery } });
    for (const skipped of plan.skipped ?? []) await this.audit.record({ clientId: context.clientId,
      action: 'KYC_PROVIDER_SKIPPED', entityType: 'KYC_VERIFICATION', entityId: context.verificationId,
      newData: skipped });
    const outcomes: RoutedOutcome[] = [];
    if (plan.strategy === 'PARALLEL') {
      const settled = await Promise.allSettled(candidates.map((item, index) => this.attempt(context, input, item,
        (recovery?.attemptOffset ?? 0) + index + 1, recovery && index === 0 ? 'RETRY' : 'PARALLEL', deadlineAt)));
      for (const item of settled) {
        if (item.status === 'fulfilled') outcomes.push(item.value);
        else throw item.reason;
      }
    } else if (plan.strategy === 'HEDGED' && candidates.length > 1) {
      const primary = this.attempt(context, input, candidates[0], (recovery?.attemptOffset ?? 0) + 1,
        recovery ? 'RETRY' : 'PRIMARY', deadlineAt);
      const delay = candidates[1].routing?.hedgeDelayMs ?? 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const first = await Promise.race([
        primary.then((result) => ({ kind: 'primary' as const, result })),
        new Promise<{ kind: 'delay' }>((resolve) => { timer = setTimeout(() => resolve({ kind: 'delay' }), delay); }),
      ]);
      if (timer) clearTimeout(timer);
      if (first.kind === 'primary' && this.acceptable(first.result)) outcomes.push(first.result);
      else {
        const secondary = this.attempt(context, input, candidates[1], (recovery?.attemptOffset ?? 0) + 2, 'HEDGE', deadlineAt);
        const settled = await Promise.allSettled([primary, secondary]);
        for (const item of settled) {
          if (item.status === 'fulfilled') outcomes.push(item.value);
          else throw item.reason;
        }
      }
    } else if (plan.strategy === 'FALLBACK') {
      for (const [index, item] of candidates.entries()) {
        if (index > 0 && deadlineAt - Date.now() < 1000) break;
        const outcome = await this.attempt(context, input, item, (recovery?.attemptOffset ?? 0) + index + 1, index === 0
          ? recovery ? 'RETRY' : healthFailover ? 'HEALTH_FAILOVER' : 'PRIMARY' : 'FALLBACK', deadlineAt);
        outcomes.push(outcome);
        if (!this.shouldFallback(outcome.result, plan.fallbackCategories) || index + 1 >= plan.maxAttempts) break;
        await this.audit.record({ clientId: context.clientId, action: 'KYC_PROVIDER_FALLBACK', entityType: 'KYC_VERIFICATION',
          entityId: context.verificationId, newData: { category: outcome.result.failureCategory, fromProvider: item.config.code } });
      }
    } else {
      outcomes.push(await this.attempt(context, input, candidates[0], (recovery?.attemptOffset ?? 0) + 1,
        recovery ? 'RETRY' : plan.strategy === 'WEIGHTED' ? 'WEIGHTED_SELECTION' : healthFailover ? 'HEALTH_FAILOVER' : 'PRIMARY', deadlineAt));
    }
    const mode = plan.policy?.arbitrationMode ?? (plan.strategy === 'HEDGED' ? 'FIRST_VERIFIED' : 'MANUAL_REVIEW_ON_CONFLICT');
    const arbitration = this.arbitrator.arbitrate(outcomes, mode);
    if (arbitration.conflict) {
      if (recovery) await this.prisma.$transaction(arbitration.conflicting.map((item) => this.prisma.kycProviderConflict.upsert({
        where: { verificationId_providerId: { verificationId: context.verificationId, providerId: item.providerId } },
        create: { verificationId: context.verificationId, providerId: item.providerId, resultStatus: item.result.status,
          conflictType: 'PROVIDER_RESULT_DISAGREEMENT', resolution: arbitration.winner.result.status },
        update: { resultStatus: item.result.status, resolution: arbitration.winner.result.status },
      })));
      else await this.prisma.$transaction(arbitration.conflicting.map((item) => this.prisma.kycProviderConflict.create({ data: {
        verificationId: context.verificationId, providerId: item.providerId, resultStatus: item.result.status,
        conflictType: 'PROVIDER_RESULT_DISAGREEMENT', resolution: arbitration.winner.result.status,
      } })));
      await this.audit.record({ clientId: context.clientId, action: 'KYC_PROVIDER_CONFLICT', entityType: 'KYC_VERIFICATION',
        entityId: context.verificationId, newData: { resolution: arbitration.winner.result.status,
          providers: arbitration.conflicting.map((item) => item.providerId) } });
    }
    for (const outcome of outcomes) if (outcome.attemptId !== arbitration.winner.attemptId && outcome.completedAt > arbitration.winner.completedAt)
      await this.prisma.kycVerificationAttempt.update({ where: { id: outcome.attemptId }, data: { isLateCompletion: true } });
    await this.audit.record({ clientId: context.clientId, action: 'KYC_ROUTING_COMPLETED', entityType: 'KYC_VERIFICATION',
      entityId: context.verificationId, newData: { outcome: arbitration.winner.result.status,
        winnerProviderId: arbitration.winner.providerId, attempts: outcomes.length } });
    return arbitration.winner;
  }

  private async attempt(context: { clientId: string; verificationId: string; type: KycVerificationType }, input: VerificationInput,
    item: Candidate, number: number, reason: KycAttemptReason, deadlineAt: number): Promise<RoutedOutcome> {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1000) throw new ServiceUnavailableException('KYC_ROUTING_DEADLINE_EXCEEDED');
    const created = await this.prisma.kycVerificationAttempt.create({ data: { verificationId: context.verificationId,
      providerId: item.config.id, attemptNumber: number, reason, status: 'PROCESSING',
      cost: item.capability.costPerRequest, currency: item.capability.currency,
      costSource: item.capability.costPerRequest === null ? 'UNKNOWN' : 'PROVIDER_PRICING_CONFIG' } });
    await this.audit.record({ clientId: context.clientId, action: 'KYC_PROVIDER_SELECTED', entityType: 'KYC_VERIFICATION',
      entityId: context.verificationId, newData: { providerId: item.config.id, attemptNumber: number, reason } });
    let result: ProviderResult;
    try {
      result = await item.provider.verify({ ...input, timeoutMs: Math.min(remaining,
        item.routing?.timeoutMs ?? item.capability.timeoutMs) });
    } catch (error) {
      const category = error instanceof SandboxHttpError ? error.category : error instanceof BadRequestException ? 'INVALID_INPUT' : 'PROVIDER_ERROR';
      result = { status: 'FAILED', data: {}, failureCategory: category, failureCode: category,
        failureType: businessCategories.has(category) ? 'BUSINESS_FAILURE' : 'TECHNICAL_FAILURE' };
    }
    const completedAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.kycVerificationAttempt.update({ where: { id: created.id }, data: { status: result.status,
        normalizedStatus: result.status, providerTransactionId: result.providerReference,
        responseReceivedAt: new Date(completedAt), latencyMs: completedAt - created.requestStartedAt.getTime(),
        failureType: result.failureType, failureCategory: result.failureCategory, failureCode: result.failureCode,
        billable: item.capability.billingRule === 'EVERY_ATTEMPT' ? true :
          item.capability.billingRule === 'TECHNICAL_COMPLETION' ? result.failureType !== 'TECHNICAL_FAILURE' :
            item.capability.billingRule === 'BUSINESS_SUCCESS' ? result.status === 'VERIFIED' : null } });
      await tx.kycVerificationResult.create({ data: { verificationId: context.verificationId, attemptId: created.id,
        verificationType: context.type, status: result.status,
        normalizedData: safeVerificationData(context.type, result.data) as Prisma.InputJsonValue,
        verifiedAt: result.status === 'VERIFIED' ? new Date(completedAt) : null } });
    });
    await this.circuit?.record(item.config.id, context.type, result.failureType === 'TECHNICAL_FAILURE');
    return { attemptId: created.id, providerId: item.config.id, result, completedAt };
  }

  private acceptable(outcome: RoutedOutcome) {
    return outcome.result.failureType !== 'TECHNICAL_FAILURE' &&
      ['VERIFIED', 'FAILED', 'REJECTED', 'OTP_REQUIRED', 'MANUAL_REVIEW'].includes(outcome.result.status);
  }

  private shouldFallback(result: ProviderResult, configured: string[]) {
    if (result.failureType === 'BUSINESS_FAILURE' || (result.failureCategory && businessCategories.has(result.failureCategory))) return false;
    return result.failureType === 'TECHNICAL_FAILURE' && !!result.failureCategory &&
      technicalCategories.has(result.failureCategory) && configured.includes(result.failureCategory);
  }

  private fallbackCategories(value: Prisma.JsonValue | null): string[] {
    if (value === null) return fallbackDefault;
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && technicalCategories.has(item)))
      throw new BadRequestException('KYC_INVALID_FALLBACK_CATEGORIES');
    return value as string[];
  }

  private validate(policy: Policy, type: KycVerificationType) {
    if (['LOWEST_COST', 'LOWEST_LATENCY', 'SMART'].includes(policy.strategy)) throw new BadRequestException('KYC_ROUTING_STRATEGY_NOT_AVAILABLE');
    if (policy.maxAttempts < 1 || policy.maxAttempts > 5 || policy.maxProvidersPerVerification < 1 || policy.maxProvidersPerVerification > 5 ||
      !policy.providers.length) throw new BadRequestException('KYC_INVALID_ROUTING_BUDGET');
    if (policy.strategy === 'PARALLEL' && !policy.allowParallel || policy.strategy === 'HEDGED' && !policy.allowHedging)
      throw new BadRequestException('KYC_ROUTING_STRATEGY_NOT_ALLOWED');
    if (['PARALLEL', 'HEDGED'].includes(policy.strategy) && type === 'AADHAAR_OTP')
      throw new BadRequestException('KYC_ROUTING_STRATEGY_INVALID_FOR_OTP');
    if (policy.strategy === 'WEIGHTED' && policy.providers.some((item) => !item.weight || item.weight < 1))
      throw new BadRequestException('KYC_INVALID_ROUTING_WEIGHT');
    if (policy.strategy === 'HEDGED' && policy.providers.some((item, index) => index > 0 && (item.hedgeDelayMs == null || item.hedgeDelayMs < 0)))
      throw new BadRequestException('KYC_INVALID_HEDGE_DELAY');
    if (policy.strategy === 'HEDGED' && policy.maxProvidersPerVerification > 2)
      throw new BadRequestException('KYC_INVALID_HEDGE_BUDGET');
    if (policy.providers.some((item) => item.timeoutMs !== null && item.timeoutMs < 1000))
      throw new BadRequestException('KYC_INVALID_ROUTING_TIMEOUT');
  }
}
