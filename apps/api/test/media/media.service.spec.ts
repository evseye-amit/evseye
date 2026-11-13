import { PhotoSubjectType, PhotoType, PhotoWorkflowType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from '../../src/media/media.service.js';

describe('MediaService photo requirements', () => {
  it('keeps support attachments on dedicated support routes', async () => {
    const service = new MediaService({} as never, {} as never);
    await expect(service.requirements('client-a', PhotoWorkflowType.SUPPORT, PhotoSubjectType.SUPPORT_TICKET)).rejects.toThrow('Support attachments use the support ticket routes.');
    await expect(service.upsertRequirement('client-a', PhotoWorkflowType.SUPPORT, PhotoSubjectType.SUPPORT_TICKET, 'EVIDENCE' as never, { isRequired: false })).rejects.toThrow('Support attachments use the support ticket routes.');
  });

  it('queries photo requirements by workflow, subject, and client', async () => {
    const findMany = vi.fn().mockResolvedValue([{ photoType: 'FRONT', isRequired: true }]);
    const service = new MediaService({ photoRequirement: { findMany } } as never, {} as never);
    await expect(service.requirements('client-a', PhotoWorkflowType.FLEET_ALLOTMENT, PhotoSubjectType.FLEET)).resolves.toEqual([{ photoType: 'FRONT', isRequired: true }]);
    expect(findMany).toHaveBeenCalledWith({ where: { clientId: 'client-a', workFlowType: PhotoWorkflowType.FLEET_ALLOTMENT, subjectType: PhotoSubjectType.FLEET }, orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }] });
  });

  it('lists photos only after confirming entity ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([{ photoType: 'FRONT' }]);
    const service = new MediaService({ fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) }, photo: { findMany } } as never, {} as never);
    await expect(service.listEntityPhotos('client-a', PhotoWorkflowType.FLEET_INSPECTION, PhotoSubjectType.FLEET, 'fleet-1')).resolves.toEqual([{ photoType: 'FRONT' }]);
    expect(findMany).toHaveBeenCalledWith({ where: { clientId: 'client-a', workFlowType: PhotoWorkflowType.FLEET_INSPECTION, subjectType: PhotoSubjectType.FLEET, entityId: 'fleet-1' }, orderBy: { uploadedAt: 'asc' } });
  });
});

describe('MediaService upload completion', () => {
  it('uses storage validation without rereading the full object with a header-sized limit', async () => {
    const photo = {
      id: 'photo-1',
      clientId: 'client-a',
      workFlowType: PhotoWorkflowType.RIDER_ONBOARDING,
      subjectType: PhotoSubjectType.DECLARATION,
      entityId: 'progress-1',
      photoType: 'DOCUMENT',
      objectKey: 'clients/client-a/rider_onboarding/progress-1/photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 339283,
      status: 'PENDING_UPLOAD',
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const update = vi.fn().mockResolvedValue({ ...photo, status: 'COMPLETE' });
    const prisma = {
      photo: { findFirst: vi.fn().mockResolvedValue(photo) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ photo: { updateMany, update } })),
    };
    const storage = {
      assertObjectExists: vi.fn().mockResolvedValue(undefined),
      readObject: vi.fn(),
    };
    const service = new MediaService(prisma as never, storage as never);

    await expect(service.complete('client-a', photo.id)).resolves.toMatchObject({ status: 'COMPLETE' });
    expect(storage.assertObjectExists).toHaveBeenCalledWith(photo.objectKey, { maxBytes: photo.sizeBytes });
    expect(storage.readObject).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('keeps multiple damage photos complete instead of replacing the previous photo', async () => {
    const photo = {
      id: 'damage-2',
      clientId: 'client-a',
      workFlowType: PhotoWorkflowType.FLEET_SUBMISSION,
      subjectType: PhotoSubjectType.FLEET,
      entityId: 'inspection-1',
      photoType: PhotoType.DAMAGE,
      objectKey: 'clients/client-a/fleet_submission/inspection-1/damage-2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 339283,
      status: 'PENDING_UPLOAD',
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ ...photo, status: 'COMPLETE' });
    const prisma = {
      photo: { findFirst: vi.fn().mockResolvedValue(photo) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ photo: { updateMany, update }, vehicleSubmissionReport: { findMany: vi.fn().mockResolvedValue([]) }, $queryRaw: vi.fn() })),
    };
    const storage = { assertObjectExists: vi.fn().mockResolvedValue(undefined) };
    const service = new MediaService(prisma as never, storage as never);

    await expect(service.complete('client-a', photo.id)).resolves.toMatchObject({ status: 'COMPLETE' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: photo.id }, data: { status: 'COMPLETE', uploadedAt: expect.any(Date) } });
  });
});

describe('MediaService fleet-manager rider scope', () => {
  const manager = { id: 'manager-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] };
  it('rejects downloads when the rider is outside assigned hubs', async () => {
    const photo = { id: 'p', workFlowType: PhotoWorkflowType.RIDER_ONBOARDING, subjectType: PhotoSubjectType.PROFILE, entityId: 'rider-1', status: 'COMPLETE', objectKey: 'photo.jpg' };
    const service = new MediaService({ photo: { findFirst: vi.fn().mockResolvedValue(photo) }, userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-a' }]) }, $queryRaw: vi.fn().mockResolvedValue([]) } as never, { createDownloadUrl: vi.fn() } as never);
    await expect(service.downloadUrl('client-a', 'p', manager)).rejects.toThrow('Photo not found.');
  });
});
