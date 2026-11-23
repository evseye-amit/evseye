import { NotificationTopicService } from '../../src/notifications/notification-topic.service.js';
import type { Client } from 'pg';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { targetPredicate } from '../../src/notifications/notification-targeting.js';

const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
const names = new Map<string, string>();
function idFor(name: string) {
  if (!names.has(name))
    names.set(
      name,
      `00000000-0000-4000-8000-${String(names.size + 1).padStart(12, '0')}`,
    );
  return names.get(name)!;
}
describe.skipIf(!url)(
  'recipient targeting and relevant inbox in PostgreSQL',
  () => {
    let db: Client;
    let connected = false;
    let service: NotificationService;
    const schema = `relevance_test_${randomUUID().replaceAll('-', '')}`;
    beforeAll(async () => {
      if (!new URL(url!).pathname.includes('_test_'))
        throw new Error('Disposable _test_ database required.');
      db = notificationTestClient(url!);
      await db.connect();
      connected = true;
      await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
   CREATE TABLE "Client" (id TEXT PRIMARY KEY,"isActive" BOOLEAN DEFAULT true,status TEXT DEFAULT 'ACTIVE');
   CREATE TABLE "User" (id TEXT PRIMARY KEY,"clientId" TEXT,role TEXT,"isActive" BOOLEAN DEFAULT true,"deletedAt" TIMESTAMP, UNIQUE ("clientId",id));
   CREATE TABLE "Hub" (id TEXT PRIMARY KEY,"clientId" TEXT,city TEXT,"deletedAt" TIMESTAMP);
   CREATE TABLE "UserHub" ("clientId" TEXT,"userId" TEXT,"hubId" TEXT);
   CREATE TABLE "Rider" (id TEXT PRIMARY KEY,"userId" TEXT,"clientId" TEXT,"deletedAt" TIMESTAMP);
   CREATE TABLE "Fleet" (id TEXT PRIMARY KEY,"clientId" TEXT,"currentHubId" TEXT,"homeHubId" TEXT,"vehicleTypeId" TEXT,"oemId" TEXT,"deletedAt" TIMESTAMP);
   CREATE TABLE "Allocation" (id TEXT PRIMARY KEY,"clientId" TEXT,"riderId" TEXT,"fleetId" TEXT,status TEXT);
   CREATE TABLE "NotificationCategory" (code VARCHAR(100) PRIMARY KEY);
   CREATE TABLE "NotificationMessage" (id TEXT PRIMARY KEY,status TEXT DEFAULT 'QUEUED',"createdAt" TIMESTAMP DEFAULT now(),"pushExpiresAt" TIMESTAMP DEFAULT now()+interval '100 days',"clientId" TEXT,title TEXT,body TEXT,data JSONB DEFAULT '{}',source TEXT DEFAULT 'MANUAL',"categoryCode" TEXT);
   CREATE TABLE "UserNotification" (id TEXT PRIMARY KEY,"clientId" TEXT,"userId" TEXT,"messageId" TEXT,"createdAt" TIMESTAMP,"readAt" TIMESTAMP);
  `);
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123140000_notification_targeting/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123150000_notification_preferences/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await db.query(
        'CREATE TRIGGER notification_message_content_guard BEFORE UPDATE ON "NotificationMessage" FOR EACH ROW EXECUTE FUNCTION guard_notification_message_content()',
      );
      const adapter: any = {
        $queryRaw: async (sql: Prisma.Sql) =>
          (await db.query(sql.text, sql.values)).rows,
        $executeRaw: async (sql: Prisma.Sql) =>
          (await db.query(sql.text, sql.values)).rowCount,
        user: {
          findFirst: async ({ where }: any) =>
            (
              await db.query(
                'SELECT role FROM "User" WHERE id=$1 AND "clientId"=$2 AND "isActive" AND "deletedAt" IS NULL',
                [where.id, where.clientId],
              )
            ).rows[0],
        },
      };
      await db.query(
        readFileSync(
          new URL(
            '../../prisma/migrations/20261123180000_notification_scheduling/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      service = new NotificationService(adapter, new ConfigService(), {
        configured: false,
        send: async () => [],
      });
    });
    afterAll(async () => {
      if (connected) {
        await db.query(`DROP SCHEMA "${schema}" CASCADE`);
        await db.end();
      }
    });
    beforeEach(async () => {
      await db.query(`TRUNCATE "NotificationPreference","NotificationConsent","NotificationCategory","UserNotification","NotificationMessage","Allocation","Fleet","Rider","UserHub","Hub","User","Client";
   INSERT INTO "Client" (id) VALUES ('a'),('b');
   INSERT INTO "User" (id,"clientId",role) VALUES ('r1','a','RIDER'),('r2','a','RIDER'),('r3','a','RIDER'),('fm','a','FLEET_MANAGER'),('other','b','RIDER');
   INSERT INTO "Hub" (id,"clientId",city) VALUES ('h1','a',' Delhi '),('h2','a','Pune'),('hb','b','Delhi');
   INSERT INTO "UserHub" VALUES ('a','r1','h2'),('a','r3','h1'),('a','fm','h1');
   INSERT INTO "Rider" (id,"userId","clientId") VALUES ('rider1','r1','a'),('rider2','r2','a');
   INSERT INTO "Fleet" (id,"clientId","currentHubId","homeHubId","vehicleTypeId","oemId") VALUES ('f1','a','h1','h2','type1','oem1'),('f2','a','h2','h1','type2','oem2');
   INSERT INTO "Allocation" VALUES ('alloc1','a','rider1','f1','ACTIVE'),('alloc2','a','rider2','f2','DEALLOCATION_INITIATED');
  `);
    });
    async function recipients(input: any) {
      const sql = Prisma.sql`SELECT u.id FROM "User" u WHERE u."clientId"='a' AND ${targetPredicate(input)} ORDER BY u.id`;
      return (await db.query(sql.text, sql.values)).rows.map((r) => r.id);
    }
    async function message(
      id: string,
      policy = 'OPERATIONAL',
      hubs: string[] = ['h1'],
      user = 'r1',
      client = 'a',
      expires: Date | null = null,
      application: string | null = null,
      categoryCode: string | null = null,
      scheduledFor: Date | null = null,
    ) {
      id = idFor(id);
      await db.query(
        `INSERT INTO "NotificationMessage" (id,"clientId",title,body,"visibilityPolicy","targetHubIds","targetRoles","visibilityExpiresAt","application","categoryCode","scheduledFor","createdAt") VALUES ($1,$2,$1,$1,$3,$4,$5,$6,$7,$8,$9,now()-interval '2 days')`,
        [
          id,
          client,
          policy,
          hubs,
          policy === 'OPERATIONAL' ? ['RIDER'] : [],
          expires,
          application,
          categoryCode,
          scheduledFor,
        ],
      );
      await db.query(
        'INSERT INTO "UserNotification" (id,"clientId","userId","messageId","createdAt") VALUES ($1,$2,$3,$1,$4)',
        [id, client, user, new Date('2026-01-01')],
      );
    }
    it('hides future schedules across inbox, unread, read and dispatch, and exposes due schedules', async () => {
      await message(
        'future',
        'PERSONAL',
        [],
        'r1',
        'a',
        null,
        null,
        null,
        new Date(Date.now() + 3600000),
      );
      await message(
        'due',
        'PERSONAL',
        [],
        'r1',
        'a',
        null,
        null,
        null,
        new Date(Date.now() - 3600000),
      );
      expect(
        (await service.inbox('a', 'r1', { limit: 20 })).items.map((r) => r.id),
      ).toEqual([idFor('due')]);
      expect(await service.unread('a', 'r1')).toEqual({ count: 1 });
      await expect(service.read('a', 'r1', idFor('future'))).rejects.toThrow(
        'not found',
      );
      await expect(service.readAll('a', 'r1', idFor('future'))).rejects.toThrow(
        'not found',
      );
      expect(await service.readAll('a', 'r1')).toEqual({ updated: 1 });
      expect(
        await service.eligibleForDeliveries('a', [
          idFor('future'),
          idFor('due'),
        ]),
      ).toEqual(new Set([idFor('due')]));
      await expect(
        db.query(
          'UPDATE "NotificationMessage" SET "scheduledFor"=now() WHERE id=$1',
          [idFor('future')],
        ),
      ).rejects.toThrow();
      await db.query(
        'UPDATE "NotificationMessage" SET "withdrawnAt"=now() WHERE id=$1',
        [idFor('due')],
      );
      expect(await service.eligibleForDeliveries('a', [idFor('due')])).toEqual(
        new Set(),
      );
    });
    it('hides application-specific general notices after a role change even without an app filter', async () => {
      await message('general-rider', 'GENERAL', [], 'r1', 'a', null, 'RIDER');
      expect(
        await service.eligibleForDeliveries('a', [idFor('general-rider')]),
      ).toEqual(new Set([idFor('general-rider')]));
      await db.query(`UPDATE "User" SET role='FLEET_MANAGER' WHERE id='r1'`);
      expect(
        await service.eligibleForDeliveries('a', [idFor('general-rider')]),
      ).toEqual(new Set());
    });
    it('requires marketing consent and honors withdrawal without changing inbox history', async () => {
      await message(
        'offer',
        'PERSONAL',
        [],
        'r1',
        'a',
        null,
        'RIDER',
        'PG11_OFFERS',
      );
      const ids = [idFor('offer')];
      expect(await service.eligibleForDeliveries('a', ids)).toEqual(new Set());
      await db.query(
        `INSERT INTO "NotificationConsent" VALUES ('a','r2','RIDER',true,now()),('a','r1','FLEET_MANAGER',true,now())`,
      );
      expect(await service.eligibleForDeliveries('a', ids)).toEqual(new Set());
      await db.query(
        `INSERT INTO "NotificationConsent" VALUES ('a','r1','RIDER',true,now())`,
      );
      expect(await service.eligibleForDeliveries('a', ids)).toEqual(
        new Set(ids),
      );
      await db.query(
        `UPDATE "NotificationConsent" SET "marketingEnabled"=false`,
      );
      expect(await service.eligibleForDeliveries('a', ids)).toEqual(new Set());
      expect(await service.unread('a', 'r1')).toEqual({ count: 1 });
    });
    it('honors category opt-out but preserves essential delivery and tenant foreign keys', async () => {
      await message(
        'update',
        'PERSONAL',
        [],
        'r1',
        'a',
        null,
        'RIDER',
        'PG01_APP_UPDATES',
      );
      await message(
        'invoice',
        'PERSONAL',
        [],
        'r1',
        'a',
        null,
        'RIDER',
        'PG06_INVOICE',
      );
      await db.query(`INSERT INTO "NotificationCategory" VALUES ('PG01_APP_UPDATES'),('PG06_INVOICE');
        INSERT INTO "NotificationPreference" VALUES ('a','r1','RIDER','PG01_APP_UPDATES',false,now()),('a','r1','RIDER','PG06_INVOICE',false,now())`);
      expect(
        await service.eligibleForDeliveries('a', [
          idFor('update'),
          idFor('invoice'),
        ]),
      ).toEqual(new Set([idFor('invoice')]));
      expect(await service.unread('a', 'r1')).toEqual({ count: 2 });
      await expect(
        db.query(
          `INSERT INTO "NotificationConsent" VALUES ('b','r1','RIDER',true,now())`,
        ),
      ).rejects.toThrow();
    });
    it('uses the same live allocation and unallocated hub fallback for topic dimensions', async () => {
      const topics = new NotificationTopicService(
        {} as any,
        {} as any,
        new ConfigService(),
      );
      const adapter: any = {
        $queryRaw: async (sql: Prisma.Sql) =>
          (await db.query(sql.text, sql.values)).rows,
      };
      expect(await (topics as any).dimensions(adapter, 'a', 'r1')).toEqual([
        { hubId: 'h1', city: ' Delhi ', vehicleTypeId: 'type1', oemId: 'oem1' },
      ]);
      expect(await (topics as any).dimensions(adapter, 'a', 'r3')).toEqual([
        { hubId: 'h1', city: ' Delhi ', vehicleTypeId: null, oemId: null },
      ]);
      expect(await (topics as any).dimensions(adapter, 'b', 'r1')).toEqual([]);
    });
    it('combines OR within filters and AND across dimensions on the same allocation', async () => {
      expect(
        await recipients({
          audience: 'ALL_RIDERS',
          hubIds: ['h1', 'h2'],
          vehicleTypeIds: ['type1'],
          oemIds: ['oem1'],
          cities: ['DELHI'],
        }),
      ).toEqual(['r1']);
      expect(
        await recipients({
          audience: 'ALL_RIDERS',
          vehicleTypeIds: ['type1'],
          oemIds: ['oem2'],
        }),
      ).toEqual([]);
      expect(
        await recipients({ audience: 'ALL_RIDERS', roles: ['FLEET_MANAGER'] }),
      ).toEqual([]);
      expect(await recipients({ audience: 'ALL_EMPLOYEES' })).toEqual(['fm']);
    });
    it('uses assigned hubs only for unallocated riders and staff', async () => {
      expect(
        await recipients({ audience: 'ALL_USERS', hubIds: ['h1'] }),
      ).toEqual(['fm', 'r1', 'r3']);
      expect(
        await recipients({ audience: 'ALL_RIDERS', hubIds: ['h2'] }),
      ).toEqual(['r2']);
      await db.query(
        "UPDATE \"Allocation\" SET status='COMPLETED' WHERE id='alloc1'",
      );
      expect(
        await recipients({ audience: 'ALL_RIDERS', hubIds: ['h2'] }),
      ).toEqual(['r1', 'r2']);
    });
    it('filters before pagination and shares eligibility with count, read and mark-all-read', async () => {
      await message('a-visible');
      await message('z-hidden', 'OPERATIONAL', ['h2']);
      await message('b-visible');
      const first = await service.inbox('a', 'r1', { limit: 1 });
      expect(first.items.map((r) => r.id)).toEqual([idFor('b-visible')]);
      expect(first.nextCursor).toBeTruthy();
      const next = await service.inbox('a', 'r1', {
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(next.items.map((r) => r.id)).toEqual([idFor('a-visible')]);
      expect(next.nextCursor).toBeNull();
      expect(await service.unread('a', 'r1')).toEqual({ count: 2 });
      await expect(service.read('a', 'r1', idFor('z-hidden'))).rejects.toThrow(
        'not found',
      );
      await expect(
        service.readAll('a', 'r1', idFor('z-hidden')),
      ).rejects.toThrow('not found');
      expect(await service.readAll('a', 'r1')).toEqual({ updated: 2 });
      expect(await service.unread('a', 'r1')).toEqual({ count: 0 });
      expect(
        (
          await db.query(
            'SELECT "readAt" FROM "UserNotification" WHERE id=$1',
            [idFor('z-hidden')],
          )
        ).rows[0].readAt,
      ).toBeNull();
    });
    it('retains personal history after hub/role changes while revoking operational notices', async () => {
      await message('invoice', 'PERSONAL');
      await message('hub-notice');
      await db.query(
        'UPDATE "Fleet" SET "currentHubId"=\'h2\' WHERE id=\'f1\'',
      );
      expect(
        (await service.inbox('a', 'r1', { limit: 20 })).items.map((r) => r.id),
      ).toEqual([idFor('invoice')]);
      await db.query("UPDATE \"User\" SET role='FLEET_MANAGER' WHERE id='r1'");
      expect(await service.unread('a', 'r1')).toEqual({ count: 1 });
      expect(
        await service.eligibleForDeliveries(
          'a',
          ['invoice', 'hub-notice'].map(idFor),
        ),
      ).toEqual(new Set([idFor('invoice')]));
    });
    it('rejects cross-user/client access, wrong-app filters and suspended clients', async () => {
      await message('mine');
      await message('other-user', 'PERSONAL', [], 'r2');
      await message('other-client', 'PERSONAL', [], 'other', 'b');
      expect(
        (await service.inbox('a', 'r1', { limit: 20 })).items.map((r) => r.id),
      ).toEqual([idFor('mine')]);
      await expect(
        service.read('a', 'r1', idFor('other-user')),
      ).rejects.toThrow('not found');
      expect(await service.unread('b', 'r1')).toEqual({ count: 0 });
      await expect(
        service.inbox('a', 'r1', { limit: 20, application: 'FLEET_MANAGER' }),
      ).rejects.toThrow('account role');
      await db.query("UPDATE \"Client\" SET status='SUSPENDED' WHERE id='a'");
      expect(await service.unread('a', 'r1')).toEqual({ count: 0 });
    });
    it('excludes withdrawn/visibility-expired messages without using push TTL', async () => {
      await message('kept', 'PERSONAL');
      await message('withdrawn', 'PERSONAL');
      await message(
        'expired',
        'PERSONAL',
        [],
        'r1',
        'a',
        new Date(Date.now() - 10000),
      );
      await db.query(
        'UPDATE "NotificationMessage" SET "withdrawnAt"=now() WHERE id=$1',
        [idFor('withdrawn')],
      );
      expect(
        (await service.inbox('a', 'r1', { limit: 20 })).items.map((r) => r.id),
      ).toEqual([idFor('kept')]);
      expect(
        await service.eligibleForDeliveries(
          'a',
          ['kept', 'withdrawn', 'expired'].map(idFor),
        ),
      ).toEqual(new Set([idFor('kept')]));
    });
    it('keeps targeting immutable and withdrawal irreversible', async () => {
      await message('guarded');
      await expect(
        db.query(
          'UPDATE "NotificationMessage" SET "targetHubIds"=$1 WHERE id=$2',
          [['h2'], idFor('guarded')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await db.query(
        'UPDATE "NotificationMessage" SET "withdrawnAt"=now() WHERE id=$1',
        [idFor('guarded')],
      );
      await expect(
        db.query(
          'UPDATE "NotificationMessage" SET "withdrawnAt"=NULL WHERE id=$1',
          [idFor('guarded')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  },
);
