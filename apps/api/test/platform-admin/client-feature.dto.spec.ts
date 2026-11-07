import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ClientFeatureSource } from '@prisma/client';
import { CreateClientFeatureDto, UpdateClientFeatureDto } from '../../src/platform-admin/dto/client-feature.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('client feature configuration validation', () => {
  it('accepts a package feature override with JSON configuration', async () => {
    const dto = Object.assign(new CreateClientFeatureDto(), {
      subscriptionId: 'subscription-1',
      featureId: 'feature-1',
      source: ClientFeatureSource.CUSTOM,
      enabled: false,
      effectiveFrom: '2026-11-07',
      configuration: { fields: [{ code: 'CAPTURE_EMAIL', required: true }] },
    });

    expect(await validate(dto, options)).toEqual([]);
  });

  it('rejects malformed override payloads', async () => {
    const dto = Object.assign(new UpdateClientFeatureDto(), {
      enabled: 'false',
      effectiveFrom: 'not-a-date',
      configuration: 'not-json',
    });
    const errors = await validate(dto, options);

    expect(errors.map((error) => error.property).sort()).toEqual([
      'configuration',
      'effectiveFrom',
      'enabled',
    ]);
  });

  it('allows clearing optional configuration by omitting it', async () => {
    const dto = Object.assign(new UpdateClientFeatureDto(), { enabled: true });
    expect(await validate(dto, options)).toEqual([]);
  });
});
