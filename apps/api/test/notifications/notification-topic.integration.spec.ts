import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import { Prisma } from '@prisma/client';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NotificationTopicWorker } from '../../src/notifications/notification-topic.worker.js';
const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
describe.skipIf(!url)('durable topic reconciliation in PostgreSQL', () => {
  let db: Client,
    connected = false,
    worker: NotificationTopicWorker,
    provider: any;
  const schema = `topic_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('_test_'))
      throw new Error('Disposable test database required');
    db = notificationTestClient(url!);
    await db.connect();
    connected = true;
    await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE "PushDevice" (id TEXT PRIMARY KEY);
      CREATE TABLE "NotificationInstallation" ("clientId" TEXT,"bindingId" TEXT,"hasRegistered" BOOLEAN);
      CREATE TABLE "NotificationAppBinding" (id TEXT PRIMARY KEY,"clientId" TEXT,environment TEXT,UNIQUE("clientId",id));
      INSERT INTO "PushDevice" VALUES ('device');
      INSERT INTO "NotificationAppBinding" VALUES ('binding','client','test'),('other','other-client','test');`);
    await db.query(
      readFileSync(
        new URL(
          '../../prisma/migrations/20261123170000_notification_topics/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const adapter: any = {
      $queryRaw: async (sql: Prisma.Sql) =>
        (await db.query(sql.text, sql.values)).rows,
      $executeRaw: async (sql: Prisma.Sql) =>
        (await db.query(sql.text, sql.values)).rowCount,
      notificationTopicSubscription: {
        findMany: async () =>
          (
            await db.query(
              `SELECT id,"deviceId" FROM "NotificationTopicSubscription" WHERE "nextAttemptAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) ORDER BY "nextAttemptAt",id`,
            )
          ).rows,
        findUniqueOrThrow: async ({ where }: any) => {
          const row = (
            await db.query(
              `SELECT s.*,t.name,t."logicalKey" FROM "NotificationTopicSubscription" s JOIN "NotificationTopic" t ON t.id=s."topicId" WHERE s.id=$1`,
              [where.id],
            )
          ).rows[0];
          return {
            ...row,
            topic: { name: row.name, logicalKey: row.logicalKey },
          };
        },
      },
    };
    provider = { manageTopic: vi.fn() };
    worker = new NotificationTopicWorker(
      adapter,
      { environment: 'test', plan: vi.fn() } as any,
      provider,
    );
  });
  afterAll(async () => {
    if (connected) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    }
  });
  beforeEach(async () => {
    provider.manageTopic.mockReset().mockResolvedValue({ accepted: true });
    await db.query(`TRUNCATE "NotificationTopicSubscription","NotificationTopic";
      INSERT INTO "NotificationTopic"(id,"clientId","bindingId","logicalKey",name) VALUES ('topic','client','binding','all_users','physical-topic');
      INSERT INTO "NotificationTopicSubscription"(id,"clientId","bindingId","topicId","deviceId","deviceVersion",token,"tokenHash",desired) VALUES ('sub','client','binding','topic','device',1,'token','hash',true);`);
  });
  it('enforces tenant/binding ownership and unique token memberships', async () => {
    await expect(
      db.query(
        `UPDATE "NotificationTopicSubscription" SET "clientId"='other-client',"bindingId"='other'`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.query(
        `INSERT INTO "NotificationTopicSubscription"(id,"clientId","bindingId","topicId","deviceVersion",token,"tokenHash",desired) VALUES ('duplicate','client','binding','topic',1,'token','hash',true)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('records uncertain intent before SDK call and repairs a desired-state change during the call', async () => {
    provider.manageTopic.mockImplementationOnce(async () => {
      const s = (
        await db.query(
          'SELECT applied,"claimId" FROM "NotificationTopicSubscription"',
        )
      ).rows[0];
      expect(s.applied).toBeNull();
      expect(s.claimId).toBeTruthy();
      await db.query(
        'UPDATE "NotificationTopicSubscription" SET desired=false',
      );
      return { accepted: true };
    });
    await worker.dispatch();
    let s = (await db.query('SELECT * FROM "NotificationTopicSubscription"'))
      .rows[0];
    expect(s.applied).toBe(true);
    expect(s.desired).toBe(false);
    expect(s.claimId).toBeNull();
    await worker.dispatch();
    expect(provider.manageTopic.mock.calls[1][0].subscribe).toBe(false);
    s = (await db.query('SELECT * FROM "NotificationTopicSubscription"'))
      .rows[0];
    expect(s.applied).toBe(false);
    expect(s.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('does not duplicate a live lease and replays an expired uncertain operation', async () => {
    await db.query(
      `UPDATE "NotificationTopicSubscription" SET "claimId"='crashed',"leaseUntil"=now()+interval '2 minutes',applied=NULL`,
    );
    await worker.dispatch();
    expect(provider.manageTopic).not.toHaveBeenCalled();
    await db.query(
      `UPDATE "NotificationTopicSubscription" SET "leaseUntil"=now()-interval '1 second'`,
    );
    await worker.dispatch();
    expect(provider.manageTopic).toHaveBeenCalledTimes(1);
    expect(
      (await db.query('SELECT applied FROM "NotificationTopicSubscription"'))
        .rows[0].applied,
    ).toBe(true);
  });
});
