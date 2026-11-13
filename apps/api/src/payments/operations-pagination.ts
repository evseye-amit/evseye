import { BadRequestException } from '@nestjs/common';

export function operationsPage(value?: string): number {
  if (value === undefined) return 1;
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new BadRequestException('Invalid operations page.');
  return Number(value);
}

export function pageResult<T>(rows: T[], page: number, limit: number) {
  return { items: rows.slice(0, limit), page, hasMore: rows.length > limit };
}
