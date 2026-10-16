import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  indianMobileVariants,
  normalizeIndianMobile,
} from '../common/phone.js';
import { PUSH_PROVIDER, type PushProvider } from './firebase-push.provider.js';
import {
  afterCursor,
  decodeCursor,
  digest,
  encodeCursor,
  hash,
  notificationContent,
  parsePhones,
} from './notification.helpers.js';
import type {
  NotificationAudienceDto,
  NotificationPageDto,
  RegisterPushDeviceDto,
  SendNotificationDto,
} from './notification.dto.js';

type Tx = Prisma.TransactionClient;
type Audience = NotificationAudienceDto & { userIds?: string[] };
const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
        });
      } catch (cause) {
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(cause.code) &&
          attempt < 3
        )
          continue;
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === 'P2002'
        )
          throw new ConflictException(
            'Notification state changed concurrently. Please retry.',
          );
        throw cause;
      }
    }
  }
  private assertStaff(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'].includes(role),
      )
    )
      throw new ForbiddenException(
        'Only client admins and operations managers may send notifications.',
      );
  }
  async registerDevice(
    clientId: string,
    actor: AuthUser,
    input: RegisterPushDeviceDto,
  ) {
    if (
      (input.appCode === 'RIDER_APP' && !actor.roles.includes('RIDER')) ||
      (input.appCode === 'FLEET_MANAGER_APP' &&
        !actor.roles.includes('FLEET_MANAGER'))
    )
      throw new ForbiddenException(
        'This app does not match your account role.',
      );
    if (!actor.sessionId)
      throw new UnauthorizedException(
        'An active login session is required for device registration.',
      );
    const tokenHash = hash(input.token);
    return this.transaction(async (tx) => {
      const session = await tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { clientId, isActive: true, deletedAt: null },
        },
      });
      if (!session) throw new UnauthorizedException('Session is unavailable.');
      await tx.pushDevice.updateMany({
        where: {
          tokenHash,
          isActive: true,
          NOT: { installationId: input.installationId, appCode: input.appCode },
        },
        data: {
          isActive: false,
          disabledReason: 'TOKEN_REGISTERED_TO_ANOTHER_INSTALLATION',
        },
      });
      const old = await tx.pushDevice.findUnique({
        where: {
          installationId_appCode: {
            installationId: input.installationId,
            appCode: input.appCode,
          },
        },
      });
      const changed =
        old &&
        (old.tokenHash !== tokenHash ||
          old.userId !== actor.id ||
          old.clientId !== clientId ||
          !old.isActive);
      const data = {
        clientId,
        userId: actor.id,
        sessionId: actor.sessionId!,
        platform: input.platform,
        token: input.token,
        tokenHash,
        isActive: true,
        lastRegisteredAt: new Date(),
        disabledReason: null,
      };
      const row = old
        ? await tx.pushDevice.update({
            where: { id: old.id },
            data: {
              ...data,
              ...(changed ? { version: { increment: 1 } } : {}),
            },
          })
        : await tx.pushDevice.create({
            data: {
              ...data,
              installationId: input.installationId,
              appCode: input.appCode,
            },
          });
      return {
        installationId: row.installationId,
        appCode: row.appCode,
        platform: row.platform,
        registeredAt: row.lastRegisteredAt,
      };
    });
  }
  async unregisterDevice(
    clientId: string,
    actor: AuthUser,
    installationId: string,
  ) {
    await this.db.pushDevice.updateMany({
      where: {
        clientId,
        userId: actor.id,
        sessionId: actor.sessionId,
        installationId,
        isActive: true,
      },
      data: { isActive: false, disabledReason: 'UNREGISTERED' },
    });
    return { unregistered: true };
  }

  private audience(input: Audience) {
    const parsed = parsePhones(input.phoneNumbers);
    if (
      input.audience === 'PHONE_NUMBERS' &&
      !parsed.phones.length &&
      !parsed.invalid.length
    )
      throw new BadRequestException('Enter at least one phone number.');
    if (input.audience !== 'PHONE_NUMBERS' && input.phoneNumbers?.trim())
      throw new BadRequestException(
        'Phone numbers are only valid for the Phone Numbers audience.',
      );
    return {
      ...parsed,
      userIds: input.userIds ? [...new Set(input.userIds)].sort() : undefined,
    };
  }
  private predicate(
    clientId: string,
    input: Audience,
    parsed: ReturnType<NotificationService['audience']>,
  ): Prisma.Sql {
    const base = Prisma.sql`u."clientId" = ${clientId} AND u."isActive" = true AND u."deletedAt" IS NULL AND u.role <> 'SUPER_ADMIN'`;
    if (parsed.userIds)
      return parsed.userIds.length
        ? Prisma.sql`${base} AND u.id IN (${Prisma.join(parsed.userIds)})`
        : Prisma.sql`${base} AND false`;
    if (input.audience === 'ALL_RIDERS')
      return Prisma.sql`${base} AND u.role = 'RIDER'`;
    if (input.audience === 'ALL_FLEET_MANAGERS')
      return Prisma.sql`${base} AND u.role = 'FLEET_MANAGER'`;
    if (input.audience === 'PHONE_NUMBERS') {
      const variants = parsed.phones.flatMap(indianMobileVariants);
      return variants.length
        ? Prisma.sql`${base} AND u.mobile IN (${Prisma.join(variants)})`
        : Prisma.sql`${base} AND false`;
    }
    return base;
  }
  private async audiencePreview(db: Tx, clientId: string, input: Audience) {
    const parsed = this.audience(input);
    const where = this.predicate(clientId, input, parsed);
    const [counts] = await db.$queryRaw<
      Array<{ users: bigint; devices: bigint; pushUsers: bigint }>
    >(Prisma.sql`
      SELECT (SELECT count(*) FROM "User" u WHERE ${where}) AS users,
        count(d.id) AS devices, count(DISTINCT d."userId") AS "pushUsers"
      FROM "PushDevice" d JOIN "User" u ON u.id = d."userId" JOIN "Session" s ON s.id = d."sessionId"
      WHERE ${where} AND d."clientId" = ${clientId} AND d."isActive" AND s."revokedAt" IS NULL AND s."expiresAt" > now()`);
    let unmatched: string[] = [];
    if (input.audience === 'PHONE_NUMBERS' && parsed.phones.length) {
      const matches = await db.$queryRaw<Array<{ mobile: string }>>(
        Prisma.sql`SELECT u.mobile FROM "User" u WHERE ${where}`,
      );
      const matched = new Set(
        matches.map((entry) => normalizeIndianMobile(entry.mobile)),
      );
      unmatched = parsed.phones.filter((phone) => !matched.has(phone));
    }
    return {
      users: Number(counts!.users),
      devices: Number(counts!.devices),
      usersWithoutDevices: Number(counts!.users) - Number(counts!.pushUsers),
      invalidPhoneNumbers: parsed.invalid,
      duplicatePhoneNumbers: parsed.duplicates,
      unmatchedPhoneNumbers: unmatched,
      normalizedPhoneNumbers: parsed.phones,
      pushConfigured: this.provider.configured,
    };
  }
  async preview(
    clientId: string,
    actor: AuthUser,
    input: NotificationAudienceDto,
  ) {
    this.assertStaff(actor);
    return this.audiencePreview(this.db, clientId, input);
  }
  async send(
    clientId: string,
    actor: AuthUser,
    input: SendNotificationDto,
    requestKey: string,
  ) {
    this.assertStaff(actor);
    return this.enqueue(clientId, actor.id, input, requestKey, 'MANUAL');
  }
  /** Use a stable business event key; call inside the business transaction when possible. */
  async enqueueForUsers(
    tx: Tx,
    clientId: string,
    userIds: string[],
    content: { title: string; body: string; data?: Record<string, string> },
    eventKey: string,
    source = 'SYSTEM',
  ) {
    if (!userIds.length || userIds.length > 10000)
      throw new BadRequestException(
        'Select between one and 10,000 users per business event.',
      );
    return this.enqueueInTransaction(
      tx,
      clientId,
      null,
      { ...content, audience: 'ALL_USERS', userIds },
      eventKey,
      source,
    );
  }
  async sendToUsers(
    clientId: string,
    userIds: string[],
    content: { title: string; body: string; data?: Record<string, string> },
    eventKey: string,
    source = 'SYSTEM',
  ) {
    return this.transaction((tx) =>
      this.enqueueForUsers(tx, clientId, userIds, content, eventKey, source),
    );
  }
  private async enqueue(
    clientId: string,
    senderId: string | null,
    input: SendNotificationDto,
    requestKey: string,
    source: string,
  ) {
    return this.transaction((tx) =>
      this.enqueueInTransaction(
        tx,
        clientId,
        senderId,
        input,
        requestKey,
        source,
      ),
    );
  }
  private async enqueueInTransaction(
    tx: Tx,
    clientId: string,
    senderId: string | null,
    input: SendNotificationDto & { userIds?: string[] },
    requestKey: string,
    source: string,
  ) {
    if (!/^[A-Za-z0-9:_.-]{8,150}$/.test(requestKey ?? ''))
      throw new BadRequestException(
        'A stable Idempotency-Key of 8–150 characters is required.',
      );
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(source))
      throw new BadRequestException('Invalid notification source.');
    const content = notificationContent(input.title, input.body, input.data);
    const parsed = this.audience(input);
    if (parsed.invalid.length)
      throw new BadRequestException({
        code: 'INVALID_NOTIFICATION_PHONES',
        message: 'Correct the invalid phone numbers before sending.',
        invalidPhoneNumbers: parsed.invalid,
      });
    const requestDigest = digest({
      ...content,
      audience: parsed.userIds ? 'USER_IDS' : input.audience,
      phones: parsed.phones,
      userIds: parsed.userIds,
      source,
      senderId,
    });
    const old = await tx.notificationMessage.findUnique({
      where: { clientId_requestKey: { clientId, requestKey } },
    });
    if (old) {
      if (old.requestDigest !== requestDigest)
        throw new ConflictException(
          'Idempotency-Key was already used for a different notification.',
        );
      return old;
    }
    const preview = await this.audiencePreview(tx, clientId, input);
    if (preview.unmatchedPhoneNumbers.length)
      throw new BadRequestException(
        'Some phone numbers do not match an active user in this client. Remove or correct them before sending.',
      );
    if (parsed.userIds && preview.users !== parsed.userIds.length)
      throw new BadRequestException(
        'Every recipient must be an active user in this client.',
      );
    if (!preview.users)
      throw new BadRequestException('No active users match this audience.');
    const id = randomUUID();
    const now = new Date();
    const row = await tx.notificationMessage.create({
      data: {
        id,
        clientId,
        senderId,
        ...content,
        audience: parsed.userIds ? 'USER_IDS' : input.audience,
        audiencePhones: parsed.phones,
        requestKey,
        requestDigest,
        source,
        totalUsers: preview.users,
        pushExpiresAt: new Date(
          now.getTime() +
            this.config.getOrThrow<number>('PUSH_TTL_SECONDS') * 1000,
        ),
        createdAt: now,
      },
    });
    // Resolve the audience once at send time; device delivery is processed asynchronously.
    await tx.$executeRaw(Prisma.sql`INSERT INTO "UserNotification" (id, "clientId", "userId", "messageId", "createdAt", "noActiveDevice")
      SELECT gen_random_uuid()::text, ${clientId}, u.id, ${id}, ${now}, false FROM "User" u WHERE ${this.predicate(clientId, input, parsed)}
      ON CONFLICT ("messageId", "userId") DO NOTHING`);
    await tx.auditLog.create({
      data: {
        clientId,
        actorId: senderId,
        action: 'NOTIFICATION_QUEUED',
        entityType: 'NotificationMessage',
        entityId: row.id,
        newData: { audience: row.audience, totalUsers: row.totalUsers, source },
      },
    });
    return row;
  }

  async inbox(clientId: string, userId: string, query: NotificationPageDto) {
    const rows = await this.db.userNotification.findMany({
      where: { clientId, userId, ...afterCursor(decodeCursor(query.cursor)) },
      orderBy,
      take: query.limit + 1,
      include: {
        message: {
          select: { title: true, body: true, data: true, source: true },
        },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ message, ...entry }) => ({
        id: entry.id,
        messageId: entry.messageId,
        ...message,
        createdAt: entry.createdAt,
        readAt: entry.readAt,
      })),
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
  async unread(clientId: string, userId: string) {
    return {
      count: await this.db.userNotification.count({
        where: { clientId, userId, readAt: null },
      }),
    };
  }
  async read(clientId: string, userId: string, id: string) {
    const row = await this.db.userNotification.findFirst({
      where: { clientId, userId, id },
    });
    if (!row) throw new NotFoundException('Notification not found.');
    if (!row.readAt)
      await this.db.userNotification.updateMany({
        where: { clientId, userId, id, readAt: null },
        data: { readAt: new Date() },
      });
    return { read: true };
  }
  async readAll(clientId: string, userId: string, throughId?: string) {
    const now = new Date();
    const anchor = throughId
      ? await this.db.userNotification.findFirst({
          where: { id: throughId, clientId, userId },
        })
      : null;
    if (throughId && !anchor)
      throw new NotFoundException('Notification not found.');
    const bound = anchor
      ? {
          OR: [
            { createdAt: { lt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { lte: anchor.id } },
          ],
        }
      : { createdAt: { lte: now } };
    const result = await this.db.userNotification.updateMany({
      where: { clientId, userId, readAt: null, ...bound },
      data: { readAt: now },
    });
    return { updated: result.count };
  }
  async history(clientId: string, actor: AuthUser, query: NotificationPageDto) {
    this.assertStaff(actor);
    const rows = await this.db.notificationMessage.findMany({
      where: { clientId, ...afterCursor(decodeCursor(query.cursor)) },
      orderBy,
      take: query.limit + 1,
      include: { sender: { select: { name: true, role: true } } },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const items = await Promise.all(
      page.map(async (row) => ({
        ...row,
        ...(await this.stats(row.id)),
        pushConfigured: this.provider.configured,
      })),
    );
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
  async details(clientId: string, actor: AuthUser, id: string) {
    this.assertStaff(actor);
    const message = await this.db.notificationMessage.findFirst({
      where: { clientId, id },
      include: { sender: { select: { name: true, role: true } } },
    });
    if (!message)
      throw new NotFoundException('Notification broadcast not found.');
    const failures = await this.db.pushDelivery.findMany({
      where: { messageId: id, status: { in: ['FAILED', 'RETRY', 'SKIPPED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        attempts: true,
        errorCode: true,
        nextAttemptAt: true,
        userNotification: {
          select: { user: { select: { name: true, mobile: true } } },
        },
      },
    });
    return {
      ...message,
      ...(await this.stats(id)),
      failures,
      pushConfigured: this.provider.configured,
    };
  }
  async stats(messageId: string) {
    const [groups, pendingExpansion, noDevices, readUsers, acceptedUsers] =
      await Promise.all([
        this.db.pushDelivery.groupBy({
          by: ['status'],
          where: { messageId },
          _count: { _all: true },
        }),
        this.db.userNotification.count({
          where: { messageId, expandedAt: null },
        }),
        this.db.userNotification.count({
          where: { messageId, noActiveDevice: true },
        }),
        this.db.userNotification.count({
          where: { messageId, readAt: { not: null } },
        }),
        this.db.userNotification.count({
          where: { messageId, deliveries: { some: { status: 'ACCEPTED' } } },
        }),
      ]);
    return {
      deliveryCounts: Object.fromEntries(
        groups.map((group) => [group.status, group._count._all]),
      ),
      pendingExpansion,
      usersWithoutDevices: noDevices,
      readUsers,
      usersAcceptedByFirebase: acceptedUsers,
    };
  }
}
