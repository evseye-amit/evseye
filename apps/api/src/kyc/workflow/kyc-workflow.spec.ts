import { describe, expect, it, vi } from 'vitest';
import { KycNameMatchService, KycReconciliationEngine } from './kyc-reconciliation.service.js';
import { KycDecisionEngine } from './kyc-decision.service.js';
import { KycWorkflowEngine } from './kyc-workflow.service.js';

describe('KYC reconciliation', () => {
  const names = new KycNameMatchService();
  const engine = new KycReconciliationEngine(names);
  it('normalizes case, spacing and punctuation deterministically', () => {
    expect(names.compare('Amit Kumar Goyal', ' AMIT  KUMAR-GOYAL ').status).toBe('EXACT');
    expect(names.compare('Amit K Goyal', 'Amit Kumar Goyal').status).toBe('STRONG_MATCH');
  });
  it('classifies missing and unrelated names without inventing data', () => {
    expect(names.compare('Amit Goyal', null).status).toBe('UNKNOWN');
    expect(names.compare('Amit Goyal', 'Priya Sharma').status).toBe('MISMATCH');
    expect(names.compare('Amit Amit Amit', 'Amit').score).toBeLessThanOrEqual(100);
  });
  it('compares date of birth only when both dates exist', () => {
    expect(engine.compareDob('1990-01-02', '1990-01-02')).toBe('MATCH');
    expect(engine.compareDob('1990-01-02', '1990-01-03')).toBe('MISMATCH');
    expect(engine.compareDob('1990-01-02', null)).toBe('UNKNOWN');
  });
  it('compares bank holder names when returned by a provider', () => {
    expect(engine.reconcile({ riderName: 'Amit Goyal', bankHolderName: 'Amit Goyal' })
      .find((item) => item.type === 'RIDER_NAME_VS_BANK')?.status).toBe('EXACT');
  });
});

describe('KYC manual review concurrency', () => {
  it('appends one decision only when the pending review state is claimed', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const create = vi.fn().mockResolvedValue({ id: 'decision' });
    const prisma = { $transaction: (operation: (tx: unknown) => Promise<unknown>) => operation({
      kycWorkflowExecution: { updateMany }, kycDecision: { create },
    }) };
    const audit = { record: vi.fn().mockResolvedValue({}) };
    const engine = new KycWorkflowEngine(prisma as never, {} as never, {} as never, {} as never, {} as never, audit as never, {} as never, {} as never);
    vi.spyOn(engine, 'get').mockResolvedValue({ id: 'workflow', status: 'VERIFIED' } as never);
    await engine.review('client', 'workflow', 'reviewer', true, 'Evidence checked');
    await expect(engine.review('client', 'workflow', 'reviewer', false, 'Evidence checked')).rejects.toThrow('KYC_REVIEW_ALREADY_RESOLVED');
    expect(create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
});

describe('KYC workflow idempotency', () => {
  it('replays a previous execution after the definition version changes', async () => {
    const definitionLookup = vi.fn();
    const prisma = { rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider' }) },
      kycWorkflowExecution: { findUnique: vi.fn().mockResolvedValue({ id: 'old-execution', riderId: 'rider',
        workflowDefinition: { code: 'RIDER_DEFAULT_KYC' } }) },
      kycWorkflowDefinition: { findFirst: definitionLookup } };
    const config = { get: (key: string) => key === 'KYC_ENABLED' ? true : 'test-fingerprint-secret' };
    const engine = new KycWorkflowEngine(prisma as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, config as never, {} as never);
    vi.spyOn(engine, 'get').mockResolvedValue({ id: 'old-execution' } as never);
    expect(await engine.start('client', 'rider', 'RIDER_DEFAULT_KYC', 'repeat-key')).toEqual({ id: 'old-execution' });
    expect(definitionLookup).not.toHaveBeenCalled();
  });
});

describe('KYC decision rules', () => {
  const engine = new KycDecisionEngine();
  const rules = [
    { id: 'verified', code: 'VERIFIED', priority: 100, condition: { kind: 'REQUIRED_STEPS_VERIFIED' }, action: 'VERIFIED' as const, reasonCode: 'ALL_REQUIRED_CHECKS_PASSED' },
    { id: 'mismatch', code: 'MISMATCH', priority: 20, condition: { kind: 'RECONCILIATION_STATUS', statuses: ['MISMATCH'] }, action: 'MANUAL_REVIEW' as const, reasonCode: 'NAME_MISMATCH' },
    { id: 'failed', code: 'FAILED', priority: 10, condition: { kind: 'REQUIRED_STEP_FAILED' }, action: 'REJECTED' as const, reasonCode: 'REQUIRED_CHECK_FAILED' },
  ];
  it('uses configured priority and required step states', () => {
    expect(engine.decide({ steps: [{ required: true, status: 'FAILED' }], reconciliations: [{ status: 'MISMATCH' }] }, rules).decision).toBe('REJECTED');
    expect(engine.decide({ steps: [{ required: true, status: 'VERIFIED' }], reconciliations: [{ status: 'MISMATCH' }] }, rules).decision).toBe('MANUAL_REVIEW');
    expect(engine.decide({ steps: [{ required: true, status: 'VERIFIED' }], reconciliations: [{ status: 'EXACT' }] }, rules).decision).toBe('VERIFIED');
  });
  it('falls back to review when no rule matches', () => {
    expect(engine.decide({ steps: [], reconciliations: [] }, rules).reasonCode).toBe('INSUFFICIENT_DATA');
  });
  it('rejects unknown rule expressions', () => {
    expect(() => engine.decide({ steps: [], reconciliations: [] }, [{ ...rules[0], condition: { kind: 'EVAL', code: 'danger' } }])).toThrow('INVALID_KYC_DECISION_RULE');
  });
});
