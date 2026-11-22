import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingEngineService } from './rider-billing-engine.service.js';
import {
  billingRetryDelay,
  recoveryRequired,
  rentalBillingEnabled,
  rentalClientEnabled,
  rentalPeriod,
} from './rental-billing-policy.js';

@Injectable()
export class RentalBillingRunner {
  private readonly logger = new Logger(RentalBillingRunner.name);
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly engine: RiderBillingEngineService,
  ) {}
  private async withRetry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  async run(limit = 200, budgetMs = 45000) {
    if (this.running || !rentalBillingEnabled()) return;
    this.running = true;
    const started = Date.now(),
      seen: string[] = [];
    let processed = 0,
      failed = 0,
      deferred = 0;
    let runId: string | undefined;
    try {
      runId = (
        await this.db.rentalBillingWorkerRun.create({
          data: { status: 'RUNNING' },
        })
      ).id;
      while (seen.length < limit && Date.now() - started < budgetMs) {
        const token = randomUUID();
        const excluded = seen.length
          ? Prisma.sql`AND id NOT IN (${Prisma.join(seen)})`
          : Prisma.empty;
        const claimed = await this.db.$queryRaw<
          { id: string; clientId: string }[]
        >(Prisma.sql`
          UPDATE "RiderBillingSchedule" SET "leaseToken"=${token}, "leaseUntil"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+INTERVAL '2 minutes', "lastAttemptAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE id=(SELECT id FROM "RiderBillingSchedule" WHERE status='ACTIVE' AND "nextAttemptAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            AND ("leaseUntil" IS NULL OR "leaseUntil"<(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) ${excluded}
            ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id, "clientId"`);
        if (!claimed.length) break;
        const row = claimed[0];
        seen.push(row.id);
        try {
          const outcome = await this.withRetry(() =>
            this.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT id FROM "RiderBillingSchedule" WHERE id=${row.id} FOR UPDATE`;
                const schedule =
                  await tx.riderBillingSchedule.findUniqueOrThrow({
                    where: { id: row.id },
                    include: { agreement: true },
                  });
                if (
                  schedule.leaseToken !== token ||
                  schedule.status !== 'ACTIVE'
                )
                  return 'deferred';
                const release = { leaseToken: null, leaseUntil: null };
                if (!rentalClientEnabled(row.clientId)) {
                  await tx.riderBillingSchedule.update({
                    where: { id: row.id },
                    data: {
                      ...release,
                      nextAttemptAt: new Date(Date.now() + 60000),
                    },
                  });
                  return 'deferred';
                }
                const a = schedule.agreement;
                const cutoff =
                  a.terminationEffectiveAt ?? a.terminatedAt ?? a.completedAt;
                const period = rentalPeriod(schedule, cutoff);
                if (period.end <= period.start) {
                  await tx.riderBillingSchedule.update({
                    where: { id: row.id },
                    data: { ...release, status: 'CLOSED', lastError: null },
                  });
                  return 'deferred';
                }
                if (period.dueAt > new Date()) {
                  await tx.riderBillingSchedule.update({
                    where: { id: row.id },
                    data: {
                      ...release,
                      nextAttemptAt: period.dueAt,
                      lastError: null,
                    },
                  });
                  return 'deferred';
                }
                if (recoveryRequired(schedule, period)) {
                  await tx.riderBillingSchedule.update({
                    where: { id: row.id },
                    data: {
                      ...release,
                      nextAttemptAt: new Date(Date.now() + 86400000),
                      lastError: 'HISTORICAL_RECOVERY_REVIEW_REQUIRED',
                    },
                  });
                  return 'deferred';
                }
                await this.engine.generateInTransaction(
                  tx,
                  row.clientId,
                  row.id,
                  null,
                  period.start,
                );
                await tx.riderBillingSchedule.update({
                  where: { id: row.id },
                  data: {
                    ...release,
                    lastSuccessAt: new Date(),
                    lastError: null,
                    failureCount: 0,
                    nextAttemptAt: new Date(Date.now() + 60000),
                  },
                });
                return 'processed';
              },
              {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                timeout: 20000,
              },
            ),
          );
          if (outcome === 'processed') processed++;
          else deferred++;
        } catch (error) {
          failed++;
          const message =
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'BILLING_FAILED';
          const current = await this.db.riderBillingSchedule.findUnique({
            where: { id: row.id },
            select: { failureCount: true },
          });
          await this.db.riderBillingSchedule.updateMany({
            where: { id: row.id, leaseToken: token },
            data: {
              leaseToken: null,
              leaseUntil: null,
              failureCount: { increment: 1 },
              lastError: message,
              nextAttemptAt: new Date(
                Date.now() + billingRetryDelay(current?.failureCount ?? 0),
              ),
            },
          });
          this.logger.warn(
            `RENTAL_BILLING_FAILED schedule=${row.id} reason=${message}`,
          );
        }
      }
      await this.db.rentalBillingWorkerRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          status: failed ? 'PARTIAL' : 'SUCCESS',
          processed,
          failed,
          deferred,
        },
      });
      await this.db.rentalBillingWorkerRun.deleteMany({
        where: { startedAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      });
      return { processed, failed, deferred };
    } catch (error) {
      if (runId)
        await this.db.rentalBillingWorkerRun.update({
          where: { id: runId },
          data: {
            finishedAt: new Date(),
            status: 'FAILED',
            processed,
            failed,
            deferred,
            error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : 'RUN_FAILED',
          },
        });
      throw error;
    } finally {
      this.running = false;
    }
  }
}
