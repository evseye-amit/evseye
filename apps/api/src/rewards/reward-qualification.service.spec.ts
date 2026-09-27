import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RewardQualificationService } from './reward-qualification.service.js';
const d = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const program = { id: 'program-1', code: 'SELF', name: 'Self Submission', type: 'SELF_SUBMISSION', status: 'ACTIVE', currency: 'INR', validFrom: new Date('2025-01-01'), validUntil: null, totalBudget: d('500.00') };
  const rule = { id: 'rule-1', programId: program.id, program, code: 'BONUS', version: 1, rewardValue: d('100.00'), approvalMode: 'AUTO', expiryDays: 30, monthlyCountCap: 5, monthlyAmountCap: d('500.00') };
  const claim = { id: 'claim-1', clientId: 'client-1', riderId: 'rider-1', ruleId: rule.id, calculatedAmount: d('100.00'), status: 'APPROVED' };
  const tx = {
    rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
    rewardRule: { findMany: vi.fn().mockResolvedValue([rule]) },
    rewardClaim: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(claim) },
    rewardEvent: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = { $transaction: vi.fn((work: (arg: typeof tx) => Promise<unknown>) => work(tx)) };
  return { tx, rule, program, claim, service: new RewardQualificationService(prisma as never) };
}
describe('reward qualification', () => {
  it('creates one server-calculated self submission claim with a rule snapshot', async () => {
    const f = fixture();
    await f.service.qualify('client-1', 'rider-1', 'SELF_SUBMISSION_APPROVED', 'submission-1', 'admin-1');
    expect(f.tx.rewardClaim.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      calculatedAmount: d('100.00'), status: 'APPROVED', sourceType: 'SELF_SUBMISSION', sourceId: 'submission-1',
      snapshot: expect.objectContaining({ configuredValue: '100.00', ruleVersion: 1 }),
    }) });
  });
  it('returns the existing claim for a duplicate source event', async () => {
    const f = fixture();
    f.tx.rewardClaim.findUnique.mockResolvedValue(f.claim);
    const result = await f.service.qualify('client-1', 'rider-1', 'SELF_SUBMISSION_APPROVED', 'submission-1', 'admin-1');
    expect(result).toBe(f.claim);
    expect(f.tx.rewardClaim.create).not.toHaveBeenCalled();
  });
  it('rejects the sixth monthly claim before reserving budget', async () => {
    const f = fixture();
    f.tx.rewardClaim.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ calculatedAmount: d('100.00') })));
    await expect(f.service.qualify('client-1', 'rider-1', 'SELF_SUBMISSION_APPROVED', 'submission-6', 'admin-1')).rejects.toThrow('REWARD_CAP_EXCEEDED');
    expect(f.tx.rewardClaim.create).not.toHaveBeenCalled();
  });
  it('rejects a claim when the program budget is exhausted', async () => {
    const f = fixture();
    f.rule.monthlyCountCap = 10;
    f.tx.rewardClaim.findMany.mockImplementation(({ where }: { where: { programId?: string } }) => Promise.resolve(where.programId ? [{ calculatedAmount: d('500.00') }] : []));
    await expect(f.service.qualify('client-1', 'rider-1', 'SELF_SUBMISSION_APPROVED', 'submission-2', 'admin-1')).rejects.toThrow('REWARD_BUDGET_EXHAUSTED');
  });
});
