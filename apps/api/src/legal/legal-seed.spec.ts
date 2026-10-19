import { createHash } from 'node:crypto';
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
