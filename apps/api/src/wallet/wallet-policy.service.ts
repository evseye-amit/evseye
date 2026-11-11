import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type WalletPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type ChargeCategory = 'RENTAL' | 'ONBOARDING_FEE' | 'SECURITY_DEPOSIT' | 'PENALTY' | 'REPAIR' | 'SERVICE' | 'BATTERY_SWAP' | 'EXCHANGE' | 'TRAFFIC_CHALLAN' | 'ACCESSORY' | 'LOST_EQUIPMENT' | 'OTHER';
export const chargeCategories: ChargeCategory[] = ['RENTAL', 'ONBOARDING_FEE', 'SECURITY_DEPOSIT', 'PENALTY', 'REPAIR', 'SERVICE', 'BATTERY_SWAP', 'EXCHANGE', 'TRAFFIC_CHALLAN', 'ACCESSORY', 'LOST_EQUIPMENT', 'OTHER'];
export const depositReasons = ['VEHICLE_DAMAGE', 'PENDING_RENTAL', 'LATE_FEE', 'REPAIR', 'TRAFFIC_CHALLAN', 'LOST_ACCESSORY', 'LOST_EQUIPMENT', 'BATTERY_DAMAGE', 'OTHER'] as const;
export type PolicyRules = Pick<WalletPolicy, 'allowNegativeCashBalance' | 'negativeBalanceLimit' | 'minimumCashBalance' | 'allowRewardUsage' | 'maxRewardUsagePercent' | 'rewardCategories' | 'allowDepositDeduction' | 'depositDeductionReasons' | 'allowPartialSecurityDeposit' | 'requireFullDepositBeforeAllocation' | 'allowDepositRefundRequest' | 'fundingPriority'>;
export const defaultPolicy: PolicyRules = {
  allowNegativeCashBalance: false, negativeBalanceLimit: new Prisma.Decimal(0), minimumCashBalance: new Prisma.Decimal(0),
  allowRewardUsage: false, maxRewardUsagePercent: new Prisma.Decimal(0), rewardCategories: [],
  allowDepositDeduction: false, depositDeductionReasons: [], allowPartialSecurityDeposit: true,
  requireFullDepositBeforeAllocation: false, allowDepositRefundRequest: false,
  fundingPriority: ['REWARD', 'CASH', 'EXTERNAL_PAYMENT'],
};
export function validatePolicy(policy: PolicyRules) {
  const flags = [policy.allowNegativeCashBalance, policy.allowRewardUsage, policy.allowDepositDeduction, policy.allowPartialSecurityDeposit, policy.requireFullDepositBeforeAllocation, policy.allowDepositRefundRequest];
  if (flags.some(value => typeof value !== 'boolean') || !Array.isArray(policy.rewardCategories) || !Array.isArray(policy.depositDeductionReasons) || !Array.isArray(policy.fundingPriority)) throw new BadRequestException('INVALID_WALLET_POLICY');
  if (policy.negativeBalanceLimit.lt(0) || policy.minimumCashBalance.lt(0) || policy.maxRewardUsagePercent.lt(0) || policy.maxRewardUsagePercent.gt(100)) throw new BadRequestException('INVALID_WALLET_POLICY');
  if (policy.rewardCategories.some(x => !chargeCategories.includes(x as ChargeCategory)) || policy.depositDeductionReasons.some(x => !depositReasons.includes(x as typeof depositReasons[number]))) throw new BadRequestException('INVALID_WALLET_POLICY');
  const sources = ['REWARD', 'CASH', 'EXTERNAL_PAYMENT'];
  if (policy.fundingPriority.length !== 3 || new Set(policy.fundingPriority).size !== 3 || policy.fundingPriority.some(x => !sources.includes(x))) throw new BadRequestException('INVALID_WALLET_POLICY');
}
@Injectable()
export class WalletPolicyService {
  constructor(private readonly prisma: PrismaService) {}
  async effective(clientId: string): Promise<PolicyRules & { version: number }> {
    const policy = await this.prisma.walletPolicy.findFirst({ where: { clientId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] }, orderBy: { version: 'desc' } });
    return policy ?? { ...defaultPolicy, version: 0 };
  }
  async update(clientId: string, actorId: string, input: Partial<PolicyRules>) {
    const allowed = ['allowNegativeCashBalance', 'negativeBalanceLimit', 'minimumCashBalance', 'allowRewardUsage', 'maxRewardUsagePercent', 'rewardCategories', 'allowDepositDeduction', 'depositDeductionReasons', 'allowPartialSecurityDeposit', 'requireFullDepositBeforeAllocation', 'allowDepositRefundRequest', 'fundingPriority'];
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new BadRequestException('INVALID_WALLET_POLICY');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      const previous = await tx.walletPolicy.findFirst({ where: { clientId, effectiveUntil: null }, orderBy: { version: 'desc' } });
      const current: PolicyRules = previous ?? defaultPolicy;
      let policy: PolicyRules;
      try {
        policy = {
          allowNegativeCashBalance: input.allowNegativeCashBalance ?? current.allowNegativeCashBalance,
          negativeBalanceLimit: new Prisma.Decimal(input.negativeBalanceLimit ?? current.negativeBalanceLimit),
          minimumCashBalance: new Prisma.Decimal(input.minimumCashBalance ?? current.minimumCashBalance),
          allowRewardUsage: input.allowRewardUsage ?? current.allowRewardUsage,
          maxRewardUsagePercent: new Prisma.Decimal(input.maxRewardUsagePercent ?? current.maxRewardUsagePercent),
          rewardCategories: input.rewardCategories ?? current.rewardCategories,
          allowDepositDeduction: input.allowDepositDeduction ?? current.allowDepositDeduction,
          depositDeductionReasons: input.depositDeductionReasons ?? current.depositDeductionReasons,
          allowPartialSecurityDeposit: input.allowPartialSecurityDeposit ?? current.allowPartialSecurityDeposit,
          requireFullDepositBeforeAllocation: input.requireFullDepositBeforeAllocation ?? current.requireFullDepositBeforeAllocation,
          allowDepositRefundRequest: input.allowDepositRefundRequest ?? current.allowDepositRefundRequest,
          fundingPriority: input.fundingPriority ?? current.fundingPriority,
        };
        validatePolicy(policy);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('INVALID_WALLET_POLICY');
      }
      const now = new Date();
      if (previous) await tx.walletPolicy.update({ where: { id: previous.id }, data: { effectiveUntil: now } });
      const next = await tx.walletPolicy.create({ data: { clientId, effectiveFrom: now, ...policy, version: (previous?.version ?? 0) + 1, createdById: actorId } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'wallet.policy.changed', entityType: 'WalletPolicy', entityId: next.id, newData: { version: next.version } } });
      return next;
    });
  }
}

export function planFunding(amount: Prisma.Decimal, category: ChargeCategory, available: { cash: Prisma.Decimal; reward: Prisma.Decimal }, policy: PolicyRules) {
  if (amount.lte(0)) throw new BadRequestException('INVALID_AMOUNT');
  const rewardCap = policy.allowRewardUsage && policy.rewardCategories.includes(category) ? amount.mul(policy.maxRewardUsagePercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN) : new Prisma.Decimal(0);
  let remaining = amount;
  const funding: { source: string; amount: string }[] = [];
  for (const source of policy.fundingPriority) {
    const use = source === 'REWARD' ? Prisma.Decimal.min(remaining, available.reward, rewardCap) : source === 'CASH' ? Prisma.Decimal.min(remaining, available.cash) : remaining;
    const positive = Prisma.Decimal.max(use, 0);
    funding.push({ source, amount: positive.toFixed(2) });
    remaining = remaining.minus(positive);
  }
  return { amount: amount.toFixed(2), funding, walletContribution: amount.minus(new Prisma.Decimal(funding.find(f => f.source === 'EXTERNAL_PAYMENT')!.amount)).toFixed(2), remainingExternalAmount: funding.find(f => f.source === 'EXTERNAL_PAYMENT')!.amount };
}
