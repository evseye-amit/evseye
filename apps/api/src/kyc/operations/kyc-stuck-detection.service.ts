import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';

@Injectable()
export class KycStuckDetectionService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  minutes(name: 'KYC_OPS_STUCK_PROCESSING_MINUTES' | 'KYC_OPS_STUCK_PROVIDER_MINUTES' |
    'KYC_OPS_ACTION_REQUIRED_MINUTES' | 'KYC_OPS_REVIEW_SLA_MINUTES') {
    return this.config.get(name);
  }

  cutoff(minutes: number, now = new Date()) { return new Date(now.getTime() - minutes * 60_000); }

  verificationFlags(row: { status: string; updatedAt: Date; expiresAt: Date | null;
    attempts?: { responseReceivedAt: Date | null; requestStartedAt: Date }[];
    routingDecision?: { selectedProviders: unknown } | null; providerConflicts?: unknown[] }, now = new Date()) {
    const flags: string[] = [];
    if ((row.status === 'CREATED' || row.status === 'PROCESSING') &&
      row.updatedAt < this.cutoff(this.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES'), now)) flags.push('STUCK');
    if (row.status === 'OTP_REQUIRED' && (row.expiresAt && row.expiresAt < now ||
      row.updatedAt < this.cutoff(this.minutes('KYC_OPS_ACTION_REQUIRED_MINUTES'), now))) flags.push('ACTION_REQUIRED_EXPIRED');
    if (row.attempts?.some((attempt) => !attempt.responseReceivedAt &&
      attempt.requestStartedAt < this.cutoff(this.minutes('KYC_OPS_STUCK_PROVIDER_MINUTES'), now))) flags.push('PROVIDER_PENDING');
    if (row.attempts && row.attempts.some((attempt: any) => attempt.reason === 'FALLBACK')) flags.push('FALLBACK_USED');
    if (row.providerConflicts?.length) flags.push('PROVIDER_CONFLICT');
    return flags;
  }

  workflowFlags(row: { status: string; updatedAt: Date; reviewDueAt: Date | null; expiresAt: Date | null }, now = new Date()) {
    const flags: string[] = [];
    if (['CREATED', 'IN_PROGRESS', 'WAITING', 'RECONCILING', 'DECISION_PENDING'].includes(row.status) &&
      row.updatedAt < this.cutoff(this.minutes('KYC_OPS_STUCK_PROCESSING_MINUTES'), now)) flags.push('STUCK');
    if (row.status === 'ACTION_REQUIRED' && row.expiresAt && row.expiresAt < now) flags.push('ACTION_REQUIRED_EXPIRED');
    if (row.status === 'MANUAL_REVIEW' && (row.reviewDueAt ?? row.updatedAt) <
      (row.reviewDueAt ? now : this.cutoff(this.minutes('KYC_OPS_REVIEW_SLA_MINUTES'), now))) flags.push('MANUAL_REVIEW_OVERDUE');
    return flags;
  }
}
