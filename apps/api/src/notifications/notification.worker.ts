import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PUSH_PROVIDER,
  type PushProvider,
  type PushResult,
  type PushTarget,
} from './firebase-push.provider.js';
import { NotificationService } from './notification.service.js';

const LEASE_MS = 120000;
const activeStatuses = ['PENDING', 'PROCESSING', 'RETRY'];
@Injectable()
export class NotificationWorker {
  private running = false;
  private readonly logger = new Logger(NotificationWorker.name);
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly service: NotificationService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  @Interval(1000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.expandRecipients();
      await this.dispatch();
      await this.finishMessages();
    } catch (cause) {
      this.logger.error({
        event: 'notification_worker_failed',
        code:
          cause instanceof Prisma.PrismaClientKnownRequestError
            ? cause.code
            : 'WORKER_ERROR',
      });
    } finally {
      this.running = false;
    }
  }
  async expandRecipients() {
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            clientId: string;
            userId: string;
            messageId: string;
          }>
        >(Prisma.sql`
        SELECT n.id, n."clientId", n."userId", n."messageId" FROM "UserNotification" n
        WHERE n."expandedAt" IS NULL ORDER BY n."createdAt", n.id FOR UPDATE SKIP LOCKED LIMIT 200`);
        for (const row of rows) {
          const devices = await tx.pushDevice.findMany({
            where: {
              clientId: row.clientId,
              userId: row.userId,
              isActive: true,
              session: {
                userId: row.userId,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
              user: {
                isActive: true,
                deletedAt: null,
                clientId: row.clientId,
                client: {
                  isActive: true,
                  status: { notIn: ['DRAFT', 'SUSPENDED'] },
                },
              },
            },
            select: { id: true, version: true },
          });
          if (devices.length)
            await tx.pushDelivery.createMany({
              data: devices.map((device) => ({
                messageId: row.messageId,
                userNotificationId: row.id,
                deviceId: device.id,
                deviceVersion: device.version,
              })),
              skipDuplicates: true,
            });
          await tx.userNotification.update({
            where: { id: row.id },
            data: { expandedAt: new Date(), noActiveDevice: !devices.length },
          });
        }
        return rows.length;
      },
      { timeout: 30000 },
    );
  }
  private async claim() {
    const maxAttempts = this.config.getOrThrow<number>('PUSH_MAX_ATTEMPTS');
    const limit = this.config.getOrThrow<number>('PUSH_BATCH_SIZE');
    const rate = this.config.getOrThrow<number>('PUSH_TOKENS_PER_SECOND');
    const now = new Date();
    const claimId = randomUUID();
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "PushDispatchState" (id, "nextAllowedAt") VALUES ('firebase', now()) ON CONFLICT DO NOTHING`,
        );
        const [gate] = await tx.$queryRaw<
          Array<{ nextAllowedAt: Date; leaseUntil: Date | null }>
        >(
          Prisma.sql`SELECT "nextAllowedAt", "leaseUntil" FROM "PushDispatchState" WHERE id = 'firebase' FOR UPDATE`,
        );
        if (
          gate!.nextAllowedAt > now ||
          (gate!.leaseUntil && gate!.leaseUntil > now)
        )
          return null;
        await tx.pushDelivery.updateMany({
          where: {
            status: { in: activeStatuses },
            message: { pushExpiresAt: { lte: now } },
          },
          data: {
            status: 'SKIPPED',
            errorCode: 'PUSH_EXPIRED',
            leaseUntil: null,
            claimId: null,
          },
        });
        await tx.pushDelivery.updateMany({
          where: {
            status: 'PROCESSING',
            leaseUntil: { lte: now },
            attempts: { gte: maxAttempts },
          },
          data: {
            status: 'FAILED',
            errorCode: 'WORKER_RETRY_LIMIT',
            leaseUntil: null,
            claimId: null,
          },
        });
        await tx.pushDelivery.updateMany({
          where: {
            firstAttemptAt: { lt: new Date(now.getTime() - 3600000) },
            OR: [
              { status: { in: ['PENDING', 'RETRY'] } },
              { status: 'PROCESSING', leaseUntil: { lte: now } },
            ],
          },
          data: {
            status: 'FAILED',
            errorCode: 'PUSH_RETRY_TIME_LIMIT',
            leaseUntil: null,
            claimId: null,
          },
        });
        const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT d.id FROM "PushDelivery" d WHERE
          ((d.status IN ('PENDING','RETRY') AND d."nextAttemptAt" <= ${now}) OR (d.status = 'PROCESSING' AND d."leaseUntil" <= ${now}))
          AND d.attempts < ${maxAttempts}
        ORDER BY d."nextAttemptAt", d.id FOR UPDATE SKIP LOCKED LIMIT ${limit}`);
        if (!ids.length) return null;
        const leaseUntil = new Date(now.getTime() + LEASE_MS);
        await tx.pushDelivery.updateMany({
          where: { id: { in: ids.map((entry) => entry.id) } },
          data: {
            status: 'PROCESSING',
            claimId,
            leaseUntil,
            attempts: { increment: 1 },
          },
        });
        await tx.$executeRaw(
          Prisma.sql`UPDATE "PushDelivery" SET "firstAttemptAt" = COALESCE("firstAttemptAt", ${now}) WHERE "claimId" = ${claimId}`,
        );
        await tx.pushDispatchState.update({
          where: { id: 'firebase' },
          data: {
            claimId,
            leaseUntil,
            nextAllowedAt: new Date(
              now.getTime() + Math.ceil((ids.length / rate) * 1000),
            ),
          },
        });
        return claimId;
      },
      { timeout: 20000 },
    );
  }
  async dispatch() {
    // Expanding the inbox remains useful while Firebase credentials are configured later.
    if (!this.provider.configured) return;
    const claimId = await this.claim();
    if (!claimId) return;
    let globalBackoff = 0;
    try {
      const deliveries = await this.db.pushDelivery.findMany({
        where: { claimId, status: 'PROCESSING' },
        include: {
          device: {
            include: { session: true, user: { include: { client: true } } },
          },
          userNotification: true,
          message: true,
        },
        orderBy: { id: 'asc' },
      });
      const sendable: typeof deliveries = [];
      const now = new Date();
      for (const delivery of deliveries) {
        const { device, message, userNotification } = delivery;
        if (
          !device.isActive ||
          device.version !== delivery.deviceVersion ||
          device.userId !== userNotification.userId ||
          device.clientId !== userNotification.clientId ||
          !device.user.isActive ||
          device.user.deletedAt ||
          !device.user.client?.isActive ||
          ['DRAFT', 'SUSPENDED'].includes(device.user.client.status) ||
          device.session.revokedAt ||
          device.session.expiresAt <= now ||
          device.session.userId !== device.userId ||
          message.pushExpiresAt <= now
        ) {
          await this.db.pushDelivery.updateMany({
            where: { id: delivery.id, claimId, status: 'PROCESSING' },
            data: {
              status: 'SKIPPED',
              errorCode:
                message.pushExpiresAt <= now
                  ? 'PUSH_EXPIRED'
                  : 'DEVICE_OR_ACCOUNT_UNAVAILABLE',
              claimId: null,
              leaseUntil: null,
            },
          });
        } else sendable.push(delivery);
      }
      if (!sendable.length) return;
      const targets: PushTarget[] = sendable.map((row) => ({
        token: row.device.token,
        notificationId: row.userNotificationId,
        messageId: row.messageId,
        userId: row.userNotification.userId,
        clientId: row.userNotification.clientId,
        title: row.message.title,
        body: row.message.body,
        data: row.message.data as Record<string, string>,
        expiresAt: row.message.pushExpiresAt,
      }));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let results: PushResult[];
      try {
        results = await Promise.race([
          this.provider.send(targets),
          new Promise<PushResult[]>((resolve) => {
            timeout = setTimeout(
              () =>
                resolve(
                  targets.map(() => ({
                    accepted: false,
                    code: 'PUSH_SEND_TIMEOUT',
                    retryable: true,
                  })),
                ),
              45000,
            );
          }),
        ]);
      } catch {
        results = targets.map(() => ({
          accepted: false,
          code: 'PUSH_PROVIDER_ERROR',
          retryable: true,
        }));
      } finally {
        clearTimeout(timeout);
      }
      for (let index = 0; index < sendable.length; index++) {
        const row = sendable[index]!;
        const result = results[index] ?? {
          accepted: false,
          code: 'PUSH_RESPONSE_MISSING',
          retryable: true,
        };
        globalBackoff = Math.max(globalBackoff, result.retryAfterSeconds ?? 0);
        const canRetry =
          result.retryable &&
          row.attempts < this.config.getOrThrow<number>('PUSH_MAX_ATTEMPTS') &&
          (!row.firstAttemptAt ||
            Date.now() - row.firstAttemptAt.getTime() < 3600000);
        const delay =
          Math.max(
            result.retryAfterSeconds ?? 0,
            Math.min(1800, 30 * 2 ** (row.attempts - 1)),
          ) *
            1000 +
          Math.floor(Math.random() * 3000);
        await this.db.$transaction(async (tx) => {
          const changed = await tx.pushDelivery.updateMany({
            where: { id: row.id, claimId, status: 'PROCESSING' },
            data: {
              status: result.accepted
                ? 'ACCEPTED'
                : canRetry
                  ? 'RETRY'
                  : 'FAILED',
              claimId: null,
              leaseUntil: null,
              acceptedAt: result.accepted ? new Date() : null,
              firebaseMessageId: result.messageId,
              errorCode: result.accepted
                ? null
                : (result.code ?? 'PUSH_FAILED').slice(0, 150),
              nextAttemptAt: new Date(Date.now() + delay),
            },
          });
          // A failed old token must never disable a replacement token registered during the send.
          if (changed.count && result.invalidToken)
            await tx.pushDevice.updateMany({
              where: {
                id: row.deviceId,
                version: row.deviceVersion,
                tokenHash: row.device.tokenHash,
              },
              data: {
                isActive: false,
                disabledReason: 'TOKEN_UNREGISTERED_BY_FIREBASE',
              },
            });
        });
      }
    } finally {
      await this.db.pushDispatchState.updateMany({
        where: { id: 'firebase', claimId },
        data: {
          leaseUntil: null,
          claimId: null,
          ...(globalBackoff > 0
            ? { nextAllowedAt: new Date(Date.now() + globalBackoff * 1000) }
            : {}),
        },
      });
    }
  }
  async finishMessages() {
    // One SQL snapshot prevents a broadcast appearing complete while another worker expands its recipients.
    await this.db.pushDelivery.updateMany({
      where: {
        status: { in: activeStatuses },
        message: { pushExpiresAt: { lte: new Date() } },
      },
      data: {
        status: 'SKIPPED',
        errorCode: 'PUSH_EXPIRED',
        leaseUntil: null,
        claimId: null,
      },
    });
    const waiting = this.provider.configured
      ? 'PROCESSING'
      : 'WAITING_FOR_CONFIGURATION';
    await this.db.$executeRaw(Prisma.sql`
      WITH progress AS (
        SELECT m.id,
          CASE WHEN EXISTS (SELECT 1 FROM "UserNotification" n WHERE n."messageId" = m.id AND n."expandedAt" IS NULL) THEN 'PROCESSING'
          WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status IN ('PENDING','PROCESSING','RETRY')) THEN ${waiting}
          WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status IN ('FAILED','SKIPPED')) THEN
            CASE WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status = 'ACCEPTED') THEN 'PARTIAL' ELSE 'FAILED' END
          ELSE 'COMPLETED' END AS status
        FROM "NotificationMessage" m WHERE (m.status IN ('QUEUED','PROCESSING') OR (m.status = 'WAITING_FOR_CONFIGURATION' AND (${this.provider.configured} OR m."pushExpiresAt" <= now()))) ORDER BY m."createdAt" LIMIT 100
      )
      UPDATE "NotificationMessage" m SET status = p.status, "completedAt" = CASE WHEN p.status IN ('COMPLETED','PARTIAL','FAILED') THEN now() ELSE NULL END
      FROM progress p WHERE m.id = p.id`);
  }
}
