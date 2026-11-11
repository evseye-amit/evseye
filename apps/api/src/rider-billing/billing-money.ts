import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const DECIMAL_INPUT = /^\d+(?:\.\d+)?$/;
export const ZERO = new Prisma.Decimal(0);

export function positiveDecimal(value: string, scale: number, label: string): Prisma.Decimal {
  if (!DECIMAL_INPUT.test(value)) throw new BadRequestException(`${label} must be a positive decimal.`);
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > scale) {
    throw new BadRequestException(`${label} must be positive with at most ${scale} decimal places.`);
  }
  return amount;
}

export function chargeAmount(quantity: Prisma.Decimal, unitAmount: Prisma.Decimal): Prisma.Decimal {
  const amount = quantity.mul(unitAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (amount.lte(0)) throw new BadRequestException('Charge amount must be at least 0.01.');
  return amount;
}

export function allocateCredits(charges: readonly Prisma.Decimal[], credits: readonly Prisma.Decimal[]) {
  const subtotal = charges.reduce((sum, amount) => sum.plus(amount), ZERO);
  let remaining = subtotal;
  const allocations = credits.map((available) => {
    const used = Prisma.Decimal.min(remaining, available);
    remaining = remaining.minus(used);
    return used;
  });
  return { subtotal, creditAmount: subtotal.minus(remaining), totalAmount: remaining, allocations };
}
