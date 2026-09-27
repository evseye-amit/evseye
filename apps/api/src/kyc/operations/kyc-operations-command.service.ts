import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service.js';
import type { Environment } from '../../config/environment.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycWorkflowEngine } from '../workflow/kyc-workflow.service.js';
import { VerificationService } from '../verification/verification.service.js';
import type { StartVerificationDto } from '../verification/verification.dto.js';

@Injectable()
export class KycOperationsCommandService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly config: ConfigService<Environment, true>, private readonly workflow: KycWorkflowEngine,
    private readonly verification: VerificationService) {}

  private reason(value: string) {
    const reason = value?.trim();
    if (!reason || reason.length < 5 || reason.length > 500) throw new BadRequestException('KYC_OPERATION_REASON_REQUIRED');
    if (/\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{12,}\b/i.test(reason))
      throw new BadRequestException('KYC_OPERATION_REASON_CONTAINS_IDENTIFIER');
    return reason;
  }

  async assign(clientId: string, id: string, actorId: string, assignedTo: string | null,
    expectedVersion: number, reasonValue: string, allowOverride = false) {
    const reason = this.reason(reasonValue);
    if (assignedTo && !await this.prisma.user.findFirst({ where: { id: assignedTo, clientId,
      role: { in: ['CLIENT_ADMIN', 'KYC_OPERATOR'] }, isActive: true, deletedAt: null }, select: { id: true } }))
      throw new BadRequestException('KYC_REVIEW_ASSIGNEE_INVALID');
    const prior = await this.prisma.kycWorkflowExecution.findFirst({ where: { id, clientId },
      select: { reviewAssignedTo: true, reviewVersion: true, status: true } });
    if (!prior) throw new NotFoundException('KYC_WORKFLOW_NOT_FOUND');
    if (!allowOverride && prior.reviewAssignedTo && prior.reviewAssignedTo !== actorId)
      throw new ConflictException('KYC_REVIEW_ASSIGNED_TO_OTHER');
    const changed = await this.prisma.kycWorkflowExecution.updateMany({ where: { id, clientId,
      status: 'MANUAL_REVIEW', reviewVersion: expectedVersion }, data: { reviewAssignedTo: assignedTo,
      reviewAssignedAt: assignedTo ? new Date() : null, reviewVersion: { increment: 1 } } });
    if (!changed.count) throw new ConflictException('KYC_REVIEW_STALE_OR_RESOLVED');
    await this.audit.record({ clientId, actorId, action: 'MANUAL_REVIEW_ASSIGNED', entityType: 'KYC_WORKFLOW', entityId: id,
      previousData: { assignedTo: prior.reviewAssignedTo, version: expectedVersion },
      newData: { assignedTo, version: expectedVersion + 1, reason } });
    return { id, assignedTo, version: expectedVersion + 1 };
  }

  async priority(clientId: string, id: string, actorId: string, priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL',
    expectedVersion: number, reasonValue: string) {
    const reason = this.reason(reasonValue);
    const prior = await this.prisma.kycWorkflowExecution.findFirst({ where: { id, clientId },
      select: { reviewPriority: true } });
    if (!prior) throw new NotFoundException('KYC_WORKFLOW_NOT_FOUND');
    const changed = await this.prisma.kycWorkflowExecution.updateMany({ where: { id, clientId,
      status: 'MANUAL_REVIEW', reviewVersion: expectedVersion },
      data: { reviewPriority: priority, reviewVersion: { increment: 1 } } });
    if (!changed.count) throw new ConflictException('KYC_REVIEW_STALE_OR_RESOLVED');
    await this.audit.record({ clientId, actorId, action: 'MANUAL_REVIEW_PRIORITY_CHANGED',
      entityType: 'KYC_WORKFLOW', entityId: id, previousData: { priority: prior.reviewPriority },
      newData: { priority, reason, version: expectedVersion + 1 } });
    return { id, priority, version: expectedVersion + 1 };
  }

  async review(clientId: string, id: string, actorId: string, action: 'APPROVE' | 'REJECT',
    expectedVersion: number, reasonValue: string) {
    return this.workflow.review(clientId, id, actorId, action === 'APPROVE', this.reason(reasonValue), expectedVersion);
  }

  retryPreview(clientId: string, id: string) { return this.verification.retryPreview(clientId, id); }

  async retry(clientId: string, id: string, actorId: string, key: string,
    input: StartVerificationDto, expectedVersion: number, reasonValue: string) {
    const reason = this.reason(reasonValue);
    const result = await this.verification.retry(clientId, id, key, input, expectedVersion);
    if (!result.replayed) await this.audit.record({ clientId, actorId, action: 'KYC_TECHNICAL_RETRY_EXECUTED',
      entityType: 'KYC_VERIFICATION', entityId: id, newData: { reason, status: result.verification.status,
        recoveryVersion: expectedVersion + 1 } });
    return result.verification;
  }

  async recoveryPreview(clientId: string, workflowId: string) {
    const workflow = await this.prisma.kycWorkflowExecution.findFirst({ where: { id: workflowId, clientId },
      select: { id: true, status: true, reviewVersion: true, expiresAt: true, stepExecutions: { select: { verificationId: true,
        verification: { select: { status: true } } } } } });
    if (!workflow) throw new NotFoundException('KYC_WORKFLOW_NOT_FOUND');
    const terminal = workflow.stepExecutions.some((step) => step.verification &&
      ['VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED'].includes(step.verification.status));
    const allowed = ['WAITING', 'RECONCILING', 'DECISION_PENDING', 'IN_PROGRESS'].includes(workflow.status) && terminal &&
      (!workflow.expiresAt || workflow.expiresAt > new Date());
    return { action: 'RESUME_WORKFLOW', allowed,
      reason: allowed ? 'Reconcile recorded verification results through the workflow engine.' :
        'No completed verification is waiting for workflow reconciliation.',
      expectedEffect: 'Existing workflow state may advance; no provider call is made.',
      newProviderCallPossible: false, newClientUsagePossible: false, newVendorCostPossible: false,
      expectedVersion: workflow.reviewVersion };
  }

  async resume(clientId: string, workflowId: string, actorId: string, expectedVersion: number, reasonValue: string) {
    const reason = this.reason(reasonValue);
    const preview = await this.recoveryPreview(clientId, workflowId);
    if (!preview.allowed || preview.expectedVersion !== expectedVersion) throw new ConflictException('KYC_RECOVERY_NOT_AVAILABLE');
    const claim = await this.prisma.kycWorkflowExecution.updateMany({ where: { id: workflowId, clientId,
      reviewVersion: expectedVersion, status: { in: ['WAITING', 'RECONCILING', 'DECISION_PENDING', 'IN_PROGRESS'] } },
      data: { reviewVersion: { increment: 1 } } });
    if (!claim.count) throw new ConflictException('KYC_RECOVERY_STALE');
    const steps = await this.prisma.kycWorkflowStepExecution.findMany({ where: { workflowExecutionId: workflowId,
      verificationId: { not: null } }, select: { verificationId: true } });
    let progressed = false;
    for (const step of steps) if (step.verificationId) progressed = await this.workflow.syncVerification(clientId, step.verificationId) || progressed;
    const beforeFinalize = await this.prisma.kycWorkflowExecution.findUniqueOrThrow({ where: { id: workflowId },
      select: { status: true } });
    if (['RECONCILING', 'DECISION_PENDING'].includes(beforeFinalize.status)) {
      const finalized = await this.workflow.finalize(clientId, workflowId);
      progressed = finalized.status !== beforeFinalize.status || progressed;
    }
    const result = await this.prisma.kycWorkflowExecution.findUniqueOrThrow({ where: { id: workflowId },
      select: { id: true, status: true, reviewVersion: true } });
    await this.audit.record({ clientId, actorId, action: 'KYC_WORKFLOW_RESUMED', entityType: 'KYC_WORKFLOW',
      entityId: workflowId, newData: { reason, progressed, status: result.status, version: result.reviewVersion } });
    return { ...result, progressed };
  }

  async providerState(providerId: string, actorId: string, enabled: boolean, reasonValue: string,
    capability?: string) {
    const reason = this.reason(reasonValue);
    const provider = await this.prisma.kycProviderConfig.findUnique({ where: { id: providerId },
      select: { id: true, isActive: true, capabilities: { select: { id: true, verificationType: true, isEnabled: true } } } });
    if (!provider) throw new NotFoundException('KYC_PROVIDER_NOT_FOUND');
    if (capability) {
      const row = provider.capabilities.find((item) => item.verificationType === capability);
      if (!row) throw new NotFoundException('KYC_CAPABILITY_NOT_FOUND');
      await this.prisma.kycProviderCapability.update({ where: { id: row.id }, data: { isEnabled: enabled } });
      await this.audit.record({ actorId, action: enabled ? 'KYC_CAPABILITY_ENABLED' : 'KYC_CAPABILITY_DISABLED',
        entityType: 'KYC_PROVIDER_CAPABILITY', entityId: row.id, previousData: { enabled: row.isEnabled },
        newData: { enabled, reason, providerId, capability } });
      return { providerId, capability, enabled };
    }
    await this.prisma.kycProviderConfig.update({ where: { id: providerId }, data: { isActive: enabled } });
    await this.audit.record({ actorId, action: enabled ? 'KYC_PROVIDER_ENABLED' : 'KYC_PROVIDER_DISABLED',
      entityType: 'KYC_PROVIDER', entityId: providerId, previousData: { enabled: provider.isActive },
      newData: { enabled, reason } });
    return { providerId, enabled };
  }
}
