import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PlatformCatalogService } from './platform-catalog.service.js';

describe('PlatformCatalogService feature pricing validation', () => {
  const service = new PlatformCatalogService(
    {} as never,
    {} as never,
    {} as never,
  );

  const pricing = {
    featureId: 'feature-1',
    pricingModel: 'PER_UNIT' as const,
    billingUnit: 'VERIFICATION',
    effectiveFrom: '2026-09-12',
  };

  it('rejects an end date that precedes its effective start date', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({ ...pricing, effectiveTo: '2026-09-11' }),
    ).toThrow(BadRequestException);
  });

  it('rejects a maximum charge lower than the minimum charge', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({ ...pricing, minimumCharge: 100, maximumCharge: 99 }),
    ).toThrow(
      'Maximum charge must be greater than or equal to minimum charge.',
    );
  });

  it('accepts a valid price with a date range and charge limits', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({
        ...pricing,
        effectiveTo: '2026-09-30',
        minimumCharge: 50,
        maximumCharge: 100,
      }),
    ).not.toThrow();
  });

  it('rejects a tier whose end quantity precedes its start quantity', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({
        ...pricing,
        tiers: [
          {
            tierOrder: 1,
            fromQuantity: 100,
            toQuantity: 99,
            unitPrice: 5,
          },
        ],
      }),
    ).toThrow(
      'Tier end quantity must be greater than or equal to its start quantity.',
    );
  });

  it('rejects duplicate tier order values', () => {
    expect(() =>
      (
        service as never as { validatePricing: (value: unknown) => void }
      ).validatePricing({
        ...pricing,
        tiers: [
          { tierOrder: 1, fromQuantity: 0, unitPrice: 5 },
          { tierOrder: 1, fromQuantity: 100, unitPrice: 4 },
        ],
      }),
    ).toThrow('Pricing tier order must be unique.');
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
