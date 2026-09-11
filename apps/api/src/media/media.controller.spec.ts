import { describe, expect, it, vi } from 'vitest';
import { MediaController } from './media.controller.js';

describe('MediaController audit trail', () => {
  it('records completed photo metadata without recording object storage details', async () => {
    const media = {
      complete: vi.fn().mockResolvedValue({
        id: 'photo-1',
        entityType: 'FLEET',
        entityId: 'fleet-1',
        photoType: 'FRONT',
        status: 'COMPLETE',
        objectKey: 'private/object-key',
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    const controller = new MediaController(
      media as never,
      audit as never,
      { requireTenantId: vi.fn().mockReturnValue('tenant-a') } as never,
    );

    await expect(
      controller.complete(
        { id: 'operator-1', tenantId: 'tenant-a', roles: [] },
        'photo-1',
      ),
    ).resolves.toMatchObject({ data: { id: 'photo-1' } });
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      action: 'PHOTO_UPLOADED',
      entityType: 'FLEET',
      entityId: 'fleet-1',
      newData: {
        photoId: 'photo-1',
        photoType: 'FRONT',
        status: 'COMPLETE',
      },
    });
  });
});
