import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../../audit/audit.service.js';
import type { Environment } from '../../config/environment.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycStuckDetectionService } from './kyc-stuck-detection.service.js';
import { KycSlaAnalyticsService } from '../analytics/kyc-sla-analytics.service.js';

@Injectable()
export class KycOperationalAlertService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly stuck: KycStuckDetectionService, private readonly config: ConfigService<Environment, true>,
    private readonly sla: KycSlaAnalyticsService) {}

  private async observe(type: string, severity: string, clientId: string | null, entityId: string,
    providerId?: string, capability?: string) {
    const dedupeKey = [type, clientId ?? 'GLOBAL', entityId, providerId ?? '', capability ?? ''].join(':');
    const alert = await this.prisma.kycOperationalAlert.upsert({ where: { dedupeKey },
      create: { dedupeKey, type, severity, clientId, entityId, providerId, capability },
      update: { lastSeenAt: new Date(), occurrenceCount: { increment: 1 } } });
    if (alert.status === 'RESOLVED') await this.prisma.kycOperationalAlert.updateMany({
      where: { id: alert.id, status: 'RESOLVED' }, data: { status: 'OPEN', resolvedAt: null,
        acknowledgedAt: null, acknowledgedBy: null } });
  }

  private async resolveRecoveredProvider(providerId: string, capability: string) {
    const dedupeKey = ['HIGH_TECHNICAL_FAILURE_RATE', 'GLOBAL', providerId, providerId, capability].join(':');
    const existing = await this.prisma.kycOperationalAlert.findUnique({ where: { dedupeKey },
      select: { id: true, status: true } });
    if (!existing || existing.status === 'RESOLVED') return;
    const changed = await this.prisma.kycOperationalAlert.updateMany({ where: { id: existing.id,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    if (changed.count) await this.audit.record({ action: 'KYC_ALERT_AUTO_RESOLVED', entityType: 'KYC_OPERATIONAL_ALERT',
      entityId: existing.id, newData: { providerId, capability, reason: 'TECHNICAL_FAILURE_RATE_RECOVERED' } });
  }

  @Cron('*/5 * * * *')
  async scan() {
    const now = new Date();
    const stuckAt = this.stuck.cutoff(this.stuck.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES'), now);
    const reviewAt = this.stuck.cutoff(this.stuck.minutes('KYC_OPS_REVIEW_SLA_MINUTES'), now);
    const [verifications, workflows, overdue, exhausted, providers] = await Promise.all([
      this.prisma.kycVerification.findMany({ where: { status: { in: ['CREATED', 'PROCESSING'] }, updatedAt: { lt: stuckAt } },
        select: { id: true, clientId: true }, take: 500 }),
      this.prisma.kycWorkflowExecution.findMany({ where: { status: { in: ['CREATED', 'IN_PROGRESS', 'WAITING', 'RECONCILING', 'DECISION_PENDING'] },
        updatedAt: { lt: stuckAt } }, select: { id: true, clientId: true }, take: 500 }),
      this.prisma.kycWorkflowExecution.findMany({ where: { status: 'MANUAL_REVIEW', OR: [
        { reviewDueAt: { lt: now } }, { reviewDueAt: null, updatedAt: { lt: reviewAt } }] },
        select: { id: true, clientId: true }, take: 500 }),
      this.prisma.kycVerification.findMany({ where: { status: 'FAILED',
        attempts: { some: { reason: 'FALLBACK', failureType: 'TECHNICAL_FAILURE' } },
        updatedAt: { gte: this.stuck.cutoff(5, now) } }, select: { id: true, clientId: true }, take: 500 }),
      this.prisma.kycProviderConfig.findMany({ where: { isActive: true }, select: { id: true, code: true,
        capabilities: { where: { isEnabled: true }, select: { verificationType: true } } } }),
    ]);
    await Promise.all([
      ...verifications.map((row) => this.observe('STUCK_VERIFICATION', 'WARNING', row.clientId, row.id)),
      ...workflows.map((row) => this.observe('STUCK_WORKFLOW', 'WARNING', row.clientId, row.id)),
      ...overdue.map((row) => this.observe('MANUAL_REVIEW_OVERDUE', 'WARNING', row.clientId, row.id)),
      ...exhausted.map((row) => this.observe('ROUTING_EXHAUSTED', 'WARNING', row.clientId, row.id)),
    ]);
    const windowStart = this.stuck.cutoff(5, now);
    for (const provider of providers) for (const capability of provider.capabilities) {
      const where = { providerId: provider.id, requestStartedAt: { gte: windowStart },
        verification: { verificationType: capability.verificationType } };
      const [total, technical] = await Promise.all([
        this.prisma.kycVerificationAttempt.count({ where }),
        this.prisma.kycVerificationAttempt.count({ where: { ...where, failureType: 'TECHNICAL_FAILURE' } }),
      ]);
      if (total >= this.config.get('KYC_OPS_ALERT_MIN_SAMPLES')) {
        if (technical * 100 / total >= this.config.get('KYC_OPS_ALERT_TECHNICAL_RATE_PERCENT'))
          await this.observe('HIGH_TECHNICAL_FAILURE_RATE', 'WARNING', null,
            provider.id, provider.id, capability.verificationType);
        else await this.resolveRecoveredProvider(provider.id, capability.verificationType);
      }
    }
    const sla = await this.sla.evaluate({ from: new Date(now.getTime() - 86400000).toISOString(), to: now.toISOString() });
    for (const metric of sla.rows) {
      const dedupeKey = ['PROVIDER_SLA_BREACH', 'GLOBAL', metric.policyId, metric.providerId, metric.metric].join(':');
      if (metric.status === 'BREACHED')
        await this.observe('PROVIDER_SLA_BREACH', 'WARNING', null, metric.policyId, metric.providerId, metric.metric);
      else if (metric.status === 'MET') {
        const existing = await this.prisma.kycOperationalAlert.findUnique({ where: { dedupeKey } });
        if (existing && existing.status !== 'RESOLVED') await this.prisma.kycOperationalAlert.update({ where: { id: existing.id },
          data: { status: 'RESOLVED', resolvedAt: now } });
      }
    }
  }

  async list(clientId: string | undefined, status?: string, skip = 0) {
    const where = { clientId, status: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status ?? '') ? status : undefined };
    const [items, total] = await Promise.all([
      this.prisma.kycOperationalAlert.findMany({ where, orderBy: { lastSeenAt: 'desc' },
        skip: Math.min(Math.max(skip, 0), 100000), take: 50 }),
      this.prisma.kycOperationalAlert.count({ where }),
    ]);
    return { items, total, skip, pageSize: 50 };
  }

  async change(id: string, clientId: string | undefined, actorId: string, action: 'ACKNOWLEDGED' | 'RESOLVED') {
    const prior = await this.prisma.kycOperationalAlert.findFirst({ where: { id, clientId },
      select: { status: true, clientId: true } });
    if (!prior) throw new NotFoundException('KYC_ALERT_NOT_FOUND');
    const changed = await this.prisma.kycOperationalAlert.updateMany({ where: { id, clientId,
      status: action === 'ACKNOWLEDGED' ? 'OPEN' : { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: action === 'ACKNOWLEDGED' ? { status: action, acknowledgedBy: actorId, acknowledgedAt: new Date() } :
        { status: action, resolvedAt: new Date() } });
    if (!changed.count) throw new ConflictException('KYC_ALERT_ALREADY_UPDATED');
    await this.audit.record({ clientId: prior.clientId ?? undefined, actorId,
      action: `KYC_ALERT_${action}`, entityType: 'KYC_OPERATIONAL_ALERT', entityId: id,
      previousData: { status: prior.status }, newData: { status: action } });
    return { id, status: action };
  }
}
