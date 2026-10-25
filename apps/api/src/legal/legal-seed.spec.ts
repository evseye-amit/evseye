import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import {
  legalDocumentCatalog,
  seedLegal,
} from '../../prisma/client/yogmaya/yogmaya-legal-documents.mjs';

type LegalData = Record<string, unknown>;
type LegalWhere = Record<string, unknown>;
type ExistingResolver = (where: LegalWhere) => LegalData | null;

const hash = (data: LegalData) => createHash('sha256').update(
  data.acceptance ? JSON.stringify({ content: data.content,
    acceptance: Object.fromEntries(Object.entries(data.acceptance as Record<string, string>).sort(([a], [b]) => a.localeCompare(b))),
  }) : String(data.content), 'utf8').digest('hex');

function fakePrisma(resolve: ExistingResolver = () => null) {
  const creates: LegalData[] = [];
  const updates: Array<{ where: LegalWhere; data: LegalData }> = [];
  const finds: LegalWhere[] = [];
  return {
    prisma: {
      client: {
        findFirst: vi.fn(async () => ({ id: 'yogmaya-client' })),
      },
      appLegalDocument: {
        findFirst: vi.fn(async ({ where }: { where: LegalWhere }) => {
          finds.push(where);
          return resolve(where);
        }),
        create: vi.fn(async ({ data }: { data: LegalData }) => {
          creates.push(data);
          return data;
        }),
        update: vi.fn(async ({ where, data }: { where: LegalWhere; data: LegalData }) => {
          updates.push({ where, data });
          return data;
        }),
      },
    },
    creates,
    updates,
    finds,
  };
}

const targetTerms = () => legalDocumentCatalog.find((document) =>
  document.appCode === 'RIDER' &&
  document.role === 'RIDER' &&
  document.kind === 'TERMS_AND_CONDITIONS' &&
  document.locale === 'en',
)!;

const targetConsent = () => legalDocumentCatalog.find((document) =>
  document.appCode === 'RIDER' &&
  document.role === 'RIDER' &&
  document.kind === 'PRIVACY_CONSENT' &&
  document.locale === 'en',
)!;

const identityKey = (value: LegalWhere) => [
  value.appCode,
  value.role,
  value.kind,
  value.locale,
  value.version,
].join('|');

test('canonical seed retains templates and client-specific consent acceptance', async () => {
  const source = await readFile(new URL('../../prisma/seed.mjs', import.meta.url), 'utf8');
  expect(source).toContain("import { seedLegalTemplates } from './catalog/legal-templates.mjs';");
  expect(source).toContain("import { seedLegal } from './client/yogmaya/yogmaya-legal-documents.mjs';");
  expect(legalDocumentCatalog).toHaveLength(65);
  expect(legalDocumentCatalog.every((document) => document.version === '1.0.0')).toBe(true);
  const consents = legalDocumentCatalog.filter((document) => document.kind === 'PRIVACY_CONSENT');
  expect(consents).toHaveLength(13);
  for (const consent of consents) {
    expect(Object.keys(consent.acceptance ?? {}).sort()).toEqual([
      'checkboxLabel', 'continueLabel', 'declaration', 'declarationTitle',
    ]);
    expect(Object.values(consent.acceptance ?? {}).every((text) => text.trim().length > 0)).toBe(true);
    expect(hash(consent)).toBe(consent.contentHash);
  }
  expect(targetConsent().acceptance?.checkboxLabel).toBe('I have read and understood this consent form and give my consent.');
});

test('seeds published documents idempotently without overwriting them', async () => {
  const published = new Map(legalDocumentCatalog.map((document) => [
    identityKey(document), { id: identityKey(document), contentHash: document.contentHash, publishedAt: new Date() },
  ]));
  const fake = fakePrisma((where) => published.get(identityKey(where)) ?? null);
  await seedLegal(fake.prisma);
  await seedLegal(fake.prisma);
  expect(fake.creates).toHaveLength(0);
  expect(fake.updates).toHaveLength(0);
  expect(fake.finds).toHaveLength(130);
});

test('persists acceptance metadata and acceptance-aware hashes on creation', async () => {
  const model = Prisma.dmmf.datamodel.models.find(({ name }) => name === 'AppLegalDocument');
  expect(model?.fields.some(({ name }) => name === 'acceptance')).toBe(true);
  const fake = fakePrisma();
  await seedLegal(fake.prisma);
  expect(fake.creates).toHaveLength(65);
  expect(fake.updates).toHaveLength(0);
  for (const data of fake.creates) expect(hash(data)).toBe(data.contentHash);
  expect(fake.creates.filter((data) => data.acceptance != null)).toHaveLength(13);
});

test('updates drafts with consent acceptance while preserving a published document', async () => {
  const target = targetTerms();
  const fake = fakePrisma((where) => identityKey(where) === identityKey(target)
    ? { id: 'published-target', contentHash: target.contentHash, publishedAt: new Date() }
    : { id: `draft-${identityKey(where)}`, publishedAt: null });
  await seedLegal(fake.prisma);
  expect(fake.creates).toHaveLength(0);
  expect(fake.updates).toHaveLength(64);
  expect(fake.updates.some(({ where }) => where.id === 'published-target')).toBe(false);
  expect(fake.updates.filter(({ data }) => data.acceptance != null)).toHaveLength(13);
  for (const { data } of fake.updates) expect(hash(data)).toBe(data.contentHash);
});

test('rejects content that differs from a published document', async () => {
  const target = targetTerms();
  const fake = fakePrisma((where) => identityKey(where) === identityKey(target)
    ? { id: 'published-target', contentHash: 'different-hash', publishedAt: new Date() } : null);
  await expect(seedLegal(fake.prisma)).rejects.toThrow('Published legal document differs from seed');
});
