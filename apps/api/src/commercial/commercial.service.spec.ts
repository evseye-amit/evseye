import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CommercialService } from './commercial.service.js';

const decimal = (value: number | string) => new Prisma.Decimal(value);

const makeService = (prisma: Record<string, unknown>) =>
  new CommercialService(
    prisma as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );

describe('CommercialService vehicle-tier pricing', () => {
  it('resolves BASIC 50 vehicles at ₹249 per vehicle', async () => {
    const service = makeService({
      packageVehicleTierPricing: {
        findFirst: vi.fn().mockResolvedValue({
          minVehicles: 1,
          maxVehicles: 99,
          pricePerVehicle: decimal(249),
        }),
      },
    });

    await expect(service.resolvePackageVehiclePrice('basic', 50)).resolves.toMatchObject({
      pricePerVehicle: decimal(249),
      minVehicles: 1,
      maxVehicles: 99,
    });
  });

  it('resolves BASIC 150 vehicles at ₹219 per vehicle', async () => {
    const service = makeService({
      packageVehicleTierPricing: {
        findFirst: vi.fn().mockResolvedValue({
          minVehicles: 100,
          maxVehicles: 249,
          pricePerVehicle: decimal(219),
        }),
      },
    });

    await expect(service.resolvePackageVehiclePrice('basic', 150)).resolves.toMatchObject({
      pricePerVehicle: decimal(219),
      minVehicles: 100,
      maxVehicles: 249,
    });
  });

  it('returns a clear configuration error when a tier is absent', async () => {
    const service = makeService({
      packageVehicleTierPricing: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.resolvePackageVehiclePrice('basic', 300)).rejects.toThrow(
      'No active vehicle-tier pricing is configured for 300 vehicles',
    );
  });

  it('rejects an overlapping active vehicle tier', async () => {
    const service = makeService({
      packageVehicleTierPricing: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'tier-1',
            minVehicles: 1,
            maxVehicles: 99,
            effectiveFrom: new Date('2026-01-01'),
            effectiveTo: null,
          },
        ]),
      },
    });

    await expect(
      (service as never as {
        assertNoTierOverlap: (packageId: string, dto: object) => Promise<void>;
      }).assertNoTierOverlap('basic', {
        minVehicles: 50,
        maxVehicles: 150,
        pricePerVehicle: 200,
        effectiveFrom: '2026-02-01',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('CommercialService adjustments and feature credits', () => {
  it('keeps master price intact while calculating a client-specific discount', () => {
    const service = makeService({});
    const result = (service as never as {
      applyAdjustments: (
        amount: Prisma.Decimal,
        adjustments: Array<{ adjustmentType: 'PERCENTAGE'; adjustmentValue: Prisma.Decimal }>,
      ) => { final: Prisma.Decimal; discount: Prisma.Decimal };
    }).applyAdjustments(decimal(12450), [
      { adjustmentType: 'PERCENTAGE', adjustmentValue: decimal(10) },
    ]);

    expect(result.final.toString()).toBe('11205');
    expect(result.discount.toString()).toBe('1245');
  });

  it('calculates an add-on purchase discount without changing its catalog price', () => {
    const service = makeService({});
    const result = (service as never as {
      applyAdjustments: (amount: Prisma.Decimal, adjustments: Array<{ adjustmentType: 'FIXED_AMOUNT'; adjustmentValue: Prisma.Decimal }>) => { final: Prisma.Decimal; discount: Prisma.Decimal };
    }).applyAdjustments(decimal(500), [{ adjustmentType: 'FIXED_AMOUNT', adjustmentValue: decimal(75) }]);

    expect(result.final.toString()).toBe('425');
    expect(result.discount.toString()).toBe('75');
  });

  it('consumes credits in earliest-expiry order', async () => {
    const updates: Array<{ id: string; quantityAvailable: Prisma.Decimal }> = [];
    const ledger: Array<Record<string, unknown>> = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'expires-first', quantityAvailable: decimal(4) },
        { id: 'expires-later', quantityAvailable: decimal(8) },
      ]),
      featureCreditLot: {
        update: vi.fn().mockImplementation(({ where, data }) => {
          updates.push({ id: where.id, quantityAvailable: data.quantityAvailable });
          return Promise.resolve({});
        }),
      },
      featureUsageLedger: {
        create: vi.fn().mockImplementation(({ data }) => {
          ledger.push(data);
          return Promise.resolve({});
        }),
      },
    };
    const service = makeService({
      feature: { findUnique: vi.fn().mockResolvedValue({ id: 'sms-id', code: 'SMS_NOTIFICATION' }) },
      $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    });

    await service.consumeFeatureUsage('client-1', {
      featureCode: 'SMS_NOTIFICATION',
      quantity: 6,
      subscriptionId: 'sub-1',
      referenceType: 'SMS_SEND',
      referenceId: 'message-1',
    });

    expect(updates.map(({ id, quantityAvailable }) => [id, quantityAvailable.toString()])).toEqual([
      ['expires-first', '0'],
      ['expires-later', '6'],
    ]);
    expect(ledger).toHaveLength(2);
  });

  it('does not permit feature usage above the available balance', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'lot-1', quantityAvailable: decimal(2) }]),
    };
    const service = makeService({
      feature: { findUnique: vi.fn().mockResolvedValue({ id: 'sms-id', code: 'SMS_NOTIFICATION' }) },
      $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    });

    await expect(
      service.consumeFeatureUsage('client-1', {
        featureCode: 'SMS_NOTIFICATION',
        quantity: 3,
        subscriptionId: 'sub-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('reconciles an add-on purchase and preserves the originating credit source', async () => {
    const purchaseUpdates: Array<Record<string, unknown>> = [];
    const ledger: Array<Record<string, unknown>> = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'purchase-lot', quantityAvailable: decimal(5), sourceType: 'FEATURE_ADDON',
          sourceId: 'purchase-1', purchaseId: 'purchase-1',
        },
      ]),
      featureCreditLot: { update: vi.fn().mockResolvedValue({}) },
      clientFeatureAddOnPurchase: {
        update: vi.fn().mockImplementation(({ data }) => {
          purchaseUpdates.push(data);
          return Promise.resolve({ quantityRemaining: decimal(0) });
        }),
      },
      featureUsageLedger: { create: vi.fn().mockImplementation(({ data }) => { ledger.push(data); return Promise.resolve({}); }) },
    };
    const service = makeService({
      feature: { findUnique: vi.fn().mockResolvedValue({ id: 'sms-id', code: 'SMS_NOTIFICATION' }) },
      $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    });

    await service.consumeFeatureUsage('client-1', { featureCode: 'SMS_NOTIFICATION', quantity: 5, subscriptionId: 'sub-1' });

    expect(purchaseUpdates).toEqual([
      { quantityConsumed: { increment: decimal(5) }, quantityRemaining: { decrement: decimal(5) } },
      { status: 'CONSUMED', quantityRemaining: 0 },
    ]);
    expect(ledger[0]).toMatchObject({ sourceType: 'FEATURE_ADDON', sourceId: 'purchase-1' });
  });

  it('rejects non-positive vehicle counts before querying pricing', async () => {
    const service = makeService({
      packageVehicleTierPricing: { findFirst: vi.fn() },
    });

    await expect(service.resolvePackageVehiclePrice('basic', 0)).rejects.toThrow(BadRequestException);
  });

  it('rejects an add-on that ends before its effective start date', () => {
    const service = makeService({});
    expect(() =>
      (service as never as { validateAddOn: (value: object) => void }).validateAddOn({
        effectiveFrom: '2026-05-02',
        effectiveTo: '2026-05-01',
      }),
    ).toThrow('Add-on effective end must be after its start');
  });
});
