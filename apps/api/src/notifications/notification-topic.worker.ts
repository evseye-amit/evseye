import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationTopicService } from './notification-topic.service.js';
import {
  PUSH_PROVIDER,
  classifyPushError,
  type PushProvider,
  type PushResult,
} from './firebase-push.provider.js';

@Injectable()
export class NotificationTopicWorker {
  private running = false;
  private readonly logger = new Logger(NotificationTopicWorker.name);
  constructor(
    private readonly db: PrismaService,
    private readonly topics: NotificationTopicService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}
  @Interval(10000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const stage of ['reconcile', 'dispatch'] as const) {
        try {
          await this[stage]();
        } catch (cause) {
          this.logger.error({
            event: 'notification_topic_worker_failed',
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
  async reconcile() {
    await this.db.notificationTopicSubscription.updateMany({
      where: {
        deviceId: null,
        desired: true,
        binding: { environment: this.topics.environment },
      },
      data: { desired: false, nextAttemptAt: new Date() },
    });
    const devices = await this.db.pushDevice.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                notificationAppBinding: {
                  environment: this.topics.environment,
                },
              },
              {
                notificationAppBindingId: null,
                topicSubscriptions: {
                  some: { binding: { environment: this.topics.environment } },
                },
              },
            ],
          },
          {
            OR: [
              { topicReconciledAt: null },
              { topicReconciledAt: { lt: new Date(Date.now() - 60000) } },
            ],
          },
        ],
      },
      select: { id: true },
      orderBy: [
        { topicReconciledAt: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
      take: 50,
    });
    for (const d of devices) {
      try {
        await this.topics.plan(d.id);
      } catch {
        await this.deferPlanning(d.id);
        this.logger.warn({
          event: 'notification_topic_plan_failed',
          deviceId: d.id,
        });
      }
    }
  }
  private async deferPlanning(deviceId: string) {
    const now = new Date();
    // Move faulty records out of the oldest-first window so other devices can progress.
    await this.db.pushDevice.updateMany({
      where: { id: deviceId },
      data: { topicReconciledAt: now },
    });
    await this.db.notificationTopicSubscription.updateMany({
      where: {
        deviceId,
        binding: { environment: this.topics.environment },
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        nextAttemptAt: new Date(now.getTime() + 60000),
        lastError: 'TOPIC_PLANNING_FAILED',
      },
    });
  }
  async dispatch() {
    if (!this.provider.manageTopic) return;
    const candidates = await this.db.notificationTopicSubscription.findMany({
      where: {
        nextAttemptAt: { lte: new Date() },
        binding: { environment: this.topics.environment },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      select: { id: true, deviceId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const planned = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.deviceId && !planned.has(candidate.deviceId)) {
        try {
          await this.topics.plan(candidate.deviceId);
        } catch {
          await this.deferPlanning(candidate.deviceId);
          this.logger.warn({
            event: 'notification_topic_plan_failed',
            deviceId: candidate.deviceId,
          });
          continue;
        }
        planned.add(candidate.deviceId);
      }
      const claimId = randomUUID();
      // Persist the uncertain state BEFORE the SDK call. A crash can only cause an idempotent replay.
      const rows = await this.db.$queryRaw<
        Array<{ id: string; desired: boolean; attempts: number }>
      >(Prisma.sql`
        UPDATE "NotificationTopicSubscription" SET "claimId"=${claimId}, "leaseUntil"=now()+interval '2 minutes', applied=NULL
        WHERE id=${candidate.id} AND "nextAttemptAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now())
        RETURNING id,desired,attempts`);
      if (!rows.length) continue;
      const row = await this.db.notificationTopicSubscription.findUniqueOrThrow(
        { where: { id: candidate.id }, include: { topic: true } },
      );
      const attempted = rows[0]!.desired;
      let result: PushResult;
      try {
        result = await this.provider.manageTopic({
          bindingId: row.bindingId,
          clientId: row.clientId,
          token: row.token,
          logicalKey: row.topic.logicalKey,
          name: row.topic.name,
          subscribe: attempted,
        });
      } catch (cause) {
        result = classifyPushError(cause);
      }
      if (result.accepted) {
        // A concurrent preference/ownership change remains pending, never overwritten by a stale success.
        await this.db
          .$executeRaw(Prisma.sql`UPDATE "NotificationTopicSubscription" SET applied=${attempted}, "lastAppliedAt"=now(), "lastError"=NULL, attempts=0, "claimId"=NULL, "leaseUntil"=NULL,
          "nextAttemptAt"=CASE WHEN desired=${attempted} THEN now()+interval '15 minutes' ELSE now() END WHERE id=${row.id} AND "claimId"=${claimId}`);
      } else if (result.invalidToken) {
        await this.db.$transaction(async (tx) => {
          await tx.pushDevice.updateMany({
            where: {
              notificationAppBindingId: row.bindingId,
              tokenHash: row.tokenHash,
            },
            data: {
              isActive: false,
              disabledReason: 'INVALID_TOPIC_TOKEN',
              topicReconciledAt: null,
              version: { increment: 1 },
            },
          });
          await tx.notificationTopicSubscription.updateMany({
            where: { id: row.id, claimId },
            data: {
              desired: false,
              applied: false,
              nextAttemptAt: null,
              claimId: null,
              leaseUntil: null,
              lastError: result.code ?? 'INVALID_TOKEN',
            },
          });
        });
      } else {
        const seconds = Math.max(
          result.retryAfterSeconds ?? 0,
          result.deferred
            ? 60
            : Math.min(3600, 30 * 2 ** Math.min(rows[0]!.attempts, 7)),
        );
        await this.db.notificationTopicSubscription.updateMany({
          where: { id: row.id, claimId },
          data: {
            lastError: (result.code ?? 'TOPIC_PROVIDER_ERROR').slice(0, 150),
            claimId: null,
            leaseUntil: null,
            nextAttemptAt: new Date(Date.now() + seconds * 1000),
            ...(!result.deferred ? { attempts: { increment: 1 } } : {}),
          },
        });
      }
    }
  }
}
