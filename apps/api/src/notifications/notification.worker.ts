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
  type PushScope,
} from './firebase-push.provider.js';
import { applicationDeviceCodes } from './notification-targeting.js';
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
      for (const stage of [
        'expandRecipients',
        'dispatch',
        'finishMessages',
      ] as const) {
        try {
          await this[stage]();
        } catch (cause) {
          this.logger.error({
            event: 'notification_worker_failed',
            stage,
            code:
              cause instanceof Prisma.PrismaClientKnownRequestError
                ? cause.code
                : 'WORKER_ERROR',
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
  async expandRecipients() {
    return this.db.$transaction(
      async (tx) => {
        // Finalize expired/withdrawn inbox-only work in bounded batches without creating deliveries.
        await tx.$executeRaw(Prisma.sql`
          WITH expired AS (
            SELECT n.id FROM "UserNotification" n JOIN "NotificationMessage" m
              ON m.id=n."messageId" AND m."clientId"=n."clientId"
            WHERE n."expandedAt" IS NULL AND (m."withdrawnAt" IS NOT NULL OR m."pushExpiresAt"<=now())
            ORDER BY n."createdAt",n.id FOR UPDATE OF n SKIP LOCKED LIMIT 200
          )
          UPDATE "UserNotification" n SET "expandedAt"=now()
          FROM expired e WHERE n.id=e.id
        `);
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            clientId: string;
            userId: string;
            messageId: string;
          }>
        >(Prisma.sql`
        SELECT n.id, n."clientId", n."userId", n."messageId" FROM "UserNotification" n JOIN "NotificationMessage" m ON m.id=n."messageId" AND m."clientId"=n."clientId"
        WHERE n."expandedAt" IS NULL AND m."withdrawnAt" IS NULL AND m."pushExpiresAt">now() AND (m."scheduledFor" IS NULL OR m."scheduledFor"<=now())
        ORDER BY n."createdAt", n.id FOR UPDATE OF n SKIP LOCKED LIMIT 200`);
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
  private async claim(scope: PushScope) {
    const maxAttempts = this.config.getOrThrow<number>('PUSH_MAX_ATTEMPTS');
    const limit = this.config.getOrThrow<number>('PUSH_BATCH_SIZE');
    const rate = this.config.getOrThrow<number>('PUSH_TOKENS_PER_SECOND');
    const now = new Date();
    const claimId = randomUUID();
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "PushDispatchState" (id, "nextAllowedAt") VALUES (${scope.id}, ${now}) ON CONFLICT DO NOTHING`,
        );
        const [gate] = await tx.$queryRaw<
          Array<{ nextAllowedAt: Date; leaseUntil: Date | null }>
        >(
          Prisma.sql`SELECT "nextAllowedAt", "leaseUntil" FROM "PushDispatchState" WHERE id = ${scope.id} FOR UPDATE`,
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
          ${
            scope.configurationId
              ? Prisma.sql`EXISTS (
            SELECT 1 FROM "PushDevice" pd JOIN "NotificationAppBinding" b ON b.id = pd."notificationAppBindingId"
            WHERE pd.id = d."deviceId" AND b."clientId" = pd."clientId" AND b."firebaseConfigurationId" = ${scope.configurationId}
          )`
              : Prisma.sql`true`
          } AND
          ((d.status IN ('PENDING','RETRY') AND d."nextAttemptAt" <= ${now}) OR (d.status = 'PROCESSING' AND d."leaseUntil" <= ${now}))
          AND EXISTS (SELECT 1 FROM "NotificationMessage" m WHERE m.id=d."messageId" AND m."withdrawnAt" IS NULL AND (m."scheduledFor" IS NULL OR m."scheduledFor"<=${now}))
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
          where: { id: scope.id },
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
    const scopes = this.provider.scopes
      ? await this.provider.scopes()
      : [{ id: 'firebase' }];
    // Independent leases/backoff; one project's outage must not stall the others.
    for (let index = 0; index < scopes.length; index += 4) {
      const results = await Promise.allSettled(
        scopes
          .slice(index, index + 4)
          .map((scope) => this.dispatchScope(scope)),
      );
      for (const result of results) {
        if (result.status === 'rejected')
          this.logger.error({
            event: 'notification_project_dispatch_failed',
            code: 'DISPATCH_ERROR',
          });
      }
    }
  }
  private async dispatchScope(scope: PushScope) {
    const claimId = await this.claim(scope);
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
      const clients = [
        ...new Set(deliveries.map((d) => d.userNotification.clientId)),
      ];
      const eligibility = new Map(
        await Promise.all(
          clients.map(
            async (clientId) =>
              [
                clientId,
                await this.service.eligibleForDeliveries(
                  clientId,
                  deliveries
                    .filter((d) => d.userNotification.clientId === clientId)
                    .map((d) => d.userNotificationId),
                ),
              ] as const,
          ),
        ),
      );
      const sendable: typeof deliveries = [];
      const now = new Date();
      for (const delivery of deliveries) {
        const { device, message, userNotification } = delivery;
        if (
          !eligibility
            .get(userNotification.clientId)
            ?.has(delivery.userNotificationId) ||
          (message.application != null &&
            applicationDeviceCodes[message.application] !== device.appCode) ||
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
        bindingId: row.device.notificationAppBindingId,
        appCode: row.device.appCode,
        platform: row.device.platform,
        token: row.device.token,
        notificationId: row.userNotificationId,
        messageId: row.messageId,
        userId: row.userNotification.userId,
        clientId: row.userNotification.clientId,
        title: row.message.title,
        body: row.message.body,
        data: {
          ...(row.message.data as Record<string, string>),
          ...(row.message.categoryCode
            ? { categoryCode: row.message.categoryCode }
            : {}),
          ...(row.message.application
            ? { application: row.message.application }
            : {}),
        },
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
        if (result.deferred) {
          await this.db.pushDelivery.updateMany({
            where: { id: row.id, claimId, status: 'PROCESSING' },
            data: {
              status: 'RETRY',
              errorCode: 'PUSH_CONFIGURATION_UNAVAILABLE',
              claimId: null,
              leaseUntil: null,
              attempts: { decrement: 1 },
              firstAttemptAt: row.attempts === 1 ? null : row.firstAttemptAt,
              nextAttemptAt: new Date(Date.now() + 60000),
            },
          });
          continue;
        }
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
        where: { id: scope.id, claimId },
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
        message: { withdrawnAt: { not: null } },
      },
      data: {
        status: 'SKIPPED',
        errorCode: 'NOTIFICATION_WITHDRAWN',
        leaseUntil: null,
        claimId: null,
      },
    });
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
          CASE WHEN m."withdrawnAt" IS NOT NULL THEN 'CANCELLED'
          WHEN m."scheduledFor">now() THEN 'SCHEDULED'
          WHEN m."pushExpiresAt"<=now() AND NOT EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId"=m.id AND d.status='ACCEPTED') THEN 'EXPIRED'
          WHEN EXISTS (SELECT 1 FROM "UserNotification" n WHERE n."messageId" = m.id AND n."expandedAt" IS NULL) THEN 'PROCESSING'
          WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status IN ('PENDING','PROCESSING','RETRY')) THEN
            CASE WHEN ${Boolean(this.provider.scopes)} AND NOT EXISTS (
              SELECT 1 FROM "PushDelivery" d JOIN "PushDevice" pd ON pd.id = d."deviceId"
              JOIN "NotificationAppBinding" b ON b.id = pd."notificationAppBindingId" AND b."clientId" = pd."clientId"
              JOIN "FirebaseProjectConfiguration" c ON c.id = b."firebaseConfigurationId"
              WHERE d."messageId" = m.id AND d.status IN ('PENDING','PROCESSING','RETRY')
                AND b."isActive" AND c."isActive" AND b.environment = ${this.config.get?.('PUSH_ENVIRONMENT') ?? 'development'}
                AND (d."errorCode" IS NULL OR d."errorCode" <> 'PUSH_CONFIGURATION_UNAVAILABLE')
            ) THEN 'WAITING_FOR_CONFIGURATION' ELSE ${waiting} END
          WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status IN ('FAILED','SKIPPED')) THEN
            CASE WHEN EXISTS (SELECT 1 FROM "PushDelivery" d WHERE d."messageId" = m.id AND d.status = 'ACCEPTED') THEN 'PARTIAL' ELSE 'FAILED' END
          ELSE 'COMPLETED' END AS status
        FROM "NotificationMessage" m WHERE (m.status IN ('SCHEDULED','QUEUED','PROCESSING') OR (m.status = 'WAITING_FOR_CONFIGURATION' AND (m."withdrawnAt" IS NOT NULL OR ${this.provider.configured} OR m."pushExpiresAt" <= now())))
      )
      UPDATE "NotificationMessage" m SET status = p.status, "completedAt" = CASE WHEN p.status IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','EXPIRED') THEN now() ELSE NULL END
      FROM progress p WHERE m.id = p.id AND m.status IS DISTINCT FROM p.status`);
  }
}
