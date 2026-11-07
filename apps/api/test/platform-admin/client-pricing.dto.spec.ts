import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateClientCommercialsDto } from '../../src/platform-admin/dto/client-commercials.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('client pricing validation', () => {
  it('accepts setup and vehicle discounts from 0 to 100 percent', async () => {
    const errors = await validate(Object.assign(new UpdateClientCommercialsDto(), {
      setupDiscountPercent: 0,
      vehicleDiscountPercent: 100,
    }), options);
    expect(errors).toEqual([]);
  });

  it('rejects discounts outside the allowed range', async () => {
    const errors = await validate(Object.assign(new UpdateClientCommercialsDto(), {
      setupDiscountPercent: -1,
      vehicleDiscountPercent: 101,
    }), options);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'setupDiscountPercent',
      'vehicleDiscountPercent',
    ]);
  });

  it('rejects non-numeric discount values', async () => {
    const errors = await validate(Object.assign(new UpdateClientCommercialsDto(), {
      setupDiscountPercent: 'ten',
      vehicleDiscountPercent: 'twenty',
    }), options);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'setupDiscountPercent',
      'vehicleDiscountPercent',
    ]);
  });
});
