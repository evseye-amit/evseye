import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { KycWorkflowStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { idempotencyFingerprint } from '../verification/kyc-security.js';
import type { Environment } from '../../config/environment.js';
import type { StartVerificationDto } from '../verification/verification.dto.js';
import { KycCommercialService } from '../commercial/kyc-commercial.service.js';
import { KycDecisionEngine } from './kyc-decision.service.js';
import { KycNameMatchService, KycReconciliationEngine } from './kyc-reconciliation.service.js';
import type { MatchThresholds } from './kyc-reconciliation.service.js';

const active: KycWorkflowStatus[] = ['CREATED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'WAITING', 'RECONCILING', 'DECISION_PENDING'];
function thresholds(value: Prisma.JsonValue | null): MatchThresholds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { strong: 80, partial: 50 };
  const strong = value.strong; const partial = value.partial;
  if (typeof strong !== 'number' || typeof partial !== 'number' || partial < 0 || strong > 100 || partial > strong)
    throw new BadRequestException('KYC_INVALID_MATCH_THRESHOLDS');
  return { strong, partial };
}

@Injectable()
export class KycWorkflowEngine {
  constructor(private readonly prisma: PrismaService, private readonly verification: VerificationService,
    private readonly reconciliation: KycReconciliationEngine, private readonly names: KycNameMatchService,
    private readonly decisions: KycDecisionEngine,
    private readonly audit: AuditService, private readonly config: ConfigService<Environment, true>,
    private readonly commercial: KycCommercialService) {}

  async start(clientId: string, riderId: string, code = 'RIDER_DEFAULT_KYC', key?: string, reverify = false) {
    if (!this.config.get('KYC_ENABLED')) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    if (key && (key.length < 8 || key.length > 128)) throw new BadRequestException('KYC_INVALID_IDEMPOTENCY_KEY');
    const secret = this.config.get('KYC_FINGERPRINT_SECRET');
    if (key && !secret) throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    const savedKey = key && secret ? idempotencyFingerprint(secret, clientId, key) : undefined;
    if (!await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } }))
      throw new NotFoundException('RIDER_NOT_FOUND');
    if (savedKey) {
      const prior = await this.prisma.kycWorkflowExecution.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: savedKey } },
        include: { workflowDefinition: { select: { code: true } } } });
      if (prior) {
        if (prior.riderId !== riderId || (code !== 'RIDER_DEFAULT_KYC' && prior.workflowDefinition.code !== code))
          throw new ConflictException('KYC_IDEMPOTENCY_CONFLICT');
        return this.get(clientId, prior.id);
      }
    }
    const definitionInclude = { steps: { where: { isActive: true }, orderBy: { sequence: 'asc' as const } } };
    const assignment = code === 'RIDER_DEFAULT_KYC' ? await this.prisma.kycClientPolicy.findFirst({ where: {
      clientId, status: 'ACTIVE', isEnabled: true, workflowDefinitionId: { not: null },
      effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
    }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }) : null;
    const assigned = assignment?.workflowDefinitionId ? await this.prisma.kycWorkflowDefinition.findFirst({ where: {
      id: assignment.workflowDefinitionId, status: 'ACTIVE', OR: [{ clientId }, { clientId: null }] }, include: definitionInclude }) : null;
    if (assignment?.workflowDefinitionId && !assigned) throw new BadRequestException('KYC_COMMERCIAL_CONFIGURATION_ERROR');
    const definition = assigned ?? await this.prisma.kycWorkflowDefinition.findFirst({ where: { code, status: 'ACTIVE', clientId },
      orderBy: { version: 'desc' }, include: definitionInclude }) ??
      await this.prisma.kycWorkflowDefinition.findFirst({ where: { code, status: 'ACTIVE', clientId: null },
        orderBy: { version: 'desc' }, include: definitionInclude });
    if (!definition || !definition.steps.length) throw new NotFoundException('KYC_WORKFLOW_DEFINITION_NOT_FOUND');
    if (definition.expiryMinutes < 1) throw new BadRequestException('KYC_INVALID_WORKFLOW_EXPIRY');
    for (const step of definition.steps) if (step.isRequired)
      await this.commercial.entitlement(clientId, step.verificationType);
    const existing = await this.prisma.kycWorkflowExecution.findFirst({ where: { clientId, riderId, status: { in: active } }, orderBy: { startedAt: 'desc' } });
    if (existing) {
      if (reverify || existing.workflowDefinitionId !== definition.id) throw new ConflictException('KYC_ACTIVE_WORKFLOW_EXISTS');
      return this.get(clientId, existing.id);
    }
    const previous = await this.prisma.kycWorkflowExecution.findFirst({ where: { clientId, riderId }, orderBy: { startedAt: 'desc' }, select: { id: true } });
    let id: string;
    try {
      const execution = await this.prisma.$transaction(async (tx) => {
        const created = await tx.kycWorkflowExecution.create({ data: { clientId, riderId, workflowDefinitionId: definition.id,
          workflowVersion: definition.version, status: 'ACTION_REQUIRED', currentStepId: definition.steps[0].id,
          previousWorkflowExecutionId: previous?.id, idempotencyKey: savedKey,
          expiresAt: new Date(Date.now() + definition.expiryMinutes * 60 * 1000) } });
        await tx.kycWorkflowStepExecution.create({ data: { workflowExecutionId: created.id, workflowStepId: definition.steps[0].id,
          status: 'ACTION_REQUIRED', startedAt: new Date() } });
        return created;
      });
      id = execution.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && savedKey) {
        const duplicate = await this.prisma.kycWorkflowExecution.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: savedKey } },
          include: { workflowDefinition: { select: { code: true } } } });
        if (duplicate) {
          if (duplicate.riderId !== riderId || (code !== 'RIDER_DEFAULT_KYC' && duplicate.workflowDefinition.code !== code))
            throw new ConflictException('KYC_IDEMPOTENCY_CONFLICT');
          return this.get(clientId, duplicate.id);
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.prisma.kycWorkflowExecution.findFirst({ where: { clientId, riderId, status: { in: active } } });
        if (concurrent && !reverify) return this.get(clientId, concurrent.id);
        if (concurrent) throw new ConflictException('KYC_ACTIVE_WORKFLOW_EXISTS');
      }
      throw error;
    }
    await this.audit.record({ clientId, action: 'WORKFLOW_STARTED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { riderId, workflowDefinitionId: definition.id, version: definition.version } });
    await this.audit.record({ clientId, action: 'WORKFLOW_ACTION_REQUIRED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { stepCode: definition.steps[0].code } });
    return this.get(clientId, id);
  }

  async submitStep(clientId: string, id: string, dto: StartVerificationDto) {
    const workflow = await this.get(clientId, id);
    if (workflow.status !== 'ACTION_REQUIRED' || !workflow.currentStepId) throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
    const step = workflow.workflowDefinition.steps.find((item) => item.id === workflow.currentStepId);
    if (!step || step.verificationType !== dto.type || workflow.riderId !== dto.riderId) throw new BadRequestException('KYC_WORKFLOW_STEP_INPUT_MISMATCH');
    const comparisons: { type: string; sourceA: string; sourceB: string; status: string; score: number | null }[] = [];
    if (dto.type === 'PAN_VERIFICATION') {
      const rider = await this.prisma.rider.findUniqueOrThrow({ where: { id: workflow.riderId }, select: { name: true, dateOfBirth: true } });
      const name = this.names.compare(rider.name, dto.name, thresholds(workflow.workflowDefinition.matchThresholds));
      const dob = this.reconciliation.compareDob(rider.dateOfBirth, dto.dateOfBirth ?
        `${dto.dateOfBirth.slice(6)}-${dto.dateOfBirth.slice(3, 5)}-${dto.dateOfBirth.slice(0, 2)}` : null);
      comparisons.push(
        { type: 'RIDER_NAME_VS_PAN', sourceA: 'RIDER', sourceB: 'PAN_SUBMISSION', status: name.status, score: name.score },
        { type: 'DOB_MATCH', sourceA: 'RIDER', sourceB: 'PAN_SUBMISSION', status: dob, score: null },
      );
    }
    const stepExecution = workflow.stepExecutions.find((item) => item.workflowStepId === step.id);
    if (!stepExecution || stepExecution.verificationId) throw new ConflictException('KYC_WORKFLOW_STEP_ALREADY_STARTED');
    const claimed = await this.prisma.kycWorkflowStepExecution.updateMany({ where: { id: stepExecution.id, status: 'ACTION_REQUIRED', verificationId: null },
      data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('KYC_WORKFLOW_STEP_ALREADY_STARTED');
    const moved = await this.prisma.kycWorkflowExecution.updateMany({ where: { id, clientId, status: 'ACTION_REQUIRED', expiresAt: { gt: new Date() } }, data: { status: 'IN_PROGRESS' } });
    if (!moved.count) {
      await this.prisma.kycWorkflowStepExecution.updateMany({ where: { id: stepExecution.id, status: 'IN_PROGRESS', verificationId: null }, data: { status: 'ACTION_REQUIRED' } });
      throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
    }
    await this.audit.record({ clientId, action: 'WORKFLOW_STEP_STARTED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { stepCode: step.code } });
    try {
      const verification = await this.verification.start(clientId, `workflow:${stepExecution.id}`, dto);
      await this.prisma.$transaction(async (tx) => {
        for (const result of comparisons) await tx.kycReconciliationResult.upsert({ where: { workflowExecutionId_type: { workflowExecutionId: id, type: result.type } },
          create: { workflowExecutionId: id, ...result }, update: { status: result.status, score: result.score } });
        await tx.kycWorkflowStepExecution.update({ where: { id: stepExecution.id }, data: { verificationId: verification.id } });
      });
      await this.syncVerification(clientId, verification.id);
      return this.get(clientId, id);
    } catch (error) {
      await this.prisma.kycWorkflowStepExecution.updateMany({ where: { id: stepExecution.id, status: 'IN_PROGRESS', verificationId: null }, data: { status: 'ACTION_REQUIRED' } });
      await this.prisma.kycWorkflowExecution.updateMany({ where: { id, clientId, status: 'IN_PROGRESS' }, data: { status: 'ACTION_REQUIRED' } });
      throw error;
    }
  }

  async syncVerification(clientId: string, verificationId: string) {
    const step = await this.prisma.kycWorkflowStepExecution.findFirst({ where: { verificationId, workflowExecution: { clientId } },
      include: { verification: true, workflowStep: true, workflowExecution: true } });
    if (!step || !step.verification || !['IN_PROGRESS', 'ACTION_REQUIRED'].includes(step.status)) return false;
    const status = step.verification.status;
    if (status === 'OTP_REQUIRED' || status === 'ACTION_REQUIRED') {
      const actionRequired = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.kycWorkflowStepExecution.updateMany({ where: { id: step.id, status: 'IN_PROGRESS' }, data: { status: 'ACTION_REQUIRED' } });
        if (changed.count) {
          const workflowChanged = await tx.kycWorkflowExecution.updateMany({ where: { id: step.workflowExecutionId, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } }, data: { status: 'ACTION_REQUIRED' } });
          if (!workflowChanged.count) throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
        }
        return !!changed.count;
      });
      if (actionRequired) await this.audit.record({ clientId, action: 'WORKFLOW_ACTION_REQUIRED',
        entityType: 'KYC_WORKFLOW', entityId: step.workflowExecutionId, newData: { stepCode: step.workflowStep.code } });
      return actionRequired;
    }
    if (!['VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED', 'PARTIALLY_VERIFIED', 'MANUAL_REVIEW'].includes(status)) return false;
    const successful = status === 'VERIFIED';
    const failure = !successful && (step.workflowStep.isRequired || step.workflowStep.failureBehavior !== 'CONTINUE');
    const next = await this.prisma.kycWorkflowStep.findFirst({ where: { workflowDefinitionId: step.workflowExecution.workflowDefinitionId,
      isActive: true, sequence: { gt: step.workflowStep.sequence } }, orderBy: { sequence: 'asc' } });
    const now = new Date();
    const advanced = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kycWorkflowStepExecution.updateMany({ where: { id: step.id, status: { in: ['IN_PROGRESS', 'ACTION_REQUIRED'] } },
        data: { status: successful ? 'VERIFIED' : 'FAILED', completedAt: now, failureReason: successful ? null : step.verification?.resultCode ?? status } });
      if (!updated.count) return null;
      const terminal = failure && step.workflowStep.failureBehavior === 'STOP_WORKFLOW';
      const review = failure && step.workflowStep.failureBehavior === 'MANUAL_REVIEW';
      if (!terminal && !review && next) {
        await tx.kycWorkflowStepExecution.create({ data: { workflowExecutionId: step.workflowExecutionId, workflowStepId: next.id,
          status: 'ACTION_REQUIRED', startedAt: now } });
        const workflowChanged = await tx.kycWorkflowExecution.updateMany({ where: { id: step.workflowExecutionId, status: { in: active }, expiresAt: { gt: now } },
          data: { status: 'ACTION_REQUIRED', currentStepId: next.id } });
        if (!workflowChanged.count) throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
      } else {
        const workflowChanged = await tx.kycWorkflowExecution.updateMany({ where: { id: step.workflowExecutionId, status: { in: active }, expiresAt: { gt: now } },
          data: { status: 'RECONCILING', currentStepId: null } });
        if (!workflowChanged.count) throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
      }
      return !next || terminal || review;
    });
    if (advanced === null) return false;
    await this.audit.record({ clientId, action: 'WORKFLOW_STEP_COMPLETED', entityType: 'KYC_WORKFLOW', entityId: step.workflowExecutionId,
      newData: { stepCode: step.workflowStep.code, status: successful ? 'VERIFIED' : 'FAILED' } });
    if (!advanced && next) await this.audit.record({ clientId, action: 'WORKFLOW_ACTION_REQUIRED', entityType: 'KYC_WORKFLOW',
      entityId: step.workflowExecutionId, newData: { stepCode: next.code } });
    if (advanced) await this.finalize(clientId, step.workflowExecutionId);
    return true;
  }

  async finalize(clientId: string, id: string) {
    const workflow = await this.get(clientId, id);
    if (workflow.status !== 'RECONCILING' && workflow.status !== 'DECISION_PENDING') return workflow;
    const rider = await this.prisma.rider.findUniqueOrThrow({ where: { id: workflow.riderId }, select: { name: true, dateOfBirth: true } });
    // Phase 1 retains match booleans, not provider names or DOB. Unknown comparisons remain UNKNOWN.
    const results = this.reconciliation.reconcile({ riderName: rider.name, riderDob: rider.dateOfBirth,
      thresholds: thresholds(workflow.workflowDefinition.matchThresholds) });
    const existing = await this.prisma.kycReconciliationResult.findMany({ where: { workflowExecutionId: id } });
    const combined = [...existing.map((result) => ({ type: result.type, sourceA: result.sourceA, sourceB: result.sourceB,
      status: result.status, score: result.score })), ...results.filter((result) => !existing.some((item) => item.type === result.type))];
    const rules = await this.prisma.kycDecisionRule.findMany({ where: { workflowDefinitionId: workflow.workflowDefinitionId, isActive: true } });
    const decision = this.decisions.decide({ steps: workflow.stepExecutions.map((item) => ({ required: item.workflowStep.isRequired, status: item.status })),
      reconciliations: combined }, rules);
    const created = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.kycWorkflowExecution.updateMany({ where: { id, clientId, status: { in: ['RECONCILING', 'DECISION_PENDING'] }, expiresAt: { gt: new Date() } },
        data: { status: decision.decision === 'PENDING' ? 'DECISION_PENDING' : decision.decision,
          completedAt: decision.decision === 'PENDING' || decision.decision === 'MANUAL_REVIEW' ? null : new Date(),
          reviewDueAt: decision.decision === 'MANUAL_REVIEW'
            ? new Date(Date.now() + this.config.get('KYC_OPS_REVIEW_SLA_MINUTES') * 60_000) : null } });
      if (!changed.count) return false;
      for (const result of combined) await tx.kycReconciliationResult.upsert({ where: { workflowExecutionId_type: { workflowExecutionId: id, type: result.type } },
        create: { workflowExecutionId: id, ...result }, update: {} });
      await tx.kycDecision.create({ data: { workflowExecutionId: id, ...decision,
        summary: this.decisions.explain(decision.reasonCode) } });
      return true;
    });
    if (!created) return this.get(clientId, id);
    await this.audit.record({ clientId, action: 'RECONCILIATION_COMPLETED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { comparisons: combined.length, mismatches: combined.filter((item) => item.status === 'MISMATCH').length } });
    await this.audit.record({ clientId, action: 'DECISION_CREATED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { decision: decision.decision, reasonCode: decision.reasonCode } });
    if (decision.decision === 'MANUAL_REVIEW') await this.audit.record({ clientId, action: 'MANUAL_REVIEW_CREATED',
      entityType: 'KYC_WORKFLOW', entityId: id, newData: { reasonCode: decision.reasonCode } });
    else if (decision.decision !== 'PENDING') await this.audit.record({ clientId, action: 'WORKFLOW_COMPLETED',
      entityType: 'KYC_WORKFLOW', entityId: id, newData: { status: decision.decision } });
    return this.get(clientId, id);
  }

  async review(clientId: string, id: string, reviewerId: string, approve: boolean, reason: string, expectedVersion?: number) {
    if (reason.trim().length < 5) throw new BadRequestException('KYC_REVIEW_REASON_REQUIRED');
    if (/\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{12,}\b/i.test(reason)) throw new BadRequestException('KYC_REVIEW_REASON_CONTAINS_IDENTIFIER');
    const outcome = approve ? 'VERIFIED' : 'REJECTED';
    const changed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kycWorkflowExecution.updateMany({ where: { id, clientId, status: 'MANUAL_REVIEW',
        reviewVersion: expectedVersion, OR: [{ reviewAssignedTo: null }, { reviewAssignedTo: reviewerId }] },
        data: { status: outcome, completedAt: new Date(), reviewResolvedAt: new Date(), reviewVersion: { increment: 1 } } });
      if (updated.count) await tx.kycDecision.create({ data: { workflowExecutionId: id, decision: outcome,
        reasonCode: approve ? 'MANUAL_REVIEW_APPROVED' : 'MANUAL_REVIEW_REJECTED', summary: reason.trim(), reviewerId } });
      return updated.count;
    });
    if (!changed) throw new ConflictException('KYC_REVIEW_ALREADY_RESOLVED');
    await this.audit.record({ clientId, actorId: reviewerId, action: approve ? 'MANUAL_REVIEW_APPROVED' : 'MANUAL_REVIEW_REJECTED',
      entityType: 'KYC_WORKFLOW', entityId: id, previousData: { status: 'MANUAL_REVIEW' }, newData: { status: outcome, reason: reason.trim() } });
    await this.audit.record({ clientId, actorId: reviewerId, action: 'WORKFLOW_COMPLETED', entityType: 'KYC_WORKFLOW', entityId: id,
      newData: { status: outcome } });
    return this.get(clientId, id);
  }

  async get(clientId: string, id: string) {
    const workflow = await this.prisma.kycWorkflowExecution.findFirst({ where: { id, clientId }, include: {
      workflowDefinition: { include: { steps: { orderBy: { sequence: 'asc' } } } },
      stepExecutions: { include: { workflowStep: true, verification: { select: { id: true, status: true, resultCode: true, completedAt: true,
        results: { select: { status: true, normalizedData: true } } } } }, orderBy: { createdAt: 'asc' } },
      reconciliations: true, decisions: { orderBy: { decidedAt: 'asc' } }, rider: { select: { id: true, name: true } },
    } });
    if (!workflow) throw new NotFoundException('KYC_WORKFLOW_NOT_FOUND');
    const auditTimeline = await this.prisma.auditLog.findMany({ where: { clientId, entityType: 'KYC_WORKFLOW', entityId: id },
      select: { id: true, action: true, actorId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100 });
    return { ...workflow, auditTimeline };
  }

  list(clientId: string, status?: KycWorkflowStatus, skip = 0, workflowCode?: string, startedFrom?: Date, startedTo?: Date) {
    return this.prisma.kycWorkflowExecution.findMany({ where: { clientId, status,
      workflowDefinition: workflowCode ? { code: workflowCode } : undefined,
      startedAt: startedFrom || startedTo ? { gte: startedFrom, lte: startedTo } : undefined }, select: { id: true, riderId: true,
      rider: { select: { name: true } }, clientId: true, workflowVersion: true, status: true, currentStepId: true,
      startedAt: true, completedAt: true, workflowDefinition: { select: { code: true, name: true } },
      stepExecutions: { select: { status: true, workflowStep: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: 10 },
      decisions: { select: { decision: true, reasonCode: true, decidedAt: true }, orderBy: { decidedAt: 'desc' }, take: 1 } },
      orderBy: { startedAt: 'desc' }, skip: Math.max(0, skip), take: 50 });
  }

  definitions(clientId: string) {
    return this.prisma.kycWorkflowDefinition.findMany({ where: { OR: [{ clientId }, { clientId: null }] }, include: {
      steps: { orderBy: { sequence: 'asc' } }, rules: { orderBy: [{ priority: 'asc' }, { code: 'asc' }] } },
      orderBy: [{ code: 'asc' }, { version: 'desc' }] });
  }

  async definition(clientId: string, id: string) {
    const definition = await this.prisma.kycWorkflowDefinition.findFirst({ where: { id, OR: [{ clientId }, { clientId: null }] },
      include: { steps: { orderBy: { sequence: 'asc' } }, rules: { orderBy: [{ priority: 'asc' }, { code: 'asc' }] } } });
    if (!definition) throw new NotFoundException('KYC_WORKFLOW_DEFINITION_NOT_FOUND');
    return definition;
  }

  async riderStatus(clientId: string, riderId: string) {
    if (!await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } }))
      throw new NotFoundException('RIDER_NOT_FOUND');
    const latest = await this.prisma.kycWorkflowExecution.findFirst({ where: { clientId, riderId }, orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true } });
    return { riderId, status: latest?.status ?? 'NOT_STARTED', workflowExecutionId: latest?.id ?? null };
  }

  async currentForRider(clientId: string, riderId: string) {
    if (!await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } }))
      throw new NotFoundException('RIDER_NOT_FOUND');
    const latest = await this.prisma.kycWorkflowExecution.findFirst({ where: { clientId, riderId }, orderBy: { startedAt: 'desc' }, select: { id: true } });
    return latest ? this.get(clientId, latest.id) : null;
  }

  @Cron('*/5 * * * *')
  async recover() {
    const secret = this.config.get('KYC_FINGERPRINT_SECRET');
    const unlinked = await this.prisma.kycWorkflowStepExecution.findMany({ where: { status: 'IN_PROGRESS', verificationId: null,
      startedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, workflowExecution: { status: 'IN_PROGRESS' } },
      include: { workflowStep: true, workflowExecution: { select: { clientId: true, riderId: true } } }, take: 100 });
    for (const item of unlinked) {
      const clientId = item.workflowExecution.clientId;
      const idempotencyKey = secret ? idempotencyFingerprint(secret, clientId, `workflow:${item.id}`) : null;
      const verification = idempotencyKey ? await this.prisma.kycVerification.findUnique({ where: {
        clientId_idempotencyKey: { clientId, idempotencyKey } } }) : null;
      if (verification && verification.riderId === item.workflowExecution.riderId && verification.verificationType === item.workflowStep.verificationType) {
        const linked = await this.prisma.kycWorkflowStepExecution.updateMany({ where: { id: item.id, status: 'IN_PROGRESS', verificationId: null },
          data: { verificationId: verification.id } });
        if (linked.count) {
          await this.syncVerification(clientId, verification.id);
          await this.audit.record({ clientId, action: 'WORKFLOW_RECOVERED', entityType: 'KYC_WORKFLOW', entityId: item.workflowExecutionId,
            newData: { stepCode: item.workflowStep.code, recovery: 'VERIFICATION_RELINKED' } });
        }
      } else if (!verification && secret) {
        const reset = await this.prisma.$transaction(async (tx) => {
          const stepReset = await tx.kycWorkflowStepExecution.updateMany({ where: { id: item.id, status: 'IN_PROGRESS', verificationId: null },
            data: { status: 'ACTION_REQUIRED' } });
          if (!stepReset.count) return false;
          const workflowReset = await tx.kycWorkflowExecution.updateMany({ where: { id: item.workflowExecutionId, status: 'IN_PROGRESS' },
            data: { status: 'ACTION_REQUIRED' } });
          if (!workflowReset.count) throw new ConflictException('KYC_WORKFLOW_INVALID_STATE');
          return true;
        });
        if (reset) await this.audit.record({ clientId, action: 'WORKFLOW_RECOVERED', entityType: 'KYC_WORKFLOW', entityId: item.workflowExecutionId,
          newData: { stepCode: item.workflowStep.code, recovery: 'ACTION_RESTORED' } });
      }
    }
    const expired = await this.prisma.kycWorkflowExecution.findMany({ where: { status: { in: active }, expiresAt: { lt: new Date() } },
      select: { id: true, clientId: true }, take: 100 });
    for (const item of expired) {
      const changed = await this.prisma.kycWorkflowExecution.updateMany({ where: { id: item.id, status: { in: active }, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED', completedAt: new Date() } });
      if (changed.count) await this.audit.record({ clientId: item.clientId, action: 'WORKFLOW_EXPIRED', entityType: 'KYC_WORKFLOW', entityId: item.id });
    }
    const pending = await this.prisma.kycWorkflowStepExecution.findMany({ where: { status: { in: ['IN_PROGRESS', 'ACTION_REQUIRED'] }, verificationId: { not: null },
      workflowExecution: { status: { in: active } }, verification: { status: { in: ['VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED', 'OTP_REQUIRED'] } } },
      select: { verificationId: true, workflowExecution: { select: { clientId: true } } }, take: 100 });
    for (const item of pending) if (item.verificationId) {
      if (await this.syncVerification(item.workflowExecution.clientId, item.verificationId))
        await this.audit.record({ clientId: item.workflowExecution.clientId, action: 'WORKFLOW_RECOVERED', entityType: 'KYC_VERIFICATION', entityId: item.verificationId });
    }
  }
}
