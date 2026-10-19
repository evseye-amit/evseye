import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { defaultConsentAcceptance, legalHash } from './legal-acceptance.js';
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
    })).rejects.toThrow('The legal document has changed');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('records verified Rider consent against its exact document and device time', async () => {
    const consent = { ...document, kind: 'PRIVACY_CONSENT' };
    const upsert = vi.fn().mockResolvedValue({ id: 'acceptance-1' });
    const service = new LegalService({
      appLegalDocument: {
        findUnique: vi.fn().mockResolvedValue(consent),
        findMany: vi.fn().mockResolvedValue([consent]),
      },
      appLegalAcceptance: { upsert },
    } as never);
    const deviceAcceptedAt = new Date(Date.now() - 60_000).toISOString();
    await service.accept('client-1', 'rider-1', [UserRole.RIDER], {
      documentId: consent.id, contentHash: consent.contentHash, deviceAcceptedAt,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_documentId: { userId: 'rider-1', documentId: consent.id } },
      create: expect.objectContaining({ clientId: 'client-1', userId: 'rider-1',
        documentId: consent.id, contentHash: consent.contentHash,
        deviceAcceptedAt: new Date(deviceAcceptedAt) }),
      update: {},
    });
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

  it('stores consent wording and hashes it when creating a draft', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new LegalService({ appLegalDocument: {
      findFirst: vi.fn().mockResolvedValue(null), create,
    } } as never);
    const acceptance = { ...defaultConsentAcceptance, checkboxLabel: 'I agree to this notice.' };
    const content = '<p>Notice</p>';
    await service.createDraft('client-1', {
      appCode: 'RIDER', role: UserRole.RIDER, kind: 'PRIVACY_CONSENT', locale: 'en',
      version: '1.0.0', title: 'Consent', content, acceptance,
      effectiveAt: new Date().toISOString(),
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      acceptance, contentHash: legalHash(content, acceptance),
    }) });
  });

  it('re-hashes and preserves consent wording when publishing a draft', async () => {
    const acceptance = { ...defaultConsentAcceptance, checkboxLabel: 'I agree to this notice.' };
    const draft = { ...document, kind: 'PRIVACY_CONSENT', locale: 'en', title: 'Consent',
      content: '<p>Notice</p>', acceptance, publishedAt: null };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new LegalService({ appLegalDocument: {
      findUnique: vi.fn().mockResolvedValue(draft), updateMany,
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...draft, publishedAt: new Date() }),
    } } as never);
    await service.publishDraft(draft.id, draft.clientId, false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        acceptance, contentHash: legalHash(draft.content, acceptance),
      }),
    }));
  });
});
