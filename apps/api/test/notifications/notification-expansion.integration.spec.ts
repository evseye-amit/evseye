import type { Client } from 'pg';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotificationWorker } from '../../src/notifications/notification.worker.js';
const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
describe.skipIf(!url)('bounded expired recipient cleanup in PostgreSQL', () => {
  let db: Client;
  let connected = false;
  const schema = 'expiry_test_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('_test_'))
      throw new Error('Disposable test database required.');
    db = notificationTestClient(url!);
    await db.connect();
    connected = true;
    await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE "NotificationMessage" (id TEXT PRIMARY KEY,"clientId" TEXT,"withdrawnAt" TIMESTAMP,"scheduledFor" TIMESTAMP,"pushExpiresAt" TIMESTAMP);
      CREATE TABLE "UserNotification" (id TEXT PRIMARY KEY,"clientId" TEXT,"userId" TEXT,"messageId" TEXT,"createdAt" TIMESTAMP DEFAULT now(),"expandedAt" TIMESTAMP,"noActiveDevice" BOOLEAN DEFAULT false);
      INSERT INTO "NotificationMessage" VALUES ('expired','client',NULL,NULL,now()-interval '1 day'),('live','client',NULL,NULL,now()+interval '1 day'),('future','client',NULL,now()+interval '1 hour',now()+interval '2 days'),('withdrawn','client',now(),NULL,now()+interval '1 day');
      INSERT INTO "UserNotification" (id,"clientId","userId","messageId","createdAt") SELECT 'old-'||n,'client','user','expired',now()-interval '2 days' FROM generate_series(1,450) n;
      INSERT INTO "UserNotification" (id,"clientId","userId","messageId") VALUES ('live','client','user','live'),('future','client','user','future'),('withdrawn','client','user','withdrawn');`);
  });
  afterAll(async () => {
    if (connected) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    }
  });
  it('cleans at most 200 old rows while still expanding live work and leaving future work alone', async () => {
    const tx: any = {
      $queryRaw: async (sql: any) =>
        (await db.query(sql.text, sql.values)).rows,
      $executeRaw: async (sql: any) =>
        (await db.query(sql.text, sql.values)).rowCount,
      pushDevice: { findMany: vi.fn(async () => []) },
      pushDelivery: { createMany: vi.fn() },
      userNotification: {
        update: async ({ where }: any) =>
          db.query(
            'UPDATE "UserNotification" SET "expandedAt"=now() WHERE id=$1',
            [where.id],
          ),
      },
    };
    tx.$transaction = async (fn: any) => {
      await db.query('BEGIN');
      try {
        const result = await fn(tx);
        await db.query('COMMIT');
        return result;
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    };
    const worker = new NotificationWorker(
      tx,
      new ConfigService(),
      {} as never,
      { configured: false, send: async () => [] },
    );
    expect(await worker.expandRecipients()).toBe(1);
    expect(tx.pushDevice.findMany).toHaveBeenCalledTimes(1);
    expect(tx.pushDelivery.createMany).not.toHaveBeenCalled();
    expect(
      Number(
        (
          await db.query(
            'SELECT count(*) FROM "UserNotification" WHERE "messageId"=\'expired\' AND "expandedAt" IS NOT NULL',
          )
        ).rows[0].count,
      ),
    ).toBe(200);
    expect(
      (
        await db.query(
          'SELECT "expandedAt" FROM "UserNotification" WHERE id=\'future\'',
        )
      ).rows[0].expandedAt,
    ).toBeNull();
    await worker.expandRecipients();
    await worker.expandRecipients();
    expect(
      Number(
        (
          await db.query(
            'SELECT count(*) FROM "UserNotification" WHERE "expandedAt" IS NULL',
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(tx.pushDevice.findMany).toHaveBeenCalledTimes(1);
  });
});
