import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationTestClient } from '../helpers/notification-postgres.js';
import {
  captureUpgradeData,
  compareUpgradeData,
} from '../../scripts/notification-upgrade-check.mjs';
const url = process.env.NOTIFICATION_FOUNDATION_TEST_DATABASE_URL;
describe.skipIf(!url)('snapshot data-preservation checks in PostgreSQL', () => {
  let db: Client,
    connected = false;
  const schema = 'upgrade_test_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('_test_'))
      throw new Error('Disposable test database required');
    db = notificationTestClient(url!);
    await db.connect();
    connected = true;
    await db.query(`CREATE SCHEMA "${schema}";SET search_path TO "${schema}";
      CREATE TABLE "Client" (id TEXT,name TEXT);
      INSERT INTO "Client" VALUES ('one','Synthetic client'),('two','Second client');`);
  });
  afterAll(async () => {
    if (connected) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    }
  });
  it('accepts additive columns but detects changed rows without exposing row contents', async () => {
    const before = await captureUpgradeData(db);
    await db.query(
      'ALTER TABLE "Client" ADD "newSetting" TEXT DEFAULT \'enabled\'',
    );
    const after = await captureUpgradeData(db, before);
    expect(compareUpgradeData(before, after)).toEqual([]);
    expect(JSON.stringify(after)).not.toContain('Synthetic client');
    await db.query("UPDATE \"Client\" SET name='Changed' WHERE id='one'");
    expect(
      compareUpgradeData(before, await captureUpgradeData(db, before)),
    ).toEqual(['Client']);
    await db.query('DELETE FROM "Client" WHERE id=\'two\'');
    expect(
      compareUpgradeData(before, await captureUpgradeData(db, before)),
    ).toEqual(['Client']);
  });
});
