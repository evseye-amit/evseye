import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  type RiderDeposit,
  type RiderDepositTransaction,
} from '@prisma/client';

export const ZERO = new Prisma.Decimal(0);
export const money = (value: unknown, field = 'amount') => {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException(
      `${field} must be a decimal string with at most two places`,
    );
  const amount = new Prisma.Decimal(value);
  if (amount.lt(0))
    throw new BadRequestException(`${field} must be nonnegative`);
  return amount;
};
export const positiveMoney = (value: unknown) => {
  const amount = money(value);
  if (amount.lte(0)) throw new BadRequestException('Amount must be positive');
  return amount;
};
export const decimalString = (value: Prisma.Decimal) => value.toFixed(2);

export function depositBalances(
  deposit: Pick<
    RiderDeposit,
    'requiredAmount' | 'fundedAmount' | 'availableAmount'
  >,
) {
  const outstanding = Prisma.Decimal.max(
    ZERO,
    deposit.requiredAmount.minus(deposit.fundedAmount),
  );
  const topUp = Prisma.Decimal.max(
    ZERO,
    deposit.requiredAmount.minus(deposit.availableAmount),
  );
  return {
    required: decimalString(deposit.requiredAmount),
    funded: decimalString(deposit.fundedAmount),
    available: decimalString(deposit.availableAmount),
    outstanding: decimalString(outstanding),
    topUpRequired: decimalString(topUp),
  };
}

export function reconcileDeposit(
  deposit: Pick<RiderDeposit, 'fundedAmount' | 'availableAmount'>,
  transactions: Pick<
    RiderDepositTransaction,
    'balanceDelta' | 'fundingDelta'
  >[],
) {
  const available = transactions.reduce(
    (sum, row) => sum.plus(row.balanceDelta),
    ZERO,
  );
  const funded = transactions.reduce(
    (sum, row) => sum.plus(row.fundingDelta),
    ZERO,
  );
  if (
    !available.eq(deposit.availableAmount) ||
    !funded.eq(deposit.fundedAmount)
  )
    throw new ConflictException({
      code: 'DEPOSIT_BALANCE_RECONCILIATION_FAILED',
    });
  return { available: decimalString(available), funded: decimalString(funded) };
}
