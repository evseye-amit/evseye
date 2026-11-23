import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import { ConfigService } from '@nestjs/config';
import { NotificationWorker } from '../../src/notifications/notification.worker.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
// Verifies this additive migration independently of the complete PostGIS-backed application schema.
describe.skipIf(!url)(
  'notification foundation migration in disposable PostgreSQL schema',
  () => {
    let db: Client;
    let connected = false;
    const schema = `notification_test_${randomUUID().replaceAll('-', '')}`;
    beforeAll(async () => {
      if (!new URL(url!).pathname.includes('_test_'))
        throw new Error('Use a disposable _test_ database.');
      db = notificationTestClient(url!);
      await db.connect();
      connected = true;
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.query(`SET search_path TO "${schema}"`);
      // Minimal existing tables needed by this migration, not a substitute for full application integration tests.
      await db.query(`CREATE TABLE "Client" (id TEXT PRIMARY KEY);
      CREATE TABLE "PushDevice" (id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "Client"(id));
      CREATE TABLE "NotificationMessage" (id TEXT PRIMARY KEY);
      INSERT INTO "Client" VALUES ('tenant-a'), ('tenant-b');`);
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123120000_notification_foundation/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    });
    afterAll(async () => {
      if (connected) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.end();
      }
    });
    it('applies additively and enforces project environment and device tenant boundaries', async () => {
      await db.query(`INSERT INTO "FirebaseProjectConfiguration" (id,"projectId",environment,"credentialReference","updatedAt") VALUES ('project','firebase-project','prod','FIREBASE_CLIENT_SECRET',now());
      INSERT INTO "NotificationAppBinding" (id,"clientId","appCode",platform,"applicationId",environment,"firebaseConfigurationId","updatedAt") VALUES ('binding','tenant-a','RIDER_APP','ANDROID','com.example.rider','prod','project',now());
      INSERT INTO "PushDevice" (id,"clientId","notificationAppBindingId") VALUES ('old-device','tenant-a',NULL), ('new-device','tenant-a','binding');`);
      await expect(
        db.query(
          `INSERT INTO "PushDevice" (id,"clientId","notificationAppBindingId") VALUES ('wrong-device','tenant-b','binding')`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.query(
          `INSERT INTO "NotificationAppBinding" (id,"clientId","appCode",platform,"applicationId",environment,"firebaseConfigurationId","updatedAt") VALUES ('bad-env','tenant-a','RIDER_APP','IOS','com.example.rider','staging','project',now())`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.query(
          `UPDATE "FirebaseProjectConfiguration" SET "credentialReference"='{"private_key":"not-allowed"}' WHERE id='project'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('enforces installation binding tenant and lifecycle constraints', async () => {
      await db.query(
        'CREATE TABLE "User" (id TEXT PRIMARY KEY, "clientId" TEXT, UNIQUE ("clientId",id)); CREATE TABLE "Session" (id TEXT PRIMARY KEY)',
      );
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123160000_notification_installations/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const id = randomUUID();
      await db.query(
        `INSERT INTO "NotificationInstallation" (id,"clientId","bindingId","credentialHash","updatedAt") VALUES ($1,'tenant-a','binding',$2,now())`,
        [id, 'a'.repeat(64)],
      );
      await expect(
        db.query(
          `UPDATE "NotificationInstallation" SET "clientId"='tenant-b' WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.query(
          `UPDATE "NotificationInstallation" SET permission='INVALID' WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          `UPDATE "NotificationInstallation" SET "onboardingState"='REGISTERED' WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('rejects invalid catalog mappings and priorities', async () => {
      await db.query(`INSERT INTO "NotificationParentGroup" (code,name,"sortOrder","updatedAt") VALUES ('PG01','General',0,now());
      INSERT INTO "NotificationCategory" (code,"parentCode",name,description,"updatedAt") VALUES ('GENERAL','PG01','General','General notices',now());`);
      await expect(
        db.query(
          `INSERT INTO "NotificationApplicationCategory" ("categoryCode",application,"updatedAt") VALUES ('GENERAL','OPTIONAL',now())`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          `UPDATE "NotificationCategory" SET "defaultPriority"='CRITICAL' WHERE code='GENERAL'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(`DELETE FROM "NotificationParentGroup" WHERE code='PG01'`),
      ).rejects.toMatchObject({ code: '23503' });
    });
    it('executes project claim and configuration status SQL against PostgreSQL', async () => {
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123130000_notification_binding_dispatch/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await db.query(`CREATE TABLE "PushDispatchState" (id TEXT PRIMARY KEY, "nextAllowedAt" TIMESTAMP NOT NULL, "leaseUntil" TIMESTAMP, "claimId" TEXT);
        CREATE TABLE "PushDelivery" (id TEXT PRIMARY KEY, "deviceId" TEXT, "messageId" TEXT, status TEXT, "nextAttemptAt" TIMESTAMP, attempts INT, "leaseUntil" TIMESTAMP, "claimId" TEXT, "firstAttemptAt" TIMESTAMP, "errorCode" TEXT);
        CREATE TABLE "UserNotification" (id TEXT PRIMARY KEY, "messageId" TEXT, "expandedAt" TIMESTAMP);
        ALTER TABLE "NotificationMessage" ADD "scheduledFor" TIMESTAMP, ADD "withdrawnAt" TIMESTAMP, ADD status TEXT, ADD "createdAt" TIMESTAMP DEFAULT now(), ADD "completedAt" TIMESTAMP, ADD "pushExpiresAt" TIMESTAMP DEFAULT now() + interval '1 day';
        INSERT INTO "NotificationMessage" (id,status) VALUES ('bound-message','QUEUED'),('unbound-message','QUEUED'),('future','SCHEDULED'),('cancelled','SCHEDULED'),('expired','QUEUED');
        UPDATE "NotificationMessage" SET "pushExpiresAt"=now()-interval '1 day' WHERE id='expired';
        UPDATE "NotificationMessage" SET "scheduledFor"=now()+interval '1 day' WHERE id IN ('future','cancelled');
        UPDATE "NotificationMessage" SET "withdrawnAt"=now() WHERE id='cancelled';
        INSERT INTO "PushDelivery" (id,"deviceId","messageId",status,"nextAttemptAt",attempts) VALUES ('bound','new-device','bound-message','PENDING',now(),0),('unbound','old-device','unbound-message','PENDING',now(),0),('future-delivery','new-device','future','PENDING',now(),0),('cancelled-delivery','new-device','cancelled','PENDING',now(),0);`);
      const selected: string[] = [];
      const tx: any = {
        $executeRaw: async (sql: any) =>
          (await db.query(sql.text, sql.values)).rowCount,
        $queryRaw: async (sql: any) => {
          const result = await db.query<{ id: string }>(
            sql.text as string,
            sql.values as unknown[],
          );
          if (sql.text.includes('SELECT d.id'))
            selected.push(...result.rows.map((r) => r.id));
          return result.rows;
        },
        pushDelivery: { updateMany: async () => ({ count: 0 }) },
        pushDispatchState: { update: async () => ({}) },
      };
      tx.$transaction = async (fn: any) => fn(tx);
      const worker = new NotificationWorker(
        tx,
        new ConfigService({
          PUSH_ENVIRONMENT: 'prod',
          PUSH_MAX_ATTEMPTS: 6,
          PUSH_BATCH_SIZE: 100,
          PUSH_TOKENS_PER_SECOND: 100,
        }),
        {} as any,
        { configured: true, scopes: async () => [], send: async () => [] },
      );
      await (worker as any).claim({
        id: 'firebase:prod:project',
        configurationId: 'project',
      });
      expect(selected).toEqual(['bound']);
      await worker.finishMessages();
      const states = (
        await db.query(
          'SELECT id,status FROM "NotificationMessage" ORDER BY id',
        )
      ).rows;
      expect(states).toEqual([
        { id: 'bound-message', status: 'PROCESSING' },
        { id: 'cancelled', status: 'CANCELLED' },
        { id: 'expired', status: 'EXPIRED' },
        { id: 'future', status: 'SCHEDULED' },
        { id: 'unbound-message', status: 'WAITING_FOR_CONFIGURATION' },
      ]);
    });
  },
);
