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
