import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PlatformCatalogService } from './platform-catalog.service.js';

describe('PlatformCatalogService feature pricing validation', () => {
  const service = new PlatformCatalogService(
    {} as never,
    {} as never,
    {} as never,
  );

  const pricing = {
    featureId: 'feature-1',
    billingUnit: 'VERIFICATION',
    salePrice: 3,
    effectiveFrom: '2026-09-12',
  };

  it('rejects an end date that precedes its effective start date', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({ ...pricing, effectiveTo: '2026-09-11' }),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid versioned feature price with an effective range', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({
        ...pricing,
        effectiveTo: '2026-09-30',
      }),
    ).not.toThrow();
  });

  it('returns a public delivery URL for an OEM logo without persisting one', async () => {
    const prisma = {
      oem: {
        findMany: async () => [
          {
            id: 'oem-1',
            logoObjectKey: 'platform/oems/oem-1/logo/logo.webp',
          },
        ],
      },
    };
    const catalog = new PlatformCatalogService(
      prisma as never,
      {} as never,
      {
        createPublicUrl: (key: string) => `https://media.evseye.io/${key}`,
      } as never,
    );

    await expect(catalog.listOems()).resolves.toEqual([
      {
        id: 'oem-1',
        logoObjectKey: 'platform/oems/oem-1/logo/logo.webp',
        logoUrl:
          'https://media.evseye.io/platform/oems/oem-1/logo/logo.webp',
      },
    ]);
  });
});

describe('immutable vehicle catalog codes', () => {
  it.each([
    ['oem', 'updateOem'],
    ['vehicleCategory', 'updateVehicleCategory'],
    ['vehicleType', 'updateVehicleType'],
  ])('rejects a changed code for %s', async (model, method) => {
    const findUnique = vi.fn().mockResolvedValue({ code: 'ORIGINAL' });
    const update = vi.fn();
    const prisma = { [model]: { findUnique, update } };
    const service = new PlatformCatalogService(prisma as never, {} as never, {} as never);
    await expect((service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method](
      'record-1', { code: 'CHANGED', categoryId: 'category-1' }, 'admin-1',
    )).rejects.toThrow('code cannot be changed after creation');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['oem', 'updateOem'],
    ['vehicleCategory', 'updateVehicleCategory'],
    ['vehicleType', 'updateVehicleType'],
  ])('allows other fields to change without writing the code for %s', async (model, method) => {
    const update = vi.fn().mockResolvedValue({ id: 'record-1', code: 'ORIGINAL', logoObjectKey: null });
    const prisma: Record<string, unknown> = { [model]: { findUnique: vi.fn().mockResolvedValue({ code: 'ORIGINAL' }), update },
      vehicleCategory: model === 'vehicleType' ? { findUnique: vi.fn().mockResolvedValue({ id: 'category-1' }) } : undefined };
    if (model === 'vehicleCategory') prisma.vehicleCategory = { findUnique: vi.fn().mockResolvedValue({ code: 'ORIGINAL' }), update };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new PlatformCatalogService(prisma as never, audit as never, {} as never);
    await (service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method](
      'record-1', { code: 'ORIGINAL', categoryId: 'category-1', name: 'Updated' }, 'admin-1',
    );
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0]?.data).not.toHaveProperty('code');
  });
});
