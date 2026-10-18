import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateWorkPartnerDto, UpdateWorkPartnerDto } from './dto/work-partner.dto.js';

describe('work partner DTOs', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it('accepts canonicalizable codes and rejects unsupported status values', async () => {
    await expect(
      pipe.transform(
        { code: ' partner_1 ', name: 'Partner', legalName: 'Partner Legal' },
        { type: 'body', metatype: CreateWorkPartnerDto },
      ),
    ).resolves.toBeInstanceOf(CreateWorkPartnerDto);
    await expect(
      pipe.transform(
        { code: 'PARTNER_1', name: 'Partner', legalName: 'Partner Legal', status: 'SUSPENDED' },
        { type: 'body', metatype: CreateWorkPartnerDto },
      ),
    ).rejects.toThrow();
  });

  it('rejects attempts to change immutable code through the production whitelist pipe', async () => {
    await expect(
      pipe.transform(
        { code: 'NEW_CODE', name: 'Partner' },
        { type: 'body', metatype: UpdateWorkPartnerDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 400,
        message: expect.arrayContaining(['property code should not exist']),
      }),
    });
  });

  it('rejects explicit nulls on optional patch fields instead of passing malformed data to the service', async () => {
    await expect(
      pipe.transform({ name: null }, { type: 'body', metatype: UpdateWorkPartnerDto }),
    ).rejects.toThrow();
  });
});
