import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SmsQuotaService } from './sms-quota.service.js';

describe('SmsQuotaService', () => {
  it('uses a purchased SMS pack when the active package has no SMS allowance', async () => {
    const createLedger = vi.fn().mockResolvedValue({});
    const updatePurchase = vi.fn().mockResolvedValue({});
    const lot = {
      id: 'lot-1', purchaseId: 'purchase-1', sourceType: 'FEATURE_ADDON' as const,
      sourceId: 'purchase-1', quantityAvailable: new Prisma.Decimal(1000),
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      clientSubscription: { findFirst: vi.fn().mockResolvedValue({
        id: 'sub-1', startDate: new Date('2026-01-01'), package: { features: [] },
      }) },
      feature: { findUnique: vi.fn().mockResolvedValue({ id: 'sms-feature' }) },
      featureCreditLot: { findMany: vi.fn().mockResolvedValue([lot]), update: vi.fn().mockResolvedValue({}) },
      clientFeatureAddOnPurchase: { update: updatePurchase },
      featureUsageLedger: { create: createLedger },
    };
    const service = new SmsQuotaService({ $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as never);

    await expect(service.reserve('client-1', 'otp-1')).resolves.toEqual(['lot-1']);
    expect(updatePurchase).toHaveBeenCalledWith({ where: { id: 'purchase-1' }, data: expect.objectContaining({
      quantityConsumed: { increment: 1 }, quantityRemaining: { decrement: 1 },
    }) });
    expect(createLedger).toHaveBeenCalledWith({ data: expect.objectContaining({
      referenceType: 'LOGIN_OTP', referenceId: 'otp-1', sourceType: 'FEATURE_ADDON',
    }) });
  });
});
