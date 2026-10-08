import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { LegalService } from './legal.service.js';

const document = {
  id: 'document-1', clientId: 'client-1', appCode: 'RIDER', role: UserRole.RIDER,
  kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: 'v1', contentHash: 'a'.repeat(64),
  publishedAt: new Date(), deletedAt: null,
};

describe('LegalService', () => {
  it('uses a client document before the platform fallback', async () => {
    const findMany = vi.fn().mockResolvedValue([document]);
    const findFirst = vi.fn();
    const service = new LegalService({ appLegalDocument: { findMany, findFirst } } as never);
    expect((await service.current('client-1', 'RIDER', UserRole.RIDER, 'TERMS_AND_CONDITIONS', 'en')).id).toBe(document.id);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects acknowledgement when a newer document is current', async () => {
    const upsert = vi.fn();
    const service = new LegalService({
      appLegalDocument: {
        findUnique: vi.fn().mockResolvedValue(document),
        findMany: vi.fn().mockResolvedValue([{ ...document, id: 'document-2' }]),
      },
      appLegalAcceptance: { upsert },
    } as never);
    await expect(service.accept('client-1', 'user-1', [UserRole.RIDER], {
      documentId: document.id, contentHash: document.contentHash,
    })).rejects.toThrow('Terms have changed');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cannot soft-delete a published document', async () => {
    const updateMany = vi.fn();
    const service = new LegalService({
      appLegalDocument: { findUnique: vi.fn().mockResolvedValue(document), updateMany },
    } as never);
    await expect(service.deleteDraft(document.id, document.clientId, false))
      .rejects.toThrow('Published documents cannot be deleted');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes a draft only while it remains unpublished', async () => {
    const draft = { ...document, publishedAt: null };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new LegalService({ appLegalDocument: {
      findUnique: vi.fn().mockResolvedValue(draft), updateMany,
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...draft, deletedAt: new Date() }),
    } } as never);
    await service.deleteDraft(draft.id, draft.clientId, false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: draft.id, publishedAt: null, deletedAt: null },
    }));
  });

  it('does not serve an unpublished draft as current terms', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new LegalService({ appLegalDocument: { findMany, findFirst } } as never);
    await expect(service.current('client-1', 'RIDER', UserRole.RIDER, 'TERMS_AND_CONDITIONS', 'en'))
      .rejects.toThrow('Legal document unavailable');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null }, deletedAt: null });
  });
});
