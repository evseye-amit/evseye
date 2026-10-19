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

const hash = (content: string) =>
  createHash('sha256').update(content, 'utf8').digest('hex');

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

test('canonical full seed uses the Yogmaya helper and keeps the published consent metadata', async () => {
  const source = await readFile(new URL('../../prisma/seed.mjs', import.meta.url), 'utf8');
  const consent = targetConsent();

  expect(source).toContain("import { seedLegalTemplates } from './catalog/legal-documents.mjs';");
  expect(source).toContain("import { seedLegal } from './client/yogmaya/yogmaya-legal-documents.mjs';");
  expect(source).not.toContain("import { seedLegal, seedLegalTemplates } from './catalog/legal-documents.mjs';");
  expect(consent).toMatchObject({
    version: '1.0.1',
    effectiveAt: '2026-10-11T18:30:00.000Z',
    publishedAt: '2026-10-19T16:58:22.241Z',
    contentHash: 'bfa82e2286994b0fbcec42d0249d3ff2b44a7644a0beb03e9f8e30bdd449413b',
  });
  expect(consent.acceptance).toEqual({
    declaration: 'I declare that I have understood the points of this consent form and agree in my capacity as the data principal.',
    checkboxLabel: 'I have read and understood this consent form and give my consent.',
    continueLabel: 'Continue',
    declarationTitle: 'Declaration',
  });
});

test('repeats safely with all published documents while leaving consent v1.0.0 untouched', async () => {
  const consent = targetConsent();
  const published = new Map(legalDocumentCatalog.map((document) => [
    identityKey(document),
    { id: `published-${identityKey(document)}`, contentHash: document.contentHash, publishedAt: new Date() },
  ]));
  const legacyKey = identityKey({ ...consent, version: '1.0.0' });
  const fake = fakePrisma((where) => published.get(identityKey(where)) ??
    (identityKey(where) === legacyKey
      ? { id: 'legacy-consent-v1', contentHash: consent.contentHash, publishedAt: new Date('2026-10-19T16:24:27.039Z') }
      : null));

  await seedLegal(fake.prisma);
  await seedLegal(fake.prisma);

  expect(fake.creates).toHaveLength(0);
  expect(fake.updates).toHaveLength(0);
  expect(fake.finds).toHaveLength(130);
  expect(fake.finds.filter((where) => identityKey(where) === identityKey(consent))).toHaveLength(2);
  expect(fake.finds.some((where) => identityKey(where) === legacyKey)).toBe(false);
  expect(fake.updates.some(({ where }) => where.id === 'legacy-consent-v1')).toBe(false);
});

test('keeps source acceptance metadata while creating all documents for the current Prisma model', async () => {
  const appLegalDocument = (Prisma as unknown as {
    dmmf: { datamodel: { models: Array<{ name: string; fields: Array<{ name: string }> }> } };
  }).dmmf.datamodel.models.find(({ name }) => name === 'AppLegalDocument');

  expect(appLegalDocument?.fields.some(({ name }) => name === 'acceptance')).toBe(false);
  expect(legalDocumentCatalog).toHaveLength(65);
  expect(legalDocumentCatalog.filter((document) => document.acceptance != null)).toHaveLength(13);

  const fake = fakePrisma();
  await seedLegal(fake.prisma);

  expect(fake.creates).toHaveLength(65);
  expect(fake.updates).toHaveLength(0);
  expect(fake.creates.every((data) => !Object.hasOwn(data, 'acceptance'))).toBe(true);
  expect(fake.creates.every((data) => hash(String(data.content)) === data.contentHash)).toBe(true);
  expect(fake.creates.find((data) =>
    data.appCode === 'RIDER' && data.kind === 'TERMS_AND_CONDITIONS' && data.locale === 'en',
  )?.version).toBe('1.0.1');
});

test('updates drafts without acceptance and leaves a published v1.0.0 row untouched', async () => {
  const target = targetTerms();
  const fake = fakePrisma((where) => {
    if (where.appCode === target.appCode && where.role === target.role &&
      where.kind === target.kind && where.locale === target.locale && where.version === '1.0.0')
      return { id: 'published-v1', content: 'Published v1.0.0', contentHash: 'legacy-hash', publishedAt: new Date() };
    return { id: `draft-${String(where.version)}`, publishedAt: null };
  });

  await seedLegal(fake.prisma);

  expect(fake.creates).toHaveLength(0);
  expect(fake.updates).toHaveLength(65);
  expect(fake.updates.every(({ data }) => !Object.hasOwn(data, 'acceptance'))).toBe(true);
  expect(fake.updates.every(({ data }) => hash(String(data.content)) === data.contentHash)).toBe(true);
  expect(fake.finds.some((where) =>
    where.appCode === target.appCode && where.role === target.role &&
    where.kind === target.kind && where.locale === target.locale && where.version === '1.0.0',
  )).toBe(false);
  expect(fake.finds.some((where) =>
    where.appCode === target.appCode && where.role === target.role &&
    where.kind === target.kind && where.locale === target.locale && where.version === '1.0.1',
  )).toBe(true);
  expect(fake.updates.some(({ where }) => where.id === 'published-v1')).toBe(false);
});

test('rejects a differing published row for the seeded version', async () => {
  const target = targetTerms();
  const fake = fakePrisma((where) => {
    if (where.appCode === target.appCode && where.role === target.role &&
      where.kind === target.kind && where.locale === target.locale && where.version === target.version)
      return { id: 'published-target', content: 'Different published content', contentHash: 'different-hash', publishedAt: new Date() };
    return null;
  });

  await expect(seedLegal(fake.prisma)).rejects.toThrow('Published legal document differs from seed');
});
