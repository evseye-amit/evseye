import { KycStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KycService } from './kyc.service.js';

const pendingProvider = {
  start: vi.fn().mockResolvedValue({
    status: KycStatus.PENDING,
    provider: 'sandbox',
    providerReference: 'sandbox-reference',
  }),
};

describe('KycService transitions', () => {
  it('creates a client-scoped pending KYC verification for an eligible rider', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: 'kyc-1',
      status: KycStatus.PENDING,
    });
    const prisma = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      riderKyc: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    };
    const service = new KycService(prisma as never, pendingProvider);

    await expect(
      service.start('client-a', 'rider-1', { type: 'PAN' }),
    ).resolves.toEqual({ id: 'kyc-1', status: KycStatus.PENDING });
    expect(pendingProvider.start).toHaveBeenCalledWith({
      clientId: 'client-a',
      riderId: 'rider-1',
      type: 'PAN',
      referenceHint: undefined,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { riderId_type: { riderId: 'rider-1', type: 'PAN' } },
        create: expect.objectContaining({
          clientId: 'client-a',
          riderId: 'rider-1',
          type: 'PAN',
          status: KycStatus.PENDING,
          provider: 'sandbox',
          providerReference: 'sandbox-reference',
        }),
      }),
    );
  });

  it('does not restart an already verified KYC record', async () => {
    const prisma = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      riderKyc: {
        findUnique: vi.fn().mockResolvedValue({ status: KycStatus.VERIFIED }),
        upsert: vi.fn(),
      },
    };
    const service = new KycService(prisma as never, pendingProvider);

    await expect(
      service.start('client-a', 'rider-1', { type: 'PAN' }),
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
    const service = new KycService(prisma as never, pendingProvider);

    await expect(
      service.complete('client-a', 'rider-a', 'kyc-1', { status: 'VERIFIED' }),
    ).rejects.toThrow('not pending');
  });

  it('does not persist or return arbitrary legacy masked-data fields', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'kyc-1', status: KycStatus.VERIFIED,
      maskedData: { lastFour: '1234', aadhaar: '123456789012' } });
    const prisma = { riderKyc: { findFirst: vi.fn().mockResolvedValue({ id: 'kyc-1', status: KycStatus.PENDING }), update } };
    const service = new KycService(prisma as never, pendingProvider);
    const result = await service.complete('client-a', 'rider-a', 'kyc-1', {
      status: 'VERIFIED', maskedData: { lastFour: '1234', aadhaar: '123456789012' },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ maskedData: { lastFour: '1234' } }) }));
    expect(result.maskedData).toEqual({ lastFour: '1234' });
  });
});
