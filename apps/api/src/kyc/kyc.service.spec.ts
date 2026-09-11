import { KycStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KycService } from './kyc.service.js';

describe('KycService transitions', () => {
  it('rejects completion of a KYC record that is not pending', async () => {
    const prisma = {
      riderKyc: { findFirst: vi.fn().mockResolvedValue({ id: 'kyc-1', status: KycStatus.VERIFIED }) },
    };
    const service = new KycService(prisma as never);

    await expect(
      service.complete('tenant-a', 'rider-a', 'kyc-1', { status: 'VERIFIED' }),
    ).rejects.toThrow('not pending');
  });
});
