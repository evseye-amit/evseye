import { readFile } from 'node:fs/promises';

const sources = [
  ['TERMS_AND_CONDITIONS', 'Rider Terms & Conditions', 'yogmaya-rider-terms-1.0.0.html'],
  ['PRIVACY_POLICY', 'Rider Privacy Policy', 'yogmaya-rider-privacy-1.0.0.html'],
];

export async function seedLegalTemplates(prisma) {
  for (const [kind, title, file] of sources) {
    let content = await readFile(new URL(`./legal/${file}`, import.meta.url), 'utf8');
    content = content
      .replaceAll('Yogmaya', '{{CLIENT_LEGAL_NAME}}')
      .replaceAll('yogmaya', '{{CLIENT_CODE}}')
      .replaceAll('help@{{CLIENT_CODE}}.com', '[CLIENT_REVIEW_REQUIRED: client support email]')
      .replace(/\+91[ -]?9911459717/g, '[CLIENT_REVIEW_REQUIRED: client support phone]')
      .replaceAll('Gurugram, Haryana-122001', '[CLIENT_REVIEW_REQUIRED: client registered address]')
      .replaceAll('Gurugram', '[CLIENT_REVIEW_REQUIRED: client location]')
      .replaceAll('Amit Goyal, Director', '[CLIENT_REVIEW_REQUIRED: client grievance officer]')
      .replaceAll('Amit Goyal (Director)', '[CLIENT_REVIEW_REQUIRED: client grievance officer]');
    content = content.replace(/<body([^>]*)>/i, '<body$1><p><strong>[CLIENT_REVIEW_REQUIRED: verify every operational, provider, contact, and retention statement for this client; remove this marker only after legal review]</strong></p>');
    const identity = { appCode: 'RIDER', role: 'RIDER', kind, locale: 'en', version: '1.0.0' };
    const existing = await prisma.appLegalTemplate.findFirst({ where: identity });
    if (!existing) await prisma.appLegalTemplate.create({ data: { ...identity, title, content, isActive: true } });
  }
}
