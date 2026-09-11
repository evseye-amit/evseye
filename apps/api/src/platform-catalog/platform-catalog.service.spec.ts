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
});
