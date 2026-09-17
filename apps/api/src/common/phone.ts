import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

export const INDIAN_MOBILE_INPUT_PATTERN = /^(?:[6-9]\d{9}|0[6-9]\d{9}|\+?91[6-9]\d{9})$/;
export const USER_MOBILE_CONFLICT_MESSAGE = 'This mobile number is already assigned to another user or role.';

/** Normalizes Indian mobile input for new user records. */
export function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local =
    /^\d{10}$/.test(digits)
      ? digits
      : /^0(\d{10})$/.exec(digits)?.[1] ??
        /^91(\d{10})$/.exec(digits)?.[1];
  return local && /^[6-9]\d{9}$/.test(local) ? `+91${local}` : value.trim();
}

/** Finds legacy and canonical representations of the same Indian mobile. */
export function indianMobileVariants(value: string): string[] {
  const normalized = normalizeIndianMobile(value);
  const local = /^\+91([6-9]\d{9})$/.exec(normalized)?.[1];
  return local
    ? [...new Set([normalized, `0${local}`, local, value.trim()])]
    : [value.trim()];
}

/** Friendly preflight check; the database trigger also guards concurrent writes. */
export async function assertUserMobileAvailable(
  prisma: PrismaService,
  mobile: string,
  exceptUserId?: string,
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: {
      mobile: { in: indianMobileVariants(mobile) },
      deletedAt: null,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new ConflictException(USER_MOBILE_CONFLICT_MESSAGE);
}
