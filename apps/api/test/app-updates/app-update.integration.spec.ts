import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { AppUpdateService } from '../../src/app-updates/app-update.service.js';

// Dedicated disposable database only. This suite applies the real additive migration
// to a minimal pre-existing baseline, independently of the developer's DATABASE_URL.
const url = process.env.APP_UPDATE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    !parsed.pathname.startsWith('/app_update_test_') ||
    !parsed.port ||
    parsed.port === '5432'
  )
    throw new Error(
      'APP_UPDATE_TEST_DATABASE_URL must name a dedicated localhost app_update_test_ database on a nondefault port.',
    );
}
describe.skipIf(!url)(
  'app update migration and transactional persistence',
  () => {
    const pool = url ? new Pool({ connectionString: url }) : null;
    const prisma = url ? createTestPrisma(url) : null;
    const clientA = randomUUID(),
      clientB = randomUUID(),
      actorId = randomUUID();
    const identity = {
      appCode: 'RIDER_APP' as const,
      platform: 'ANDROID' as const,
      applicationId: 'com.example.rider',
      channel: 'PRODUCTION' as const,
    };
    const settings = {
      enabled: true,
      minimum: { version: '1.0.0', build: '10' },
      latest: { version: '1.1.0', build: '20' },
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.example.rider',
      title: 'Update',
      message: 'Please update.',
      releaseNotes: '',
    };
    let service: AppUpdateService;
    beforeAll(async () => {
      await pool!
        .query(`CREATE TABLE IF NOT EXISTS "Client" (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        id BIGSERIAL PRIMARY KEY, "clientId" TEXT REFERENCES "Client"(id) ON DELETE CASCADE,
        "actorId" TEXT REFERENCES "User"(id), action TEXT NOT NULL, "entityType" TEXT NOT NULL,
        "entityId" TEXT, "previousData" JSONB, "newData" JSONB, "requestId" TEXT, "ipAddress" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`);
      const existing = await pool!.query(
        `SELECT to_regclass('"AppUpdatePolicy"') AS name`,
      );
      if (!existing.rows[0].name)
        await pool!.query(
          readFileSync(
            new URL(
              '../../prisma/migrations/20261123090000_app_update_policies/migration.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
      await pool!.query('INSERT INTO "Client"(id) VALUES ($1), ($2)', [
        clientA,
        clientB,
      ]);
      await pool!.query('INSERT INTO "User"(id, name) VALUES ($1, $2)', [
        actorId,
        'Integration Admin',
      ]);
      service = new AppUpdateService(prisma as never);
    });
    afterAll(async () => {
      if (pool) {
        await pool.query('DELETE FROM "Client" WHERE id IN ($1, $2)', [
          clientA,
          clientB,
        ]);
        await pool.query('DELETE FROM "User" WHERE id = $1', [actorId]);
        await pool.end();
      }
      await prisma?.$disconnect();
    });
    it('publishes, isolates, disables, and restores policy snapshots with retained audit', async () => {
      const draft = await service.save(clientA, actorId, {
        ...identity,
        settings,
        expectedRevision: 0,
      });
      const input = {
        ...identity,
        installed: { version: '1.0.0', build: '1' },
      };
      expect((await service.check(clientA, input)).decision).toBe('allowed');
      const published = await service.publish(
        clientA,
        draft.id,
        actorId,
        1,
        true,
      );
      expect((await service.check(clientA, input)).decision).toBe(
        'required_update',
      );
      expect((await service.check(clientB, input)).decision).toBe('allowed');
      expect(
        (await service.check(clientA, { ...input, channel: 'TEST' })).decision,
      ).toBe('allowed');
      expect(
        (
          await service.check(clientA, {
            ...input,
            applicationId: 'com.example.other',
          })
        ).decision,
      ).toBe('allowed');
      await expect(
        service.disable(clientB, draft.id, actorId, published.revision),
      ).rejects.toThrow('not found');
      const disabled = await service.disable(
        clientA,
        draft.id,
        actorId,
        published.revision,
      );
      expect((await service.check(clientA, input)).decision).toBe('allowed');
      const restored = await service.restore(
        clientA,
        draft.id,
        actorId,
        disabled.revision,
        published.revision,
      );
      expect((await service.check(clientA, input)).decision).toBe('allowed');
      await service.publish(
        clientA,
        draft.id,
        actorId,
        restored.revision,
        true,
      );
      expect((await service.check(clientA, input)).decision).toBe(
        'required_update',
      );
      const [row] = await service.list(clientA);
      expect(row.history).toHaveLength(5);
      expect(row.history[0].actorName).toBe('Integration Admin');
      expect(
        await prisma!.auditLog.count({ where: { entityId: draft.id } }),
      ).toBe(5);
    });
    it('permits exactly one of two concurrent edits and appends only the winning revision', async () => {
      const draft = await service.save(clientB, actorId, {
        ...identity,
        settings,
        expectedRevision: 0,
      });
      const results = await Promise.allSettled([
        service.save(clientB, actorId, {
          ...identity,
          settings: { ...settings, title: 'A' },
          expectedRevision: draft.revision,
        }),
        service.save(clientB, actorId, {
          ...identity,
          settings: { ...settings, title: 'B' },
          expectedRevision: draft.revision,
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      const [row] = await service.list(clientB);
      expect(row.revision).toBe(2);
      expect(row.history).toHaveLength(2);
      expect(
        await prisma!.auditLog.count({ where: { entityId: draft.id } }),
      ).toBe(2);
    });
    it('rolls back the policy change when audit actor lookup fails', async () => {
      const [before] = await service.list(clientB);
      await expect(
        service.save(clientB, 'missing-actor', {
          ...identity,
          settings,
          expectedRevision: before.revision,
        }),
      ).rejects.toThrow();
      const [after] = await service.list(clientB);
      expect(after.revision).toBe(before.revision);
      expect(after.draft).toEqual(before.draft);
      expect(after.history).toHaveLength(before.history.length);
    });
    it('resolves concurrent first creation into one policy and a conflict', async () => {
      const dto = {
        ...identity,
        channel: 'TEST' as const,
        settings,
        expectedRevision: 0,
      };
      const results = await Promise.allSettled([
        service.save(clientA, actorId, dto),
        service.save(clientA, actorId, dto),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect(
        await prisma!.appUpdatePolicy.count({
          where: { clientId: clientA, channel: 'TEST' },
        }),
      ).toBe(1);
    });
  },
);
