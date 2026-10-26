import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateSupportReplyDto,
  CreateSupportTicketDto,
  ListSupportTicketsDto,
  SupportAttachmentIntentDto,
  UpdateSupportStatusDto,
} from './dto/support.dto.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class SupportService {
  constructor(private readonly db: PrismaService, private readonly media: MediaService) {}

  private fleetScoped(user: AuthUser) {
    return (
      user.roles.includes(UserRole.FLEET_MANAGER) &&
      !user.roles.some((role) => role === UserRole.CLIENT_ADMIN || role === UserRole.FLEET_MANAGER)
    );
  }

  private async rider(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true, status: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    if (rider.status !== 'ACTIVE') throw new ForbiddenException('Rider account is not active.');
    return rider;
  }

  private async hubIds(clientId: string, userId: string) {
    return (await this.db.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } })).map((row) => row.hubId);
  }

  private async ticket(clientId: string, ticketId: string) {
    const row = await this.db.supportTicket.findFirst({ where: { id: ticketId, clientId } });
    if (!row) throw new NotFoundException('Support ticket not found.');
    return row;
  }

  private async assertAccess(clientId: string, user: AuthUser, ticketId: string, riderId?: string) {
    const row = await this.ticket(clientId, ticketId);
    if (user.roles.includes(UserRole.RIDER)) {
      if (!riderId || row.riderId !== riderId) throw new NotFoundException('Support ticket not found.');
      return row;
    }
    if (this.fleetScoped(user)) {
      if (!row.hubId || !(await this.hubIds(clientId, user.id)).includes(row.hubId))
        throw new NotFoundException('Support ticket is not in an assigned Hub.');
    }
    return row;
  }

  private async resolveHub(clientId: string, riderId: string) {
    const returned = await this.db.rentalTerminationRequest.findFirst({
      where: { clientId, riderId, status: 'RETURNED', receivedHubId: { not: null } },
      orderBy: { actualTerminationDate: 'desc' },
      select: { receivedHubId: true },
    });
    if (returned?.receivedHubId) return returned.receivedHubId;
    const planned = await this.db.rentalTerminationRequest.findFirst({
      where: { clientId, riderId, plannedHubId: { not: null }, status: { in: ['REQUESTED', 'RETURNED'] } },
      orderBy: { updatedAt: 'desc' },
      select: { plannedHubId: true },
    });
    if (planned?.plannedHubId) return planned.plannedHubId;
    const allocation = await this.db.allocation.findFirst({
      where: { clientId, riderId },
      orderBy: { updatedAt: 'desc' },
      include: { fleet: { select: { currentHubId: true } } },
    });
    return allocation?.fleet.currentHubId ?? null;
  }

  private async serializable<T>(fn: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
        throw error;
      }
    }
  }

  async create(clientId: string, actor: AuthUser, input: CreateSupportTicketDto) {
    const rider = await this.rider(clientId, actor.id);
    const subject = input.subject.trim();
    const message = input.message.trim();
    if (!subject || !message) throw new BadRequestException('Subject and message are required.');
    const hubId = await this.resolveHub(clientId, rider.id);
    return this.serializable(async (tx) => {
      const ticket = await tx.supportTicket.create({ data: { clientId, riderId: rider.id, hubId, status: 'OPEN', subject, description: message, createdById: actor.id } });
      await tx.supportReply.create({ data: { clientId, ticketId: ticket.id, authorId: actor.id, body: message } });
      await tx.auditLog.create({ data: { clientId, actorId: actor.id, action: 'SUPPORT_TICKET_CREATED', entityType: 'SupportTicket', entityId: ticket.id, newData: { hubId } } });
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { replies: true } });
    });
  }

  private decodeCursor(cursor?: string) {
    if (!cursor) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new BadRequestException('Invalid cursor.'); }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string' || typeof (parsed as { lastActivityAt?: unknown }).lastActivityAt !== 'string') throw new BadRequestException('Invalid cursor.');
    const lastActivityAt = new Date((parsed as { lastActivityAt: string }).lastActivityAt);
    if (Number.isNaN(lastActivityAt.getTime())) throw new BadRequestException('Invalid cursor.');
    return { id: (parsed as { id: string }).id, lastActivityAt };
  }

  async list(clientId: string, actor: AuthUser, query: ListSupportTicketsDto) {
    const cursor = this.decodeCursor(query.cursor);
    const where: Prisma.SupportTicketWhereInput = { clientId, ...(query.status ? { status: query.status } : {}), ...(query.hubId ? { hubId: query.hubId } : {}) };
    if (actor.roles.includes(UserRole.RIDER)) {
      const rider = await this.rider(clientId, actor.id);
      where.riderId = rider.id;
    } else if (this.fleetScoped(actor)) {
      where.hubId = { in: await this.hubIds(clientId, actor.id) };
    }
    if (cursor) where.AND = [{ OR: [{ lastActivityAt: { lt: cursor.lastActivityAt } }, { lastActivityAt: cursor.lastActivityAt, id: { lt: cursor.id } }] }];
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const rows = await this.db.supportTicket.findMany({ where, orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      include: { rider: { select: { id: true, name: true, mobile: true } }, hub: { select: { id: true, name: true, code: true } } },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, lastActivityAt: last.lastActivityAt.toISOString() })).toString('base64url') : null };
  }

  async get(clientId: string, actor: AuthUser, ticketId: string) {
    const rider = actor.roles.includes(UserRole.RIDER) ? await this.rider(clientId, actor.id) : undefined;
    const row = await this.assertAccess(clientId, actor, ticketId, rider?.id);
    const [ticket, photos] = await Promise.all([
      this.db.supportTicket.findUniqueOrThrow({ where: { id: row.id }, include: { rider: { select: { id: true, name: true, mobile: true } }, hub: { select: { id: true, name: true, code: true } },
        replies: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } }),
      this.db.photo.findMany({ where: { clientId, entityType: 'SUPPORT_TICKET', workFlowType: 'SUPPORT', subjectType: 'SUPPORT_TICKET', entityId: row.id, status: 'COMPLETE' }, orderBy: { uploadedAt: 'asc' } }),
    ]);
    const authors = ticket.replies.length ? await this.db.user.findMany({
      where: { clientId, id: { in: [...new Set(ticket.replies.map((reply) => reply.authorId))] } },
      select: { id: true, name: true, role: true },
    }) : [];
    const byId = new Map(authors.map((author) => [author.id, author]));
    return { ...ticket, replies: ticket.replies.map((reply) => ({ ...reply, author: byId.get(reply.authorId) ?? null })), photos };
  }

  async reply(clientId: string, actor: AuthUser, ticketId: string, input: CreateSupportReplyDto) {
    const rider = actor.roles.includes(UserRole.RIDER) ? await this.rider(clientId, actor.id) : undefined;
    await this.assertAccess(clientId, actor, ticketId, rider?.id);
    const body = input.message.trim();
    if (!body) throw new BadRequestException('Reply message is required.');
    return this.serializable(async (tx) => {
      const current = await tx.supportTicket.findFirst({ where: { id: ticketId, clientId } });
      if (!current) throw new NotFoundException('Support ticket not found.');
      const reopened = Boolean(rider && current.status === 'RESOLVED');
      const reply = await tx.supportReply.create({ data: { clientId, ticketId, authorId: actor.id, body } });
      await tx.supportTicket.update({ where: { id: ticketId }, data: { lastActivityAt: new Date(), ...(reopened ? { status: 'OPEN', resolvedAt: null, resolvedById: null } : {}) } });
      if (reopened) await tx.auditLog.create({ data: { clientId, actorId: actor.id, action: 'SUPPORT_TICKET_REOPENED', entityType: 'SupportTicket', entityId: ticketId } });
      return { reply, status: reopened ? 'OPEN' : current.status };
    });
  }

  async updateStatus(clientId: string, actor: AuthUser, ticketId: string, input: UpdateSupportStatusDto) {
    if (actor.roles.includes(UserRole.RIDER)) throw new ForbiddenException('Riders cannot change support ticket status.');
    await this.assertAccess(clientId, actor, ticketId);
    return this.serializable(async (tx) => {
      const current = await tx.supportTicket.findFirst({ where: { id: ticketId, clientId } });
      if (!current) throw new NotFoundException('Support ticket not found.');
      const updated = await tx.supportTicket.update({ where: { id: ticketId }, data: { status: input.status, resolvedAt: input.status === 'RESOLVED' ? new Date() : null, resolvedById: input.status === 'RESOLVED' ? actor.id : null, lastActivityAt: new Date() } });
      await tx.auditLog.create({ data: { clientId, actorId: actor.id, action: 'SUPPORT_TICKET_STATUS_CHANGED', entityType: 'SupportTicket', entityId: ticketId, previousData: { status: current.status }, newData: { status: input.status } } });
      return updated;
    });
  }

  async attachmentIntent(clientId: string, actor: AuthUser, ticketId: string, input: SupportAttachmentIntentDto) {
    const rider = actor.roles.includes(UserRole.RIDER) ? await this.rider(clientId, actor.id) : undefined;
    await this.assertAccess(clientId, actor, ticketId, rider?.id);
    return this.media.createSupportUploadIntent(clientId, actor.id, ticketId, input);
  }

  async completeAttachment(clientId: string, actor: AuthUser, ticketId: string, photoId: string) {
    const rider = actor.roles.includes(UserRole.RIDER) ? await this.rider(clientId, actor.id) : undefined;
    await this.assertAccess(clientId, actor, ticketId, rider?.id);
    return this.media.completeSupport(clientId, ticketId, photoId);
  }

  async attachmentDownloadUrl(clientId: string, actor: AuthUser, ticketId: string, photoId: string) {
    const rider = actor.roles.includes(UserRole.RIDER) ? await this.rider(clientId, actor.id) : undefined;
    await this.assertAccess(clientId, actor, ticketId, rider?.id);
    return this.media.supportDownloadUrl(clientId, ticketId, photoId);
  }
}
