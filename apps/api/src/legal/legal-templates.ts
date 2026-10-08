import { BadRequestException } from '@nestjs/common';
import { Prisma, type Client } from '@prisma/client';
import { createHash } from 'node:crypto';

const placeholders = new Set(['CLIENT_LEGAL_NAME', 'CLIENT_NAME', 'CLIENT_CODE']);

export function validateLegalTemplate(value: string) {
  const found = value.match(/\{\{[^{}]+\}\}/g) ?? [];
  for (const token of found) {
    if (!placeholders.has(token.slice(2, -2)))
      throw new BadRequestException(`Unsupported template placeholder: ${token}`);
  }
  if (/\{\{|\}\}/.test(value.replace(/\{\{[^{}]+\}\}/g, '')))
    throw new BadRequestException('Invalid template placeholder.');
}

export function renderLegalTemplate(value: string, client: Pick<Client, 'name' | 'companyCode' | 'slug'>, legalName: string, html = false) {
  const escape = (text: string) => html ? text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) : text;
  const values: Record<string, string> = {
    CLIENT_LEGAL_NAME: escape(legalName),
    CLIENT_NAME: escape(client.name),
    CLIENT_CODE: escape(client.companyCode ?? client.slug),
  };
  return value.replace(/\{\{(CLIENT_LEGAL_NAME|CLIENT_NAME|CLIENT_CODE)\}\}/g, (_, key: string) => values[key]);
}

export async function copyLegalTemplatesToClient(
  tx: Prisma.TransactionClient,
  client: Pick<Client, 'id' | 'name' | 'companyCode' | 'slug'>,
  legalName: string,
) {
  const templates = await tx.appLegalTemplate.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
  const copied = new Set<string>();
  for (const template of templates) {
    const key = `${template.appCode}\u0000${template.role}\u0000${template.kind}\u0000${template.locale}`;
    if (copied.has(key)) continue;
    copied.add(key);
    const content = renderLegalTemplate(template.content, client, legalName, true);
    await tx.appLegalDocument.create({ data: {
      clientId: client.id, appCode: template.appCode, role: template.role,
      kind: template.kind, locale: template.locale, version: template.version,
      title: renderLegalTemplate(template.title, client, legalName), content,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'), effectiveAt: new Date(),
    } });
  }
}
