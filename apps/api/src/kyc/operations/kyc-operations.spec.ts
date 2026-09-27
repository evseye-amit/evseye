import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { KycOperationsQueryService } from './kyc-operations-query.service.js';
import { KycOperationsCommandService } from './kyc-operations-command.service.js';
import { KycStuckDetectionService } from './kyc-stuck-detection.service.js';

const config = { get: (name: string) => ({ KYC_OPS_STUCK_PROCESSING_MINUTES: 10,
  KYC_OPS_STUCK_PROVIDER_MINUTES: 5, KYC_OPS_ACTION_REQUIRED_MINUTES: 60,
  KYC_OPS_REVIEW_SLA_MINUTES: 240 })[name] ?? 10 } as never;

describe('KYC operations query isolation', () => {
  it('applies client scope to both page and count without loading identity data', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'v1', status: 'VERIFIED', updatedAt: new Date(),
      expiresAt: null, attempts: [], providerConflicts: [] }]);
    const count = vi.fn().mockResolvedValue(1);
    const service = new KycOperationsQueryService({ kycVerification: { findMany, count } } as never,
      new KycStuckDetectionService(config));
    const result = await service.verifications({ clientId: 'client-a', hours: 24, skip: 0 });
    expect(result.total).toBe(1);
    expect(findMany.mock.calls[0][0].where.clientId).toBe('client-a');
    expect(count.mock.calls[0][0].where.clientId).toBe('client-a');
    expect(findMany.mock.calls[0][0].take).toBe(50);
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('results');
  });
});

describe('manual review assignment', () => {
  it('rejects stale versions without recording a misleading audit event', async () => {
    const record = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const command = new KycOperationsCommandService({
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'reviewer' }) },
      kycWorkflowExecution: { findFirst: vi.fn().mockResolvedValue({ reviewAssignedTo: null,
        reviewVersion: 3, status: 'MANUAL_REVIEW' }), updateMany },
    } as never, { record } as never, config, {} as never, {} as never);
    await expect(command.assign('client-a', 'review-id', 'reviewer', 'reviewer', 2, 'Take review case'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client-a', status: 'MANUAL_REVIEW', reviewVersion: 2 });
    expect(record).not.toHaveBeenCalled();
  });

  it('prevents an operator taking another reviewer’s assigned case', async () => {
    const updateMany = vi.fn();
    const command = new KycOperationsCommandService({
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'reviewer-b' }) },
      kycWorkflowExecution: { findFirst: vi.fn().mockResolvedValue({ reviewAssignedTo: 'reviewer-a',
        reviewVersion: 1, status: 'MANUAL_REVIEW' }), updateMany },
    } as never, { record: vi.fn() } as never, config, {} as never, {} as never);
    await expect(command.assign('client-a', 'review-id', 'reviewer-b', 'reviewer-b', 1, 'Take review case'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
