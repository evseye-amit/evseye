import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { defaultConsentAcceptance, legalHash } from './legal-acceptance.js';
import { copyLegalTemplatesToClient, renderLegalTemplate, validateLegalTemplate } from './legal-templates.js';
import { LegalService } from './legal.service.js';

describe('legal templates', () => {
  const client = { id: 'client-1', name: 'Example Fleet', companyCode: 'example', slug: 'example' };

  it('fills legal name, display name and code into an unpublished client draft', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { appLegalTemplate: { findMany: vi.fn().mockResolvedValue([{ appCode: 'RIDER', role: UserRole.RIDER,
      kind: 'TERMS_AND_CONDITIONS', locale: 'en', version: '1.0.0',
      title: '{{CLIENT_NAME}} terms', content: '<p>{{CLIENT_LEGAL_NAME}} ({{CLIENT_CODE}})</p>' }]) },
      appLegalDocument: { create } };
    await copyLegalTemplatesToClient(tx as never, client, 'Example Fleet Private Limited');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clientId: client.id, title: 'Example Fleet terms',
      content: '<p>Example Fleet Private Limited (example)</p>',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) });
    expect(create.mock.calls[0][0].data.publishedAt).toBeUndefined();
  });

  it('rejects unknown or malformed placeholders', () => {
    expect(() => validateLegalTemplate('{{CLIENT_EMAIL}}')).toThrow('Unsupported');
    expect(() => validateLegalTemplate('{{CLIENT_LEGAL_NAME')).toThrow('Invalid');
    expect(renderLegalTemplate('{{CLIENT_LEGAL_NAME}}', client, 'Legal Ltd')).toBe('Legal Ltd');
    expect(renderLegalTemplate('<p>{{CLIENT_LEGAL_NAME}}</p>', client, 'A & B <Fleet>', true)).toBe('<p>A &amp; B &lt;Fleet&gt;</p>');
  });

  it('blocks publication until client-specific legal review markers are removed', async () => {
    const service = new LegalService({ appLegalDocument: { findUnique: vi.fn().mockResolvedValue({
      id: 'document-1', clientId: client.id, title: 'Terms', content: '[CLIENT_REVIEW_REQUIRED: contact]',
      publishedAt: null, deletedAt: null,
    }), updateMany: vi.fn() } } as never);
    await expect(service.publishDraft('document-1', client.id, false)).rejects.toThrow('Complete all client-specific');
  });

  it('keeps the mandatory Rider privacy consent template active', async () => {
    const template = { id: 'template-1', appCode: 'RIDER', role: UserRole.RIDER,
      kind: 'PRIVACY_CONSENT', locale: 'en', deletedAt: null };
    const update = vi.fn();
    const service = new LegalService({ appLegalTemplate: {
      findUnique: vi.fn().mockResolvedValue(template), update,
    } } as never);
    await expect(service.deleteTemplate(template.id)).rejects.toThrow('cannot be removed');
    await expect(service.updateTemplate(template.id, { ...template, version: '1',
      title: 'Rider consent', content: '<p>Consent</p>', isActive: false }))
      .rejects.toThrow('must remain active');
    expect(update).not.toHaveBeenCalled();
  });

  it('copies a new mandatory consent template to existing clients as a draft', async () => {
    const createDocument = vi.fn().mockResolvedValue({});
    const tx = {
      appLegalTemplate: { create: vi.fn().mockResolvedValue({ id: 'template-1' }) },
      client: { findMany: vi.fn().mockResolvedValue([{ ...client,
        businessProfile: { legalCompanyName: 'Example Fleet Private Limited' } }]) },
      appLegalDocument: { findFirst: vi.fn().mockResolvedValue(null), create: createDocument },
    };
    const service = new LegalService({
      appLegalTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never);
    await service.createTemplate({ appCode: 'RIDER', role: UserRole.RIDER,
      kind: 'PRIVACY_CONSENT', locale: 'en', version: '1.0.0',
      title: 'Consent', content: '<p>{{CLIENT_LEGAL_NAME}}</p>' });
    expect(createDocument).toHaveBeenCalledWith({ data: expect.objectContaining({
      clientId: client.id, kind: 'PRIVACY_CONSENT',
      content: '<p>Example Fleet Private Limited</p>',
      acceptance: defaultConsentAcceptance,
      contentHash: legalHash('<p>Example Fleet Private Limited</p>', defaultConsentAcceptance),
    }) });
    expect(createDocument.mock.calls[0][0].data.publishedAt).toBeUndefined();
  });
});
