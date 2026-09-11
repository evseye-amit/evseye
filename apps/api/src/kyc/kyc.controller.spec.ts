import { KycStatus, KycType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KycController } from './kyc.controller.js';

describe('KycController audit trail', () => {
  it('audits a KYC state change without masked verification data', async () => {
    const kyc = {
      complete: vi.fn().mockResolvedValue({
        id: 'kyc-1',
        type: KycType.AADHAAR,
        status: KycStatus.VERIFIED,
        maskedData: { lastFour: '1234' },
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new KycController(
      kyc as never,
      audit as never,
      { requireTenantId: vi.fn().mockReturnValue('tenant-a') } as never,
    );

    await controller.complete(
      { id: 'kyc-operator-1', tenantId: 'tenant-a', roles: [] },
      'rider-1',
      'kyc-1',
      { status: KycStatus.VERIFIED, maskedData: { lastFour: '1234' } },
    );

    expect(audit.record).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorId: 'kyc-operator-1',
      action: 'KYC_STATUS_CHANGED',
      entityType: 'RIDER_KYC',
      entityId: 'kyc-1',
      newData: {
        riderId: 'rider-1',
        type: KycType.AADHAAR,
        status: KycStatus.VERIFIED,
      },
    });
  });
});
