import { KycVerificationType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KycCommercialService } from './kyc-commercial.service.js';

describe('KycCommercialService add-on entitlement', () => {
  it('allows a purchased KYC pack without a package Feature link', async () => {
    const prisma = {
      kycClientPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
      feature: { findUnique: vi.fn().mockResolvedValue({ id: 'pan-feature', isActive: true }) },
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({ id: 'sub-1', packageId: 'other-package' }) },
      clientFeature: { findFirst: vi.fn().mockResolvedValue(null) },
      clientFeatureAddOnPurchase: { findFirst: vi.fn().mockResolvedValue({ id: 'purchase-1' }) },
    };
    const service = new KycCommercialService(prisma as never);

    const entitlement = await service.entitlement('client-1', KycVerificationType.PAN_VERIFICATION);
    expect(entitlement.clientFeature).toMatchObject({ source: 'ADD_ON', unlimitedUsage: false });
    expect(prisma.clientFeatureAddOnPurchase.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({
      clientId: 'client-1', featureId: 'pan-feature', status: 'ACTIVE',
    }) });
  });
});
