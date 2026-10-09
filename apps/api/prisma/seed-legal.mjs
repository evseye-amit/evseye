import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function legalSeedData() {
  const snapshot = JSON.parse(await readFile(new URL('./legal-seed-data.json', import.meta.url), 'utf8'));
  if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.templates) || !Array.isArray(snapshot.documents)) {
    throw new Error('Unsupported legal seed snapshot. Export it again from the development database.');
  }
  return snapshot;
}

export async function seedLegalTemplates(prisma) {
  const { templates } = await legalSeedData();
  for (const template of templates) {
    const { appCode, role, kind, locale, version, title, content, isActive } = template;
    await prisma.appLegalTemplate.upsert({
      where: { appCode_role_kind_locale_version: { appCode, role, kind, locale, version } },
      create: { appCode, role, kind, locale, version, title, content, isActive },
      update: {},
    });
  }
}

export async function seedLegal(prisma) {
  const { documents } = await legalSeedData();
  for (const document of documents) {
    const { clientCode, appCode, role, kind, locale, version, title, content, contentHash, effectiveAt, publishedAt } = document;
    const calculatedHash = createHash('sha256').update(content, 'utf8').digest('hex');
    if (calculatedHash !== contentHash) throw new Error(`Legal seed hash mismatch: ${clientCode}/${kind}/${version}`);
    const client = await prisma.client.findFirst({
      where: { OR: [{ companyCode: clientCode }, { slug: clientCode }] },
      select: { id: true },
    });
    if (!client) throw new Error(`Client ${clientCode} is absent. Seed clients before legal documents.`);
    const identity = { clientId: client.id, appCode, role, kind, locale, version };
    const existing = await prisma.appLegalDocument.findFirst({ where: identity });
    if (existing) {
      if (existing.contentHash !== contentHash) throw new Error(`Published legal document differs from seed: ${clientCode}/${kind}/${version}`);
      continue;
    }
    await prisma.appLegalDocument.create({ data: {
      ...identity, title, content, contentHash,
      effectiveAt: new Date(effectiveAt), publishedAt: new Date(publishedAt),
    } });
  }
}
