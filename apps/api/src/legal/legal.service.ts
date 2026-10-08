import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { validateLegalTemplate } from './legal-templates.js';

export const legalHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

@Injectable()
export class LegalService {
  constructor(private readonly db: PrismaService) {}

  listTemplates() {
    return this.db.appLegalTemplate.findMany({ where: { deletedAt: null }, orderBy: [{ appCode: 'asc' }, { role: 'asc' }, { kind: 'asc' }, { locale: 'asc' }] });
  }

  async createTemplate(input: { appCode: string; role: UserRole; kind: string; locale: string; version: string; title: string; content: string; isActive?: boolean }) {
    validateLegalTemplate(input.title);
    validateLegalTemplate(input.content);
    const identity = { appCode: input.appCode, role: input.role, kind: input.kind, locale: input.locale, version: input.version };
    if (await this.db.appLegalTemplate.findFirst({ where: identity })) throw new BadRequestException('This template version already exists.');
    return this.db.appLegalTemplate.create({ data: { ...identity, title: input.title, content: input.content, isActive: input.isActive ?? true } });
  }

  async updateTemplate(id: string, input: { appCode: string; role: UserRole; kind: string; locale: string; version: string; title: string; content: string; isActive?: boolean }) {
    validateLegalTemplate(input.title);
    validateLegalTemplate(input.content);
    const current = await this.db.appLegalTemplate.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new NotFoundException('Legal template unavailable.');
    const duplicate = await this.db.appLegalTemplate.findFirst({ where: { id: { not: id }, appCode: input.appCode, role: input.role, kind: input.kind, locale: input.locale, version: input.version } });
    if (duplicate) throw new BadRequestException('This template version already exists.');
    return this.db.appLegalTemplate.update({ where: { id }, data: input });
  }

  async deleteTemplate(id: string) {
    const current = await this.db.appLegalTemplate.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new NotFoundException('Legal template unavailable.');
    return this.db.appLegalTemplate.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
  }

  async clientIdForCode(companyCode: string, resolvedClientId?: string) {
    const client = await this.db.client.findFirst({
      where: { OR: [{ companyCode }, { slug: companyCode }], isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client unavailable.');
    if (resolvedClientId && resolvedClientId !== client.id) throw new ForbiddenException('Client mismatch.');
    return client.id;
  }

  async current(clientId: string, appCode: string, role: UserRole, kind: string, locale: string) {
    const now = new Date();
    const documents = await this.db.appLegalDocument.findMany({
      where: { clientId, appCode, role, kind, locale, publishedAt: { not: null }, deletedAt: null,
        effectiveAt: { lte: now }, OR: [{ retiredAt: null }, { retiredAt: { gt: now } }] },
      orderBy: [{ effectiveAt: 'desc' }, { publishedAt: 'desc' }], take: 1,
    });
    const document = documents[0] ?? await this.db.appLegalDocument.findFirst({
      where: { clientId: null, appCode, role, kind, locale, publishedAt: { not: null }, deletedAt: null,
        effectiveAt: { lte: now }, OR: [{ retiredAt: null }, { retiredAt: { gt: now } }] },
      orderBy: [{ effectiveAt: 'desc' }, { publishedAt: 'desc' }],
    });
    if (!document) throw new NotFoundException('Legal document unavailable.');
    return document;
  }

  async accept(clientId: string, userId: string, roles: UserRole[], input: {
    documentId: string; contentHash: string; deviceId?: string; deviceAcceptedAt?: string;
  }) {
    const document = await this.db.appLegalDocument.findUnique({ where: { id: input.documentId } });
    if (!document || !document.publishedAt || document.deletedAt || !roles.includes(document.role) || (document.clientId && document.clientId !== clientId))
      throw new NotFoundException('Legal document unavailable.');
    const current = await this.current(clientId, document.appCode, document.role, document.kind, document.locale);
    if (current.id !== document.id || current.contentHash !== input.contentHash)
      throw new BadRequestException('Terms have changed. Please review the current version.');
    const deviceAcceptedAt = input.deviceAcceptedAt ? new Date(input.deviceAcceptedAt) : undefined;
    if (deviceAcceptedAt && (Number.isNaN(deviceAcceptedAt.valueOf()) || deviceAcceptedAt > new Date()))
      throw new BadRequestException('Invalid device acceptance time.');
    return this.db.appLegalAcceptance.upsert({
      where: { userId_documentId: { userId, documentId: document.id } },
      create: { clientId, userId, documentId: document.id, contentHash: document.contentHash,
        deviceId: input.deviceId, deviceAcceptedAt },
      update: {},
    });
  }

  async publish(clientId: string | null, input: {
    appCode: string; role: UserRole; kind: string; locale: string; version: string;
    title: string; content: string; effectiveAt: string;
  }) {
    if (input.title.includes('[CLIENT_REVIEW_REQUIRED') || input.content.includes('[CLIENT_REVIEW_REQUIRED'))
      throw new BadRequestException('Complete all client-specific legal review fields before publishing.');
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.valueOf())) throw new BadRequestException('Invalid effective date.');
    const existing = await this.db.appLegalDocument.findFirst({ where: {
      clientId, appCode: input.appCode, role: input.role, kind: input.kind,
      locale: input.locale, version: input.version,
    } });
    if (existing) throw new BadRequestException('This document version is already published.');
    return this.db.appLegalDocument.create({ data: {
      clientId, appCode: input.appCode, role: input.role, kind: input.kind,
      locale: input.locale, version: input.version, title: input.title,
      content: input.content, contentHash: legalHash(input.content), effectiveAt, publishedAt: new Date(),
    } });
  }

  async retire(id: string, clientId: string | null, isPlatformAdmin: boolean) {
    const document = await this.db.appLegalDocument.findUnique({ where: { id } });
    if (!document || (!isPlatformAdmin && document.clientId !== clientId))
      throw new NotFoundException('Legal document unavailable.');
    if (!document.publishedAt || document.deletedAt) throw new BadRequestException('Only published documents can be retired.');
    if (document.retiredAt) return document;
    return this.db.appLegalDocument.update({ where: { id }, data: { retiredAt: new Date() } });
  }

  async list(clientId: string | null, isPlatformAdmin: boolean) {
    return this.db.appLegalDocument.findMany({
      where: isPlatformAdmin ? { deletedAt: null } : { clientId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createDraft(clientId: string | null, input: {
    appCode: string; role: UserRole; kind: string; locale: string; version: string;
    title: string; content: string; effectiveAt: string;
  }) {
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.valueOf())) throw new BadRequestException('Invalid effective date.');
    const existing = await this.db.appLegalDocument.findFirst({ where: {
      clientId, appCode: input.appCode, role: input.role, kind: input.kind,
      locale: input.locale, version: input.version,
    } });
    if (existing) throw new BadRequestException('This document version already exists.');
    return this.db.appLegalDocument.create({ data: {
      clientId, appCode: input.appCode, role: input.role, kind: input.kind,
      locale: input.locale, version: input.version, title: input.title,
      content: input.content, contentHash: legalHash(input.content), effectiveAt,
    } });
  }

  async updateDraft(id: string, clientId: string | null, isPlatformAdmin: boolean, input: {
    appCode: string; role: UserRole; kind: string; locale: string; version: string;
    title: string; content: string; effectiveAt: string;
  }) {
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.valueOf())) throw new BadRequestException('Invalid effective date.');
    const document = await this.db.appLegalDocument.findUnique({ where: { id } });
    if (!document || (!isPlatformAdmin && document.clientId !== clientId)) throw new NotFoundException('Legal document unavailable.');
    if (document.publishedAt || document.deletedAt) throw new BadRequestException('Published or deleted documents cannot be edited.');
    const duplicate = await this.db.appLegalDocument.findFirst({ where: {
      id: { not: id }, clientId: document.clientId, appCode: input.appCode,
      role: input.role, kind: input.kind, locale: input.locale, version: input.version,
    } });
    if (duplicate) throw new BadRequestException('This document version already exists.');
    const updated = await this.db.appLegalDocument.updateMany({
      where: { id, publishedAt: null, deletedAt: null },
      data: { appCode: input.appCode, role: input.role, kind: input.kind,
        locale: input.locale, version: input.version, title: input.title,
        content: input.content, contentHash: legalHash(input.content), effectiveAt },
    });
    if (updated.count !== 1) throw new BadRequestException('Document is no longer editable.');
    return this.db.appLegalDocument.findUniqueOrThrow({ where: { id } });
  }

  async publishDraft(id: string, clientId: string | null, isPlatformAdmin: boolean) {
    const document = await this.db.appLegalDocument.findUnique({ where: { id } });
    if (!document || (!isPlatformAdmin && document.clientId !== clientId)) throw new NotFoundException('Legal document unavailable.');
    if (document.publishedAt || document.deletedAt) throw new BadRequestException('Only active drafts can be published.');
    if (document.title.includes('[CLIENT_REVIEW_REQUIRED') || document.content.includes('[CLIENT_REVIEW_REQUIRED'))
      throw new BadRequestException('Complete all client-specific legal review fields before publishing.');
    const updated = await this.db.appLegalDocument.updateMany({
      where: { id, publishedAt: null, deletedAt: null }, data: { publishedAt: new Date() },
    });
    if (updated.count !== 1) throw new BadRequestException('Document is no longer a draft.');
    return this.db.appLegalDocument.findUniqueOrThrow({ where: { id } });
  }

  async deleteDraft(id: string, clientId: string | null, isPlatformAdmin: boolean) {
    const document = await this.db.appLegalDocument.findUnique({ where: { id } });
    if (!document || (!isPlatformAdmin && document.clientId !== clientId)) throw new NotFoundException('Legal document unavailable.');
    if (document.publishedAt || document.deletedAt) throw new BadRequestException('Published documents cannot be deleted.');
    const updated = await this.db.appLegalDocument.updateMany({
      where: { id, publishedAt: null, deletedAt: null }, data: { deletedAt: new Date() },
    });
    if (updated.count !== 1) throw new BadRequestException('Document is no longer a draft.');
    return this.db.appLegalDocument.findUniqueOrThrow({ where: { id } });
  }
}
