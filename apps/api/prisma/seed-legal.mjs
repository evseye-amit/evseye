import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function legalSeedData() {
  const snapshot = JSON.parse(await readFile(new URL('./legal-seed-data.json', import.meta.url), 'utf8'));
  if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.templates) || !Array.isArray(snapshot.documents)) {
    throw new Error('Unsupported legal seed snapshot. Export it again from the development database.');
  }
  return snapshot;
}

async function translatedLegalTemplates() {
  let file;
  try {
    file = await readFile(new URL('./legal-seed-translations.json', import.meta.url), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const snapshot = JSON.parse(file);
  const locales = ['as', 'bn', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur'];
  const { templates: english } = await legalSeedData();
  const source = english.filter((template) => template.locale === 'en' && template.isActive);
  if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.templates) ||
      snapshot.templates.length !== source.length * locales.length)
    throw new Error('The legal translation seed must contain every document in all 12 Indian languages.');
  const identities = new Set();
  for (const template of snapshot.templates) {
    const original = source.find((candidate) => candidate.appCode === template.appCode &&
      candidate.role === template.role && candidate.kind === template.kind && candidate.version === template.version);
    const identity = `${template.appCode}:${template.role}:${template.kind}:${template.locale}:${template.version}`;
    if (!original || !locales.includes(template.locale) || identities.has(identity) ||
        typeof template.content !== 'string' || typeof template.title !== 'string' ||
        !template.content.includes('[CLIENT_REVIEW_REQUIRED') ||
        JSON.stringify((template.content.match(/\{\{[^{}]+\}\}/g) ?? []).sort()) !==
        JSON.stringify((original.content.match(/\{\{[^{}]+\}\}/g) ?? []).sort()))
      throw new Error(`Invalid or duplicate legal translation seed: ${identity}`);
    identities.add(identity);
  }
  return snapshot.templates;
}

export async function seedLegalTemplates(prisma) {
  const { templates } = await legalSeedData();
  for (const template of [...templates, ...await translatedLegalTemplates()]) {
    const { appCode, role, kind, locale, version, title, content, isActive } = template;
    await prisma.appLegalTemplate.upsert({
      where: { appCode_role_kind_locale_version: { appCode, role, kind, locale, version } },
      create: { appCode, role, kind, locale, version, title, content, isActive },
      update: {},
    });
  }
}

// Existing clients receive English placeholders for each locale as unpublished drafts.
// A published document, or any document edited in the portal, is never overwritten.
export async function seedLocalizedLegalDrafts(prisma) {
  const templates = await translatedLegalTemplates();
  const clients = await prisma.client.findMany({ include: { businessProfile: true } });
  const escape = (value) => value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  for (const client of clients) {
    const legalName = client.businessProfile?.legalCompanyName?.trim() ||
      '[CLIENT_REVIEW_REQUIRED: legal company name]';
    for (const template of templates) {
      const identity = { clientId: client.id, appCode: template.appCode, role: template.role,
        kind: template.kind, locale: template.locale, version: template.version };
      if (await prisma.appLegalDocument.findFirst({ where: identity })) continue;
      const content = template.content.replaceAll('{{CLIENT_LEGAL_NAME}}', escape(legalName))
        .replaceAll('{{CLIENT_NAME}}', escape(client.name))
        .replaceAll('{{CLIENT_CODE}}', escape(client.companyCode || client.slug));
      await prisma.appLegalDocument.create({ data: {
        ...identity, title: template.title, content,
        contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
        effectiveAt: new Date(),
      } });
    }
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

// The new privacy-consent template must also reach clients created before it existed.
// Copies are drafts: the source form contains client-specific facts requiring review.
export async function seedRiderPrivacyConsentDrafts(prisma) {
  const { templates } = await legalSeedData();
  const template = templates.find((item) => item.appCode === 'RIDER' && item.role === 'RIDER' &&
    item.kind === 'PRIVACY_CONSENT' && item.locale === 'en' && item.isActive);
  if (!template) throw new Error('Mandatory Rider privacy-consent template is absent.');
  const clients = await prisma.client.findMany({ include: { businessProfile: true } });
  for (const client of clients) {
    const existing = await prisma.appLegalDocument.findFirst({ where: {
      clientId: client.id, appCode: 'RIDER', role: 'RIDER', kind: 'PRIVACY_CONSENT',
      locale: template.locale, deletedAt: null,
    } });
    if (existing) continue;
    const legalName = client.businessProfile?.legalCompanyName?.trim() ||
      '[CLIENT_REVIEW_REQUIRED: legal company name]';
    const escape = (value) => value.replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const content = template.content.replaceAll('{{CLIENT_LEGAL_NAME}}', escape(legalName))
      .replaceAll('{{CLIENT_NAME}}', escape(client.name))
      .replaceAll('{{CLIENT_CODE}}', escape(client.companyCode || client.slug));
    await prisma.appLegalDocument.create({ data: {
      clientId: client.id, appCode: 'RIDER', role: 'RIDER', kind: 'PRIVACY_CONSENT',
      locale: template.locale, version: template.version,
      title: template.title, content,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      effectiveAt: new Date(),
    } });
  }
}

// Yogmaya's Fleet Manager documents are review drafts. Keep them unpublished
// until the client-specific facts and final legal wording are approved.
export async function seedYogmayaFleetManagerLegalDrafts(prisma) {
  const { templates } = await legalSeedData();
  const client = await prisma.client.findFirst({
    where: { OR: [{ companyCode: 'yogmaya' }, { slug: 'yogmaya' }] },
    include: { businessProfile: true },
  });
  if (!client) return;
  const legalName = client.businessProfile?.legalCompanyName?.trim() ||
    '[CLIENT_REVIEW_REQUIRED: legal company name]';
  const escape = (value) => value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  for (const kind of ['TERMS_AND_CONDITIONS', 'PRIVACY_POLICY']) {
    const template = templates.find((item) => item.appCode === 'FLEET_MANAGER' &&
      item.role === 'FLEET_MANAGER' && item.kind === kind && item.locale === 'en' && item.isActive);
    if (!template) throw new Error(`Fleet Manager ${kind} template is absent.`);
    const identity = {
      clientId: client.id, appCode: 'FLEET_MANAGER', role: 'FLEET_MANAGER',
      kind, locale: template.locale, version: template.version,
    };
    if (await prisma.appLegalDocument.findFirst({ where: identity })) continue;
    const content = template.content.replaceAll('{{CLIENT_LEGAL_NAME}}', escape(legalName))
      .replaceAll('{{CLIENT_NAME}}', escape(client.name))
      .replaceAll('{{CLIENT_CODE}}', escape(client.companyCode || client.slug));
    await prisma.appLegalDocument.create({ data: {
      ...identity, title: template.title, content,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      effectiveAt: new Date(),
    } });
  }
}
