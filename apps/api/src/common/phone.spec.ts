import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  assertUserMobileAvailable,
  indianMobileVariants,
  INDIAN_MOBILE_INPUT_PATTERN,
  normalizeIndianMobile,
  USER_MOBILE_CONFLICT_MESSAGE,
} from './phone.js';

describe('Indian user mobile identity', () => {
  it('treats local, leading-zero, and +91 forms as one number', () => {
    const forms = ['9871675222', '09871675222', '+919871675222'];
    for (const form of forms) {
      expect(INDIAN_MOBILE_INPUT_PATTERN.test(form)).toBe(true);
      expect(normalizeIndianMobile(form)).toBe('+919871675222');
    }
    expect(indianMobileVariants('09871675222')).toEqual(expect.arrayContaining(forms));
  });

  it('rejects a number owned by another user across roles and clients', async () => {
    const prisma = { user: { findFirst: vi.fn().mockResolvedValue({ id: 'client-admin' }) } };
    await expect(assertUserMobileAvailable(prisma as never, '09871675222')).rejects.toThrow(new ConflictException(USER_MOBILE_CONFLICT_MESSAGE));
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        mobile: { in: expect.arrayContaining(['9871675222', '09871675222', '+919871675222']) },
        deletedAt: null,
      },
      select: { id: true },
    });
  });
});
