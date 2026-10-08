import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function seedLegal(prisma) {
  const clientCode = 'yogmaya';
  const content = await readFile(new URL('./legal/yogmaya-rider-terms-1.0.0.html', import.meta.url), 'utf8');
  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
  const client = await prisma.client.findFirst({ where: { OR: [{ companyCode: clientCode }, { slug: clientCode }] }, select: { id: true } });
  if (!client) throw new Error('Yogmaya client is absent. Run the development client seed first.');
  const identity = {
    clientId: client.id,
    appCode: 'RIDER',
    role: 'RIDER',
    kind: 'TERMS_AND_CONDITIONS',
    locale: 'en',
    version: '1.0.0',
  };
  const existing = await prisma.appLegalDocument.findFirst({ where: identity });
  if (existing) {
    if (existing.contentHash !== contentHash) throw new Error('Published Yogmaya Rider Terms 1.0.0 differs from the seed. Publish a new version instead.');
  }
  await prisma.$transaction(async (tx) => {
    if (!existing) await tx.appLegalDocument.create({ data: {
      id: randomUUID(), ...identity, title: 'Rider Terms & Conditions', content, contentHash,
      effectiveAt: new Date('2026-10-01T00:00:00+05:30'),
      publishedAt: new Date(),
    } });
    await tx.appLegalDocument.updateMany({
      where: {
        clientId: client.id,
        appCode: identity.appCode,
        role: identity.role,
        kind: identity.kind,
        locale: identity.locale,
        version: { not: identity.version },
        retiredAt: null,
      },
      data: { retiredAt: new Date() },
    });
  });

  const privacyContent = await readFile(new URL('./legal/yogmaya-rider-privacy-1.0.0.html', import.meta.url), 'utf8');
  const privacyHash = createHash('sha256').update(privacyContent, 'utf8').digest('hex');
  const privacyIdentity = { ...identity, kind: 'PRIVACY_POLICY' };
  const privacyExisting = await prisma.appLegalDocument.findFirst({ where: privacyIdentity });
  if (privacyExisting) {
    if (privacyExisting.contentHash !== privacyHash) throw new Error('Published Yogmaya Rider Privacy Policy 1.0.0 differs from the seed. Publish a new version instead.');
    if (!privacyExisting.publishedAt) throw new Error('Yogmaya Rider Privacy Policy 1.0.0 exists as a draft. Publish it through Client Operations.');
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.appLegalDocument.create({ data: {
      id: randomUUID(), ...privacyIdentity, title: 'Rider Privacy Policy',
      content: privacyContent, contentHash: privacyHash,
      effectiveAt: new Date('2026-10-01T00:00:00+05:30'), publishedAt: new Date(),
    } });
    await tx.appLegalDocument.updateMany({
      where: {
        clientId: client.id, appCode: privacyIdentity.appCode,
        role: privacyIdentity.role, kind: privacyIdentity.kind,
        locale: privacyIdentity.locale, version: { not: privacyIdentity.version },
        retiredAt: null,
      },
      data: { retiredAt: new Date() },
    });
  });
}
