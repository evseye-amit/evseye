import { KycStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KycService } from './kyc.service.js';

describe('KycService transitions', () => {
  it('creates a tenant-scoped pending KYC verification for an eligible rider', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: 'kyc-1',
      status: KycStatus.PENDING,
    });
    const prisma = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      riderKyc: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    };
    const service = new KycService(prisma as never);

    await expect(
      service.start('tenant-a', 'rider-1', { type: 'PAN' }),
    ).resolves.toEqual({ id: 'kyc-1', status: KycStatus.PENDING });
    expect(upsert).toHaveBeenCalledWith({
      where: { riderId_type: { riderId: 'rider-1', type: 'PAN' } },
      create: {
        tenantId: 'tenant-a',
        riderId: 'rider-1',
        type: 'PAN',
        status: KycStatus.PENDING,
        provider: 'sandbox',
      },
      update: {
        status: KycStatus.PENDING,
        provider: 'sandbox',
        safeFailureCode: null,
      },
    });
  });

  it('does not restart an already verified KYC record', async () => {
    const prisma = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      riderKyc: {
        findUnique: vi.fn().mockResolvedValue({ status: KycStatus.VERIFIED }),
        upsert: vi.fn(),
      },
    };
    const service = new KycService(prisma as never);

    await expect(
      service.start('tenant-a', 'rider-1', { type: 'PAN' }),
    ).rejects.toThrow('already active or complete');
    expect(prisma.riderKyc.upsert).not.toHaveBeenCalled();
  });

  it('rejects completion of a KYC record that is not pending', async () => {
    const prisma = {
      riderKyc: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'kyc-1', status: KycStatus.VERIFIED }),
      },
    };
    const service = new KycService(prisma as never);

    await expect(
      service.complete('tenant-a', 'rider-a', 'kyc-1', { status: 'VERIFIED' }),
    ).rejects.toThrow('not pending');
  });
});
