import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CommercialMaintenanceService } from './commercial-maintenance.service.js';

const decimal = (value: number | string) => new Prisma.Decimal(value);

describe('CommercialMaintenanceService', () => {
  it('expires an unused expired credit lot and records an expiry ledger entry', async () => {
    const ledger = vi.fn().mockResolvedValue({});
    const tx = {
      featureCreditLot: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'lot-1', clientId: 'client-1', subscriptionId: 'sub-1', featureId: 'feature-1',
          sourceType: 'FEATURE_ADDON', sourceId: 'purchase-1', quantityAvailable: decimal(40),
          expiresAt: new Date('2026-04-01'),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      featureUsageLedger: { create: ledger },
    };
    const prisma = {
      featureCreditLot: { findMany: vi.fn().mockResolvedValue([{ id: 'lot-1' }]) },
      $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    };
    const service = new CommercialMaintenanceService(prisma as never);

    await expect((service as never as { expireCredits: (date: Date) => Promise<number> }).expireCredits(new Date('2026-04-02'))).resolves.toBe(1);
    expect(tx.featureCreditLot.update).toHaveBeenCalledWith({ where: { id: 'lot-1' }, data: { quantityAvailable: 0 } });
    expect(ledger.mock.calls[0][0].data).toMatchObject({ transactionType: 'EXPIRE', quantity: decimal(-40), balanceAfter: 0, referenceType: 'CREDIT_EXPIRY' });
  });

  it('creates the next monthly allowance and expires the prior non-rollover allowance', async () => {
    const ledger = vi.fn().mockResolvedValue({});
    const tx = {
      featureCreditLot: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ id: 'old-lot', featureId: 'sms', quantityAvailable: decimal(200) }]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'new-lot' }),
      },
      featureUsageLedger: { create: ledger },
    };
    const prisma = { $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
    const service = new CommercialMaintenanceService(prisma as never);
    const didGrant = await (service as never as {
      grantAllowance: (subscriptionId: string, clientId: string, feature: object, periodStart: Date, now: Date) => Promise<boolean>;
    }).grantAllowance('sub-1', 'client-1', {
      id: 'package-feature-1', featureId: 'sms', includedQuantity: decimal(1200), resetPeriod: 'MONTHLY', rolloverAllowed: false,
    }, new Date('2026-02-15'), new Date('2026-02-15'));

    expect(didGrant).toBe(true);
    expect(tx.featureCreditLot.update).toHaveBeenCalledWith({ where: { id: 'old-lot' }, data: { quantityAvailable: 0 } });
    expect(tx.featureCreditLot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantityAvailable: decimal(1200), sourceKey: 'allowance:sub-1:package-feature-1:2026-02-15' }) }));
    expect(ledger).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate an allowance that has already been granted for the period', async () => {
    const tx = { featureCreditLot: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) } };
    const prisma = { $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
    const service = new CommercialMaintenanceService(prisma as never);
    await expect((service as never as { grantAllowance: (a: string, b: string, c: object, d: Date, e: Date) => Promise<boolean> }).grantAllowance('sub-1', 'client-1', { id: 'pf-1', featureId: 'sms', includedQuantity: decimal(1200), rolloverAllowed: false }, new Date('2026-02-15'), new Date('2026-02-15'))).resolves.toBe(false);
  });
});
