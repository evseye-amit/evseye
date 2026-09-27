import { Injectable, NotFoundException } from '@nestjs/common';
import { KycRoutingStrategy, KycVerificationStatus, KycVerificationType, KycWorkflowStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycStuckDetectionService } from './kyc-stuck-detection.service.js';

export type OpsFilters = { clientId?: string; hours?: number; status?: string; type?: string;
  providerId?: string; search?: string; flag?: string; strategy?: string; failureCategory?: string;
  skip?: number; sort?: string };

const auditFields = new Set(['enabled', 'isEnabled', 'isActive', 'status', 'version', 'strategy',
  'verificationType', 'routingPolicyId', 'workflowDefinitionId', 'overagePolicy', 'validityDays',
  'priority', 'providerId', 'capability', 'assignedTo', 'reasonCode']);
function safeAuditValues(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    auditFields.has(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item))));
}

@Injectable()
export class KycOperationsQueryService {
  constructor(private readonly prisma: PrismaService, private readonly stuck: KycStuckDetectionService) {}

  private since(hours = 24) { return new Date(Date.now() - Math.min(Math.max(hours, 1), 168) * 3600_000); }
  private page(skip = 0) { return Math.min(Math.max(skip, 0), 100000); }
  private verificationWhere(filters: OpsFilters): Prisma.KycVerificationWhereInput {
    const search = filters.search?.trim();
    const and: Prisma.KycVerificationWhereInput[] = [];
    if (filters.providerId) and.push({ attempts: { some: { providerId: filters.providerId } } });
    if (filters.failureCategory) and.push({ attempts: { some: { failureCategory: filters.failureCategory } } });
    if (filters.flag === 'FALLBACK_USED') and.push({ attempts: { some: { reason: 'FALLBACK' } } });
    if (filters.flag === 'ROUTING_EXHAUSTED') and.push({ status: 'FAILED',
      attempts: { some: { reason: 'FALLBACK', failureType: 'TECHNICAL_FAILURE' } } });
    if (Object.values(KycRoutingStrategy).includes(filters.strategy as KycRoutingStrategy))
      and.push({ routingDecision: { strategy: filters.strategy as KycRoutingStrategy } });
    return { clientId: filters.clientId, createdAt: { gte: this.since(filters.hours) },
      updatedAt: filters.flag === 'STUCK' ? { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES')) } : undefined,
      status: filters.flag === 'STUCK' ? { in: ['CREATED', 'PROCESSING'] } :
        Object.values(KycVerificationStatus).includes(filters.status as KycVerificationStatus)
          ? filters.status as KycVerificationStatus : undefined,
      verificationType: Object.values(KycVerificationType).includes(filters.type as KycVerificationType)
        ? filters.type as KycVerificationType : undefined,
      AND: and,
      OR: search ? [{ id: search }, { riderId: search }, { workflowStepExecution: { workflowExecutionId: search } },
        { attempts: { some: { providerTransactionId: search } } }] : undefined,
      ...(filters.flag === 'PROVIDER_CONFLICT' ? { providerConflicts: { some: {} } } : {}),
    };
  }

  async summary(clientId?: string, hours = 24) {
    const since = this.since(hours);
    const base: Prisma.KycVerificationWhereInput = { clientId, createdAt: { gte: since } };
    const workflowBase: Prisma.KycWorkflowExecutionWhereInput = { clientId, createdAt: { gte: since } };
    const [groups, businessFailures, technicalFailures, fallbackExecutions, providerConflicts, stuckVerifications,
      stuckWorkflows, reviews, overdueReviews, routing] = await Promise.all([
      this.prisma.kycVerification.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.kycVerification.count({ where: { ...base, status: 'FAILED',
        attempts: { some: { failureType: 'BUSINESS_FAILURE' } } } }),
      this.prisma.kycVerification.count({ where: { ...base, attempts: { some: { failureType: 'TECHNICAL_FAILURE' } } } }),
      this.prisma.kycVerification.count({ where: { ...base, attempts: { some: { reason: 'FALLBACK' } } } }),
      this.prisma.kycVerification.count({ where: { ...base, providerConflicts: { some: {} } } }),
      this.prisma.kycVerification.count({ where: { ...base, status: { in: ['CREATED', 'PROCESSING'] },
        updatedAt: { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES')) } } }),
      this.prisma.kycWorkflowExecution.count({ where: { ...workflowBase,
        status: { in: ['CREATED', 'IN_PROGRESS', 'WAITING', 'RECONCILING', 'DECISION_PENDING'] },
        updatedAt: { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES')) } } }),
      this.prisma.kycWorkflowExecution.count({ where: { ...workflowBase, status: 'MANUAL_REVIEW' } }),
      this.prisma.kycWorkflowExecution.count({ where: { ...workflowBase, status: 'MANUAL_REVIEW', OR: [
        { reviewDueAt: { lt: new Date() } }, { reviewDueAt: null,
          updatedAt: { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_REVIEW_SLA_MINUTES')) } }] } }),
      this.prisma.kycRoutingDecision.groupBy({ by: ['strategy'], where: { createdAt: { gte: since },
        verification: { clientId } }, _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(groups.map((row) => [row.status, row._count._all]));
    return { hours: Math.min(Math.max(hours, 1), 168), total: groups.reduce((sum, row) => sum + row._count._all, 0),
      byStatus, inProgress: (byStatus.CREATED ?? 0) + (byStatus.PROCESSING ?? 0),
      verified: byStatus.VERIFIED ?? 0, rejected: (byStatus.REJECTED ?? 0) + businessFailures,
      manualReview: reviews, technicalFailures, stuck: stuckVerifications + stuckWorkflows,
      fallbackExecutions, providerConflicts, overdueReviews,
      routing: Object.fromEntries(routing.map((row) => [row.strategy, row._count._all])) };
  }

  async verifications(filters: OpsFilters) {
    const where = this.verificationWhere(filters);
    const [items, total] = await Promise.all([
      this.prisma.kycVerification.findMany({ where, select: { id: true, clientId: true, riderId: true,
        verificationType: true, status: true, resultCode: true, requestedAt: true, startedAt: true,
        completedAt: true, updatedAt: true, expiresAt: true,
        finalProvider: { select: { id: true, code: true, name: true } },
        workflowStepExecution: { select: { workflowExecutionId: true, workflowStep: { select: { name: true } } } },
        routingDecision: { select: { strategy: true, selectedProviders: true } },
        attempts: { select: { reason: true, responseReceivedAt: true, requestStartedAt: true }, orderBy: { attemptNumber: 'asc' } },
        providerConflicts: { select: { id: true } } },
        orderBy: filters.sort === 'oldest' ? { createdAt: 'asc' } : filters.sort === 'activity' ? { updatedAt: 'desc' } : { createdAt: 'desc' },
        skip: this.page(filters.skip), take: 50 }),
      this.prisma.kycVerification.count({ where }),
    ]);
    return { items: items.map(({ attempts, providerConflicts, ...row }) => ({ ...row,
      attemptCount: attempts.length, flags: this.stuck.verificationFlags({ ...row, attempts, providerConflicts }) })),
      total, skip: this.page(filters.skip), pageSize: 50 };
  }

  async workflows(filters: OpsFilters) {
    const where: Prisma.KycWorkflowExecutionWhereInput = { clientId: filters.clientId,
      createdAt: { gte: this.since(filters.hours) },
      updatedAt: filters.flag === 'STUCK' ? { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES')) } : undefined,
      status: filters.flag === 'STUCK' ? { in: ['CREATED', 'IN_PROGRESS', 'WAITING', 'RECONCILING', 'DECISION_PENDING'] } :
        Object.values(KycWorkflowStatus).includes(filters.status as KycWorkflowStatus)
        ? filters.status as KycWorkflowStatus : undefined,
      workflowDefinition: filters.search ? { code: filters.search.slice(0, 80) } : undefined };
    const [items, total] = await Promise.all([
      this.prisma.kycWorkflowExecution.findMany({ where, select: { id: true, clientId: true, riderId: true,
        status: true, workflowVersion: true, currentStepId: true, startedAt: true, completedAt: true,
        expiresAt: true, updatedAt: true, reviewPriority: true, reviewAssignedTo: true,
        reviewDueAt: true, reviewVersion: true,
        workflowDefinition: { select: { code: true, name: true } },
        stepExecutions: { select: { status: true, workflowStep: { select: { name: true } } },
          orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: filters.sort === 'oldest' ? { createdAt: 'asc' } : filters.sort === 'activity' ? { updatedAt: 'desc' } : { createdAt: 'desc' },
        skip: this.page(filters.skip), take: 50 }),
      this.prisma.kycWorkflowExecution.count({ where }),
    ]);
    return { items: items.map((row) => ({ ...row, flags: this.stuck.workflowFlags(row) })), total,
      skip: this.page(filters.skip), pageSize: 50 };
  }

  async manualReviews(filters: OpsFilters, actorId: string) {
    const where: Prisma.KycWorkflowExecutionWhereInput = { clientId: filters.clientId,
      status: filters.status === 'COMPLETED' ? { in: ['VERIFIED', 'REJECTED'] } : 'MANUAL_REVIEW',
      reviewResolvedAt: filters.status === 'COMPLETED' ? { not: null } : undefined,
      ...(filters.flag === 'UNASSIGNED' ? { reviewAssignedTo: null } : {}),
      ...(filters.flag === 'MINE' ? { reviewAssignedTo: actorId } : {}),
      ...(filters.flag === 'OTHERS' ? { reviewAssignedTo: { not: null, notIn: [actorId] } } : {}),
      ...(filters.flag === 'HIGH_PRIORITY' ? { reviewPriority: { in: ['HIGH', 'CRITICAL'] } } : {}),
      ...(filters.flag === 'OVERDUE' ? { OR: [{ reviewDueAt: { lt: new Date() } },
        { reviewDueAt: null, updatedAt: { lt: this.stuck.cutoff(this.stuck.minutes('KYC_OPS_REVIEW_SLA_MINUTES')) } }] } : {}),
      ...(filters.flag === 'APPROACHING_SLA' ? { reviewDueAt: { gte: new Date(),
        lte: new Date(Date.now() + Math.max(15, this.stuck.minutes('KYC_OPS_REVIEW_SLA_MINUTES') / 4) * 60_000) } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.kycWorkflowExecution.findMany({ where, select: { id: true, clientId: true, riderId: true,
        status: true, reviewPriority: true, reviewAssignedTo: true, reviewAssignedAt: true,
        reviewDueAt: true, reviewResolvedAt: true, reviewVersion: true, updatedAt: true,
        workflowDefinition: { select: { code: true, name: true } } },
        orderBy: [{ reviewDueAt: 'asc' }, { createdAt: 'asc' }], skip: this.page(filters.skip), take: 50 }),
      this.prisma.kycWorkflowExecution.count({ where }),
    ]);
    return { items: items.map((row) => ({ ...row, flags: this.stuck.workflowFlags({ ...row, expiresAt: null }) })),
      total, skip: this.page(filters.skip), pageSize: 50 };
  }

  async verificationDetail(id: string, clientId?: string, internal = false) {
    const row = await this.prisma.kycVerification.findFirst({ where: { id, clientId }, select: {
      id: true, clientId: true, riderId: true, verificationType: true, status: true, resultCode: true,
      consentId: true, recoveryVersion: true,
      resultSummary: true, requestedAt: true, startedAt: true, completedAt: true, expiresAt: true, updatedAt: true,
      finalProvider: { select: { id: true, code: true, name: true } },
      workflowStepExecution: { select: { workflowExecutionId: true, status: true,
        workflowStep: { select: { name: true, code: true } } } },
      routingDecision: { select: { routingPolicyVersion: true, strategy: true, selectedProviders: true,
        decisionReason: true, routingPolicy: { select: { code: true, name: true } } } },
      attempts: { select: { id: true, attemptNumber: true, status: true, reason: true, providerTransactionId: true,
        requestStartedAt: true, responseReceivedAt: true, latencyMs: true, normalizedStatus: true,
        failureType: true, failureCategory: true, failureCode: true, billable: true,
        ...(internal ? { cost: true, currency: true } : {}),
        provider: { select: { id: true, code: true, name: true } } }, orderBy: { attemptNumber: 'asc' } },
      providerConflicts: { select: { provider: { select: { code: true } }, resultStatus: true,
        conflictType: true, resolution: true, createdAt: true } },
      featureConsumption: { select: { id: true, source: true, quantity: true, occurredAt: true, reversedAt: true } },
    } });
    if (!row) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    const audit = await this.prisma.auditLog.findMany({ where: { clientId: row.clientId,
      OR: [{ entityType: 'KYC_VERIFICATION', entityId: id },
        { entityType: 'KYC_WORKFLOW', entityId: row.workflowStepExecution?.workflowExecutionId ?? '' }] },
      select: { id: true, action: true, actorId: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 });
    const timeline = [
      { id: `verification:${id}`, timestamp: row.requestedAt, category: 'VERIFICATION', eventType: 'CREATED', title: 'Verification requested' },
      ...row.attempts.map((attempt) => ({ id: `attempt:${attempt.id}`, timestamp: attempt.requestStartedAt,
        category: 'PROVIDER', eventType: attempt.reason, title: `${attempt.provider.code} attempt ${attempt.attemptNumber} started` })),
      ...row.attempts.filter((attempt) => attempt.responseReceivedAt).map((attempt) => ({ id: `result:${attempt.id}`,
        timestamp: attempt.responseReceivedAt!, category: 'PROVIDER', eventType: attempt.normalizedStatus,
        title: `${attempt.provider.code} returned ${attempt.normalizedStatus}` })),
      ...audit.map((event) => ({ id: `audit:${event.id}`, timestamp: event.createdAt, category: 'AUDIT',
        eventType: event.action, title: event.action, actorId: event.actorId })),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id));
    return { ...row, flags: this.stuck.verificationFlags(row), timeline };
  }

  async workflowDetail(id: string, clientId?: string) {
    const row = await this.prisma.kycWorkflowExecution.findFirst({ where: { id, clientId }, select: {
      id: true, clientId: true, riderId: true, status: true, workflowVersion: true,
      startedAt: true, completedAt: true, expiresAt: true, updatedAt: true, currentStepId: true,
      reviewPriority: true, reviewAssignedTo: true, reviewDueAt: true, reviewResolvedAt: true, reviewVersion: true,
      workflowDefinition: { select: { code: true, name: true, version: true,
        steps: { select: { id: true, code: true, name: true, sequence: true, isRequired: true },
          orderBy: { sequence: 'asc' } } } },
      stepExecutions: { select: { id: true, workflowStepId: true, status: true, startedAt: true, completedAt: true,
        verificationId: true, failureReason: true }, orderBy: { createdAt: 'asc' } },
      decisions: { select: { id: true, decision: true, reasonCode: true, ruleId: true, decidedAt: true,
        reviewerId: true }, orderBy: { decidedAt: 'asc' } },
      reconciliations: { select: { type: true, status: true, score: true } },
    } });
    if (!row) throw new NotFoundException('KYC_WORKFLOW_NOT_FOUND');
    const audit = await this.prisma.auditLog.findMany({ where: { clientId: row.clientId,
      entityType: 'KYC_WORKFLOW', entityId: id }, select: { id: true, action: true, actorId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 });
    const timeline = [
      { id: `workflow:${id}`, timestamp: row.startedAt, category: 'WORKFLOW', title: 'Workflow started' },
      ...row.stepExecutions.filter((step) => step.startedAt).map((step) => ({ id: `step:${step.id}`,
        timestamp: step.startedAt!, category: 'STEP', title: `${step.status} step started` })),
      ...row.decisions.map((decision) => ({ id: `decision:${decision.id}`, timestamp: decision.decidedAt,
        category: 'DECISION', title: `${decision.decision}: ${decision.reasonCode}` })),
      ...audit.map((event) => ({ id: `audit:${event.id}`, timestamp: event.createdAt,
        category: 'AUDIT', title: event.action, actorId: event.actorId })),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id));
    return { ...row, flags: this.stuck.workflowFlags(row),
      steps: row.workflowDefinition.steps.map((step) => ({ ...step,
        execution: row.stepExecutions.find((execution) => execution.workflowStepId === step.id) ?? null })), timeline };
  }

  audit(filters: OpsFilters & { action?: string; entityType?: string; entityId?: string; actorId?: string }) {
    const where: Prisma.AuditLogWhereInput = { clientId: filters.clientId,
      createdAt: { gte: this.since(filters.hours) },
      AND: [{ OR: [{ action: { startsWith: 'KYC_' } }, { action: { startsWith: 'WORKFLOW_' } },
        { action: { startsWith: 'MANUAL_REVIEW_' } }] }],
      entityType: filters.entityType && ['KYC_VERIFICATION', 'KYC_WORKFLOW', 'KYC_PROVIDER',
        'KYC_PROVIDER_CAPABILITY', 'KYC_OPERATIONAL_ALERT', 'FEATURE_USAGE_CONSUMPTION'].includes(filters.entityType)
        ? filters.entityType : undefined,
      action: filters.action ? { startsWith: filters.action.slice(0, 80) } : undefined,
      entityId: filters.entityId, actorId: filters.actorId };
    return Promise.all([
      this.prisma.auditLog.findMany({ where, select: { id: true, clientId: true, actorId: true,
        action: true, entityType: true, entityId: true, createdAt: true, requestId: true,
        previousData: true, newData: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: this.page(filters.skip), take: 50 }),
      this.prisma.auditLog.count({ where }),
    ]).then(([items, total]) => ({ items: items.map(({ previousData, newData, ...item }) => ({ ...item,
      id: item.id.toString(), previous: safeAuditValues(previousData), current: safeAuditValues(newData) })),
      total, skip: this.page(filters.skip), pageSize: 50 }));
  }
}
