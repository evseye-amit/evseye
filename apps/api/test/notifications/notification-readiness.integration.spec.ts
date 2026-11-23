import type { Client } from 'pg';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationReadiness } from '../../scripts/notification-readiness.mjs';
const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
describe.skipIf(!url)('readiness SQL against disposable PostgreSQL', () => {
  let db: Client,
    connected = false;
  const schema = 'readiness_test_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('_test_'))
      throw new Error('Disposable test database required.');
    db = notificationTestClient(url!);
    await db.connect();
    connected = true;
    await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE "_prisma_migrations" (migration_name TEXT,finished_at TIMESTAMP,rolled_back_at TIMESTAMP);
      CREATE TABLE "NotificationCategory" (code TEXT);
      CREATE TABLE "FirebaseProjectConfiguration" (id TEXT,"isActive" BOOLEAN,environment TEXT);
      CREATE TABLE "NotificationAppBinding" (id TEXT,"firebaseConfigurationId" TEXT,"isActive" BOOLEAN,environment TEXT);
      CREATE TABLE "PushDevice" (id TEXT,"notificationAppBindingId" TEXT,"isActive" BOOLEAN);
      CREATE TABLE "NotificationMessage" (status TEXT,"scheduledFor" TIMESTAMP,"createdAt" TIMESTAMP);
      CREATE TABLE "PushDelivery" (status TEXT,"leaseUntil" TIMESTAMP,"nextAttemptAt" TIMESTAMP);
      CREATE TABLE "NotificationTopicSubscription" ("bindingId" TEXT,"leaseUntil" TIMESTAMP,"nextAttemptAt" TIMESTAMP,desired BOOLEAN,applied BOOLEAN,"claimId" TEXT,"createdAt" TIMESTAMP);
      INSERT INTO "FirebaseProjectConfiguration" VALUES ('project',true,'test');
      INSERT INTO "NotificationAppBinding" VALUES ('binding','project',true,'test');
      INSERT INTO "NotificationMessage" VALUES ('WAITING_FOR_CONFIGURATION',NULL,now()),('PROCESSING',NULL,now()-interval '1 hour');
      INSERT INTO "PushDelivery" VALUES ('PROCESSING',now()-interval '1 minute',now());
      INSERT INTO "NotificationTopicSubscription" VALUES ('binding',NULL,now()-interval '1 hour',false,false,NULL,now()-interval '40 days');`);
    for (const name of readdirSync(
      new URL('../../prisma/migrations/', import.meta.url),
    ).filter((n) => n.includes('_notification_')))
      await db.query(
        'INSERT INTO "_prisma_migrations" VALUES ($1,now(),NULL)',
        [name],
      );
    const catalog = JSON.parse(
      readFileSync(
        new URL('../../prisma/notification-catalog.json', import.meta.url),
        'utf8',
      ),
    );
    for (const category of catalog.categories)
      await db.query('INSERT INTO "NotificationCategory" VALUES ($1)', [
        category.code,
      ]);
  });
  afterAll(async () => {
    if (connected) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    }
  });
  it('reports warnings and retained cleanup records without claiming release approval', async () => {
    const result = await notificationReadiness(db, 'test');
    expect(result.status).toBe('DATABASE_CHECKS_PASSED_REQUIRES_ACCEPTANCE');
    expect(result.checks).toContainEqual({
      name: 'expired_delivery_leases_all_environments',
      severity: 'warning',
      count: 1,
    });
    expect(result.checks).toContainEqual({
      name: 'old_acknowledged_unsubscriptions_retained',
      severity: 'info',
      count: 1,
    });
    expect(
      (await db.query('SELECT count(*) FROM "NotificationTopicSubscription"'))
        .rows[0].count,
    ).toBe('1');
  });
  it('blocks environments without active bindings', async () => {
    expect((await notificationReadiness(db, 'other')).status).toBe('BLOCKED');
  });
});
