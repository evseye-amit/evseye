import { describe, expect, it, vi } from 'vitest';
import { legalHash } from './legal-acceptance.js';

type LegalSeedDocument = {
  appCode: string;
  role: string;
  kind: string;
  locale: string;
  version: string;
  content: string;
  acceptance?: Record<string, string> | null;
  contentHash: string;
  publishedAt: string | null;
  retiredAt: string | null;
  deletedAt: string | null;
};

describe('Yogmaya legal seed', () => {
  it('keeps all published documents and localized consent metadata intact', async () => {
    const { legalDocumentCatalog, seedLegal } = await import('../../prisma/client/yogmaya/yogmaya-legal-documents.mjs') as unknown as {
      legalDocumentCatalog: LegalSeedDocument[];
      seedLegal: (prisma: unknown) => Promise<void>;
    };
    const creates: Array<Record<string, unknown>> = [];
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-yogmaya' }) },
      appLegalDocument: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return data;
        }),
        update: vi.fn(),
      },
    };

    expect(legalDocumentCatalog).toHaveLength(65);
    expect(legalDocumentCatalog.filter(document => document.acceptance)).toHaveLength(13);
    expect(legalDocumentCatalog.every(document => document.acceptance !== null)).toBe(true);
    expect(legalDocumentCatalog.every(document => document.publishedAt !== null)).toBe(true);
    expect(legalDocumentCatalog.every(document => document.retiredAt === null && document.deletedAt === null)).toBe(true);
    for (const document of legalDocumentCatalog)
      expect(document.contentHash).toBe(legalHash(document.content, document.acceptance));

    await seedLegal(prisma);

    expect(creates).toHaveLength(65);
    expect(creates.filter(document => document.acceptance && document.kind === 'PRIVACY_CONSENT')).toHaveLength(13);
    expect(creates.every(document => document.publishedAt instanceof Date)).toBe(true);
  });

  it('enriches exact legacy published rows without changing their publication state', async () => {
    const { legalDocumentCatalog, seedLegal } = await import('../../prisma/client/yogmaya/yogmaya-legal-documents.mjs') as unknown as {
      legalDocumentCatalog: LegalSeedDocument[];
      seedLegal: (prisma: unknown) => Promise<void>;
    };
    const keyFor = (document: Pick<LegalSeedDocument, 'appCode' | 'role' | 'kind' | 'locale' | 'version'>) =>
      [document.appCode, document.role, document.kind, document.locale, document.version].join('|');
    const rows = new Map(legalDocumentCatalog.map(document => [keyFor(document), {
      id: `existing-${keyFor(document)}`,
      clientId: 'client-yogmaya', ...document,
      contentHash: legalHash(document.content), acceptance: null,
      publishedAt: new Date('2026-10-18T00:00:00.000Z'),
      retiredAt: null, deletedAt: null, createdAt: new Date('2026-10-17T00:00:00.000Z'),
    }]));
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-yogmaya' }) },
      appLegalDocument: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: LegalSeedDocument }) => rows.get(keyFor(where as LegalSeedDocument))),
        create: vi.fn().mockImplementation(() => { throw new Error('legacy rows should not be created'); }),
        update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = [...rows.values()].find(value => value.id === where.id);
          Object.assign(row!, data);
          updates.push({ data });
          return row;
        }),
      },
    };

    await seedLegal(prisma);

    expect(updates).toHaveLength(13);
    expect(updates.every(({ data }) => Object.keys(data).sort().join(',') === 'acceptance,contentHash')).toBe(true);
    expect([...rows.values()].every(row => row.publishedAt instanceof Date)).toBe(true);
    expect([...rows.values()].filter(row => row.acceptance).length).toBe(13);
    expect([...rows.values()].every(row => row.retiredAt === null && row.deletedAt === null)).toBe(true);
  });

  it('rejects a published row whose content differs even when its hash matches', async () => {
    const { legalDocumentCatalog, seedLegal } = await import('../../prisma/client/yogmaya/yogmaya-legal-documents.mjs') as unknown as {
      legalDocumentCatalog: LegalSeedDocument[];
      seedLegal: (prisma: unknown) => Promise<void>;
    };
    const target = legalDocumentCatalog[0];
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-yogmaya' }) },
      appLegalDocument: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing', publishedAt: new Date(), content: `${target.content} changed`,
          contentHash: legalHash(target.content), acceptance: null }),
        create: vi.fn(), update: vi.fn(),
      },
    };

    await expect(seedLegal(prisma)).rejects.toThrow('Published legal document differs from seed');
  });

  it('rejects a published row with different acceptance wording', async () => {
    const { legalDocumentCatalog, seedLegal } = await import('../../prisma/client/yogmaya/yogmaya-legal-documents.mjs') as unknown as {
      legalDocumentCatalog: LegalSeedDocument[];
      seedLegal: (prisma: unknown) => Promise<void>;
    };
    const target = legalDocumentCatalog.find(document => document.acceptance)!;
    const keyFor = (document: Pick<LegalSeedDocument, 'appCode' | 'role' | 'kind' | 'locale' | 'version'>) =>
      [document.appCode, document.role, document.kind, document.locale, document.version].join('|');
    const targetKey = keyFor(target);
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-yogmaya' }) },
      appLegalDocument: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: LegalSeedDocument }) => {
          const document = legalDocumentCatalog.find(value => keyFor(value) === keyFor(where as LegalSeedDocument))!;
          return keyFor(document) === targetKey
            ? { id: 'existing-target', publishedAt: new Date(), content: document.content,
              contentHash: document.contentHash,
              acceptance: { ...document.acceptance, checkboxLabel: 'Different wording' } }
            : { id: `existing-${keyFor(document)}`, publishedAt: new Date(), content: document.content,
              contentHash: document.contentHash, acceptance: document.acceptance ?? null };
        }),
        create: vi.fn(), update: vi.fn(),
      },
    };

    await expect(seedLegal(prisma)).rejects.toThrow('Published legal document differs from seed');
  });
});
