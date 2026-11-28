import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationService } from './notification.service.js';
import { applicationRoles } from './notification-targeting.js';
import {
  topicName,
  topicApplication,
  audienceTopicKeys,
} from './notification-topic.helpers.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

type Dimension = {
  hubId: string | null;
  city: string | null;
  vehicleTypeId: string | null;
  oemId: string | null;
};
@Injectable()
export class NotificationTopicService {
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}
  get environment() {
    return this.config.get<string>('PUSH_ENVIRONMENT') ?? 'development';
  }
  async plan(deviceId: string) {
    return this.notifications.transaction(async (tx) => {
      // Serializes planners across replicas, including token ownership transfers.
      const locks = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(8951, 6) AS locked`;
      if (!locks[0]?.locked) return;
      const d = await tx.pushDevice.findUnique({
        where: { id: deviceId },
        include: {
          user: { include: { client: true } },
          session: true,
          notificationAppBinding: { include: { firebaseConfiguration: true } },
        },
      });
      if (!d) return;
      const b = d.notificationAppBinding;
      // Never reconcile another deployment's bindings.
      if (b && b.environment !== this.environment) return;
      const app = topicApplication[d.appCode];
      const active =
        d.isActive &&
        d.user.isActive &&
        !d.user.deletedAt &&
        d.user.client?.isActive &&
        !['DRAFT', 'SUSPENDED'].includes(d.user.client.status) &&
        !d.session.revokedAt &&
        d.session.expiresAt > new Date() &&
        d.session.userId === d.userId &&
        b?.isActive &&
        b.firebaseConfiguration.isActive &&
        b.clientId === d.clientId &&
        b.appCode === d.appCode &&
        b.platform === d.platform &&
        app &&
        applicationRoles[app]?.includes(d.user.role);
      const desiredIds: string[] = [];
      if (active && b) {
        const dimensions =
          d.user.role === 'RIDER'
            ? await this.dimensions(tx, d.clientId, d.userId)
            : [];
        const keys = audienceTopicKeys(d.user.role, dimensions);
        const [mappings, preferences, consent] = await Promise.all([
          tx.notificationApplicationCategory.findMany({
            where: {
              application: app,
              allowed: true,
              category: {
                isActive: true,
                parent: { isActive: true },
                OR: [{ parentCode: 'PG01' }, { parentCode: 'PG11' }],
              },
            },
            select: { categoryCode: true },
          }),
          tx.notificationPreference.findMany({
            where: {
              clientId: d.clientId,
              userId: d.userId,
              application: app,
              pushEnabled: false,
            },
          }),
          tx.notificationConsent.findUnique({
            where: {
              clientId_userId_application: {
                clientId: d.clientId,
                userId: d.userId,
                application: app,
              },
            },
          }),
        ]);
        for (const { categoryCode } of mappings)
          if (
            !preferences.some((p) => p.categoryCode === categoryCode) &&
            (!categoryCode.startsWith('PG11_') || consent?.marketingEnabled)
          )
            keys.push(`category_${categoryCode}`);
        // Bound per-device topic fanout below FCM's 2000-topic limit. No arbitrary client topics.
        if (keys.length > 500) throw new Error('TOPIC_MEMBERSHIP_LIMIT');
        for (const logicalKey of keys) {
          const topic = await tx.notificationTopic.upsert({
            where: { bindingId_logicalKey: { bindingId: b.id, logicalKey } },
            create: {
              clientId: d.clientId,
              bindingId: b.id,
              logicalKey,
              name: topicName(
                this.environment,
                d.clientId,
                b.id,
                d.appCode,
                logicalKey,
              ),
            },
            update: {},
          });
          if (!topic.isActive) continue;
          const unique = {
            bindingId: b.id,
            tokenHash: d.tokenHash,
            topicId: topic.id,
          };
          const old = await tx.notificationTopicSubscription.findUnique({
            where: { bindingId_tokenHash_topicId: unique },
          });
          const row = await tx.notificationTopicSubscription.upsert({
            where: { bindingId_tokenHash_topicId: unique },
            create: {
              ...unique,
              clientId: d.clientId,
              deviceVersion: d.version,
              deviceId: d.id,
              token: d.token,
              desired: true,
            },
            update: {
              deviceVersion: d.version,
              deviceId: d.id,
              desired: true,
              ...(!old?.desired
                ? { nextAttemptAt: new Date(), attempts: 0 }
                : {}),
            },
          });
          desiredIds.push(row.id);
        }
      }
      await tx.notificationTopicSubscription.updateMany({
        where: { deviceId: d.id, desired: true, id: { notIn: desiredIds } },
        data: { desired: false, nextAttemptAt: new Date(), attempts: 0 },
      });
      await tx.pushDevice.update({
        where: { id: d.id },
        data: { topicReconciledAt: new Date() },
      });
    });
  }
  private async dimensions(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId: string,
  ) {
    const rows = await tx.$queryRaw<Dimension[]>(Prisma.sql`
      SELECT h.id AS "hubId", h.city, f."vehicleTypeId", f."oemId"
      FROM "Rider" r JOIN "Allocation" a ON a."riderId"=r.id AND a."clientId"=r."clientId"
      JOIN "Fleet" f ON f.id=a."fleetId" AND f."clientId"=r."clientId" AND f."deletedAt" IS NULL
      LEFT JOIN "Hub" h ON h.id=COALESCE(f."currentHubId",f."homeHubId") AND h."clientId"=r."clientId" AND h."deletedAt" IS NULL
      WHERE r."clientId"=${clientId} AND r."userId"=${userId} AND r."deletedAt" IS NULL AND a.status IN ('ACTIVE','DEALLOCATION_INITIATED')`);
    if (rows.length) return rows;
    // Same no-allocation fallback as recipient targeting; don't expose stale UserHub for allocated riders.
    return tx.$queryRaw<
      Dimension[]
    >(Prisma.sql`SELECT h.id AS "hubId",h.city,NULL::text AS "vehicleTypeId",NULL::text AS "oemId" FROM "UserHub" uh JOIN "Hub" h ON h.id=uh."hubId" AND h."clientId"=uh."clientId" AND h."deletedAt" IS NULL
      WHERE uh."clientId"=${clientId} AND uh."userId"=${userId} AND NOT EXISTS (SELECT 1 FROM "Rider" r JOIN "Allocation" a ON a."riderId"=r.id AND a."clientId"=r."clientId" WHERE r."clientId"=${clientId} AND r."userId"=${userId} AND r."deletedAt" IS NULL AND a.status IN ('ACTIVE','DEALLOCATION_INITIATED'))`);
  }
  async status(
    clientId: string,
    actor: AuthUser,
    installationId: string,
    appCode: string,
    sync = false,
  ) {
    if (actor.clientId !== clientId || !actor.sessionId)
      throw new ForbiddenException('Client mismatch.');
    const d = await this.db.pushDevice.findFirst({
      where: {
        clientId,
        userId: actor.id,
        installationId,
        appCode,
        sessionId: actor.sessionId,
      },
    });
    if (!d) throw new NotFoundException('Device registration not found.');
    if (sync) await this.plan(d.id);
    const rows = await this.db.notificationTopicSubscription.findMany({
      where: {
        deviceId: d.id,
        deviceVersion: d.version,
        binding: { environment: this.environment },
        bindingId: d.notificationAppBindingId ?? '',
        tokenHash: d.tokenHash,
        desired: true,
      },
      include: { topic: true },
      orderBy: { topic: { logicalKey: 'asc' } },
    });
    return {
      installationId,
      appCode,
      subscriptions: rows.map((r) => ({
        logicalKey: r.topic.logicalKey,
        state:
          r.applied === true && !r.lastError
            ? 'SYNCED'
            : r.lastError
              ? 'RETRYING'
              : 'PENDING',
        lastError: r.lastError,
        lastAppliedAt: r.lastAppliedAt,
      })),
      synchronization: 'EVENTUAL',
    };
  }
  async setActive(
    clientId: string,
    actor: AuthUser,
    id: string,
    isActive: boolean,
  ) {
    if (actor.clientId !== clientId || !actor.roles.includes('CLIENT_ADMIN'))
      throw new ForbiddenException();
    return this.notifications.transaction(async (tx) => {
      const topic = await tx.notificationTopic.findFirst({
        where: { id, clientId, binding: { environment: this.environment } },
      });
      if (!topic) throw new NotFoundException('Topic not found.');
      await tx.notificationTopic.update({ where: { id }, data: { isActive } });
      if (!isActive)
        await tx.notificationTopicSubscription.updateMany({
          where: { topicId: id, desired: true },
          data: { desired: false, nextAttemptAt: new Date(), attempts: 0 },
        });
      await tx.pushDevice.updateMany({
        where: { notificationAppBindingId: topic.bindingId },
        data: { topicReconciledAt: null },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: actor.id,
          action: 'NOTIFICATION_TOPIC_UPDATED',
          entityType: 'NotificationTopic',
          entityId: id,
          metadata: { isActive },
        },
      });
      return { id, logicalKey: topic.logicalKey, isActive };
    });
  }
  async list(clientId: string, after?: string) {
    const rows = await this.db.notificationTopic.findMany({
      where: {
        clientId,
        binding: { environment: this.environment },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: {
        id: true,
        bindingId: true,
        logicalKey: true,
        isActive: true,
        binding: {
          select: { appCode: true, platform: true, applicationId: true },
        },
      },
      orderBy: { id: 'asc' },
      take: 101,
    });
    const items = rows.slice(0, 100);
    return { items, nextCursor: rows.length > 100 ? items[99]!.id : null };
  }
}
