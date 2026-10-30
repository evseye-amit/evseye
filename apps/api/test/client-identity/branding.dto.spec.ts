import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  BrandingUploadDto,
  CompleteBrandingUploadDto,
  UpdateBrandingDto,
} from '../../src/client-identity/branding.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('branding request validation', () => {
  it('accepts support contacts and allows clearing them', async () => {
    for (const contacts of [
      { supportEmail: 'support@example.com', supportPhone: '+91 98765 43210' },
      { supportEmail: null, supportPhone: null },
    ]) {
      expect(await validate(Object.assign(new UpdateBrandingDto(), contacts), options)).toEqual([]);
    }
  });

  it.each(['primaryColor', 'secondaryColor', 'accentColor', 'loginTitle', 'loginSubtitle'])(
    'rejects the removed %s customization field', async (field) => {
      const errors = await validate(Object.assign(new UpdateBrandingDto(), { [field]: 'value' }), options);
      expect(errors.some((error) => error.property === field && error.constraints?.whitelistValidation)).toBe(true);
    },
  );

  it('rejects invalid support contacts', async () => {
    const errors = await validate(Object.assign(new UpdateBrandingDto(), {
      supportEmail: 'invalid-email', supportPhone: 'invalid-phone',
    }), options);
    expect(errors.map((error) => error.property).sort()).toEqual(['supportEmail', 'supportPhone']);
  });

  it.each(['logo', 'favicon'])('retains upload validation for %s', async (kind) => {
    expect(await validate(Object.assign(new BrandingUploadDto(), {
      kind, mimeType: 'image/png', sizeBytes: 2 * 1024 * 1024,
    }), options)).toEqual([]);
    expect(await validate(Object.assign(new CompleteBrandingUploadDto(), {
      kind, objectKey: 'clients/client-1/branding/image.png',
    }), options)).toEqual([]);
  });

  it.each([
    { kind: 'other', mimeType: 'image/png', sizeBytes: 1 },
    { kind: 'logo', mimeType: 'image/svg+xml', sizeBytes: 1 },
    { kind: 'logo', mimeType: 'image/png', sizeBytes: 0 },
    { kind: 'logo', mimeType: 'image/png', sizeBytes: 2 * 1024 * 1024 + 1 },
  ])('rejects unsupported or oversized uploads: %j', async (body) => {
    expect((await validate(Object.assign(new BrandingUploadDto(), body), options)).length).toBeGreaterThan(0);
  });
});
