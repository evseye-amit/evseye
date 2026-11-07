import { createHash } from 'node:crypto';
import { legalDocumentCatalog } from './yogmaya-legal-documents.mjs';

const riderTermsDocument = legalDocumentCatalog.find(
  (document) =>
    document.clientCode === 'yogmaya' &&
    document.appCode === 'RIDER' &&
    document.role === 'RIDER' &&
    document.kind === 'TERMS_AND_CONDITIONS' &&
    document.locale === 'en',
);

if (!riderTermsDocument)
  throw new Error(
    'Yogmaya rider terms document is missing from the legal seed.',
  );

const stagingNotice =
  '<p><strong>STAGING TEST ONLY.</strong> This is not a production rental agreement.</p>\n';
const content = `${stagingNotice}${riderTermsDocument.content}`;

export const yogmayaCommercialTerms = {
  code: 'YOGMAYA_RENTAL_TERMS',
  version: 1,
  title: 'STAGING TEST ONLY — Yogmaya rental terms',
  content,
  contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
};

export async function seedYogmayaCommercialTerms(prisma) {
  // This is a development/staging fixture. Every other environment requires
  // terms to be created and activated by the client administrator.
  if (process.env.NODE_ENV !== 'development') return null;

  const client = await prisma.client.findUnique({ where: { slug: 'yogmaya' } });
  if (!client)
    throw new Error('Yogmaya must be seeded before its commercial terms.');

  const existing = await prisma.riderCommercialTerms.findFirst({
    where: { clientId: client.id },
  });
  if (existing) return existing;

  const actor = await prisma.user.findFirst({
    where: { clientId: client.id, role: 'CLIENT_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  return prisma.riderCommercialTerms.create({
    data: {
      clientId: client.id,
      ...yogmayaCommercialTerms,
      status: 'ACTIVE',
      createdById: actor?.id ?? null,
      activatedById: actor?.id ?? null,
      activatedAt: new Date(),
    },
  });
}
