import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from '../../src/media/media.service.js';
import { MediaController } from '../../src/media/media.controller.js';
import { UserRole } from '@prisma/client';

function fixture() {
  const db = {
    fleet: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'fleet',
          batteryHistory: [
            {
              batteryId: 'battery',
              installedAt: new Date(),
              battery: { serialNumber: 'BAT-1' },
            },
          ],
          controllerHistory: [],
          iotDevice: null,
        }),
    },
    inspection: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'inspection-a',
          type: 'PRE_ALLOCATION',
          allocationId: 'allocation-a',
          createdAt: new Date(),
        },
        {
          id: 'inspection-b',
          type: 'POST_DEALLOCATION',
          allocationId: 'allocation-b',
          createdAt: new Date(),
        },
      ]),
    },
    fleetPreparation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'preparation',
          createdAt: new Date(),
          revisions: [
            { id: 'revision-1', revision: 1, createdAt: new Date() },
            { id: 'revision-2', revision: 2, createdAt: new Date() },
          ],
          stages: [{ id: 'stage', code: 'BATTERY', revision: 2 }],
        },
      ]),
    },
    photo: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'one', workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: 'inspection-a' },
        { id: 'two', workFlowType: 'FLEET_SUBMISSION', subjectType: 'FLEET', entityId: 'inspection-b' },
        {
          id: 'three',
          workFlowType: 'FLEET_PREPARATION', subjectType: 'OTHER',
          entityId: 'installation:stage:1',
        },
        { id: 'four', workFlowType: 'FLEET_PREPARATION', subjectType: 'FLEET', entityId: 'revision-1' },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const storage = {
    readObject: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  return {
    db,
    storage,
    service: new MediaService(db as never, storage as never),
  };
}

describe('Fleet evidence', () => {
  it('keeps the new panel reader restricted to client operations roles', () => {
    for (const handler of [
      MediaController.prototype.fleetEvidence,
      MediaController.prototype.fleetEvidenceContent,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        UserRole.CLIENT_ADMIN,
        UserRole.FLEET_MANAGER,
      ]);
    }
  });
  it('scopes every source to the client and fleet, separates inspections and retains preparation/stage history', async () => {
    const { db, service } = fixture();
    const groups = await service.fleetEvidence('client-a', 'fleet');
    expect(db.fleet.findFirst.mock.calls[0][0].where).toEqual({
      id: 'fleet',
      clientId: 'client-a',
      deletedAt: null,
    });
    expect(db.inspection.findMany.mock.calls[0][0].where).toEqual({
      clientId: 'client-a',
      allocation: { clientId: 'client-a', fleetId: 'fleet' },
    });
    expect(db.fleetPreparation.findMany.mock.calls[0][0].where).toEqual({
      clientId: 'client-a',
      fleetId: 'fleet',
    });
    expect(db.photo.findMany.mock.calls[0][0]).toMatchObject({
      where: { clientId: 'client-a', status: 'COMPLETE' },
    });
    expect(
      groups.find((g) => g.id === 'inspection-a')?.photos.map((p) => p.id),
    ).toEqual(['one']);
    expect(groups.find((g) => g.id === 'inspection-b')?.category).toBe(
      'Submission',
    );
    expect(
      groups.find((g) => g.id === 'stage')?.photos.map((p) => p.id),
    ).toEqual(['three']);
    expect(
      groups.find((g) => g.id === 'revision-1')?.photos.map((p) => p.id),
    ).toEqual(['four']);
    expect(groups.find((g) => g.id === 'revision-2')?.photos).toEqual([]);
  });
  it('rejects missing, deleted or other-client fleets before reading photos', async () => {
    const { db, service, storage } = fixture();
    db.fleet.findFirst.mockResolvedValue(null as never);
    await expect(
      service.fleetEvidence('client-a', 'other-fleet'),
    ).rejects.toThrow('Fleet not found.');
    expect(db.photo.findMany).not.toHaveBeenCalled();
    expect(storage.readObject).not.toHaveBeenCalled();
  });
  it('does not serve an unrelated or incomplete photo', async () => {
    const { db, storage, service } = fixture();
    await expect(
      service.fleetEvidenceContent('client-a', 'fleet', 'unrelated'),
    ).rejects.toThrow('Fleet evidence photo not found.');
    expect(db.photo.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'unrelated',
        clientId: 'client-a',
        status: 'COMPLETE',
        OR: expect.arrayContaining([
          { workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: 'inspection-a' },
        ]),
      },
    });
    expect(storage.readObject).not.toHaveBeenCalled();
  });
  it('reads valid private bytes with a strict size limit and rejects unsafe content', async () => {
    const { db, storage, service } = fixture();
    db.photo.findFirst.mockResolvedValue({
      id: 'photo',
      mimeType: 'image/png',
      sizeBytes: 3,
      objectKey: 'private/key',
    } as never);
    expect(
      await service.fleetEvidenceContent('client-a', 'fleet', 'photo'),
    ).toMatchObject({
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(storage.readObject).toHaveBeenCalledWith('private/key', 3);
    storage.readObject.mockClear();
    db.photo.findFirst.mockResolvedValue({
      id: 'photo',
      mimeType: 'text/html',
      sizeBytes: 3,
    } as never);
    await expect(
      service.fleetEvidenceContent('client-a', 'fleet', 'photo'),
    ).rejects.toThrow('cannot be previewed');
    expect(storage.readObject).not.toHaveBeenCalled();
  });
});
