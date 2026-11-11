import { BadRequestException } from '@nestjs/common';

function boundary(value?: string) {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('Choose a valid date (YYYY-MM-DD).');
  return date;
}
export function riderFinancialPeriod(fromValue?: string, toValue?: string) {
  const from = boundary(fromValue), to = boundary(toValue);
  if (from && to && from > to) throw new BadRequestException('From date must not be after To date.');
  return { from, end: to ? new Date(to.getTime() + 86400000) : undefined };
}
