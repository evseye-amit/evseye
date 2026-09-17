import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminService } from './platform-admin.service.js';

function setup() {
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1', status: 'DRAFT' }), findFirst: vi.fn() },
    clientBranding: { upsert: vi.fn() },
    clientBusinessProfile: { update: vi.fn().mockResolvedValue({}) },
  };
  const storage = { createUploadUrl: vi.fn().mockResolvedValue('upload-url'), createDownloadUrl: vi.fn().mockResolvedValue('logo-url'), assertObjectExists: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn() };
  return { prisma, storage, audit, service: new PlatformAdminService(prisma as never, audit as never, storage as never, {} as never) };
}

describe('Client logos', () => {
  it('rejects another client’s uploaded object without modifying the profile', async () => {
    const { service, prisma, storage } = setup();
    await expect(service.completeClientLogoUpload('client-1', { objectKey: 'clients/client-2/logo/11111111-1111-4111-8111-111111111111.png' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.assertObjectExists).not.toHaveBeenCalled();
    expect(prisma.clientBusinessProfile.update).not.toHaveBeenCalled();
  });
  it('does not save a logo until the upload exists', async () => {
    const { service, prisma, storage } = setup();
    storage.assertObjectExists.mockRejectedValue(new Error('missing upload'));
    await expect(service.completeClientLogoUpload('client-1', { objectKey: 'clients/client-1/logo/11111111-1111-4111-8111-111111111111.png' }, 'admin')).rejects.toThrow('missing upload');
    expect(prisma.clientBusinessProfile.update).not.toHaveBeenCalled();
  });
  it('allows branding without a supplied logo and exposes only display information', async () => {
    const { service, prisma, storage } = setup();
    prisma.client.findFirst.mockResolvedValue({ name: 'Example Fleet', businessProfile: { logoObjectKey: null } });
    await expect(service.clientBranding('client-1')).resolves.toEqual({ name: 'Example Fleet', logoUrl: null });
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it('saves the uploaded logo and returns its preview URL', async () => {
    const { service, prisma } = setup();
    const objectKey = 'clients/client-1/logo/11111111-1111-4111-8111-111111111111.png';
    await expect(service.completeClientLogoUpload('client-1', { objectKey }, 'admin')).resolves.toEqual({ logoUrl: 'logo-url' });
    expect(prisma.clientBusinessProfile.update).toHaveBeenCalledWith({ where: { clientId: 'client-1' }, data: { logoObjectKey: objectKey } });
  });
});
