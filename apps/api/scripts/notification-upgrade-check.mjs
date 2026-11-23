import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const tables = [
  'Client',
  'User',
  'Rider',
  'NotificationMessage',
  'UserNotification',
  'PushDevice',
  'PushDelivery',
  'NotificationConsent',
  'NotificationPreference',
];
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
export function validateRehearsalUrl(value) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.search ||
    !/^\/[A-Za-z0-9_]*_test_[A-Za-z0-9_]+$/.test(url.pathname)
  )
    throw new Error(
      'Use an explicit localhost port and disposable _test_ database, without URL query parameters.',
    );
}
export async function captureUpgradeData(db, baseline) {
  if (
    baseline &&
    (baseline.version !== 1 ||
      !baseline.tables ||
      Object.keys(baseline.tables).sort().join() !== [...tables].sort().join())
  )
    throw new Error('Unsupported baseline.');
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout='60s'");
    await db.query("SET LOCAL lock_timeout='2s'");
    const result = { version: 1, tables: {} };
    const schema = (await db.query('SELECT current_schema() AS schema')).rows[0]
      .schema;
    for (const table of tables) {
      const columns = (
        await db.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
          [schema, table],
        )
      ).rows.map((row) => row.column_name);
      const previous = baseline?.tables[table];
      if (
        previous &&
        (!Array.isArray(previous.columns) ||
          previous.columns.some(
            (c) => typeof c !== 'string' || !columns.includes(c),
          ))
      )
        throw new Error('A baseline column is missing after migration.');
      if (!columns.length) {
        result.tables[table] = null;
        continue;
      }
      // Project only pre-migration columns: additive schema changes must not look like data loss.
      const selected = previous?.columns ?? columns;
      const projection = selected.map(quote).join(',');
      const row = (
        await db.query(`SELECT count(*)::text AS count,
        COALESCE(sum(('x'||substr(digest,1,16))::bit(64)::bigint::numeric),0)::text AS first,
        COALESCE(sum(('x'||substr(digest,17,16))::bit(64)::bigint::numeric),0)::text AS second
        FROM (SELECT md5(to_jsonb(projected)::text) AS digest FROM
          (SELECT ${projection} FROM ${quote(schema)}.${quote(table)}) projected) hashed`)
      ).rows[0];
      result.tables[table] = { columns: selected, ...row };
    }
    return result;
  } finally {
    await db.query('ROLLBACK');
  }
}
export function compareUpgradeData(before, after) {
  return tables.filter((table) => {
    const a = before.tables[table],
      b = after.tables[table];
    if (!a) return b && b.count !== '0';
    return (
      !b || a.count !== b.count || a.first !== b.first || a.second !== b.second
    );
  });
}
export async function main() {
  const [mode, filename] = process.argv.slice(2);
  if (!['before', 'after'].includes(mode) || !filename) {
    console.error(
      'Usage: notification-upgrade-check.mjs before|after <baseline.json>',
    );
    return 1;
  }
  let db;
  try {
    const url = process.env.NOTIFICATION_REHEARSAL_DATABASE_URL;
    validateRehearsalUrl(url);
    db = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await db.connect();
    const baseline =
      mode === 'after' ? JSON.parse(readFileSync(filename, 'utf8')) : undefined;
    const snapshot = await captureUpgradeData(db, baseline);
    if (mode === 'before') {
      writeFileSync(filename, JSON.stringify(snapshot, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      console.log(
        JSON.stringify({ status: 'BASELINE_CAPTURED', tables: tables.length }),
      );
      return 0;
    }
    const changed = compareUpgradeData(baseline, snapshot);
    console.log(
      JSON.stringify({
        status: changed.length ? 'DATA_CHANGED' : 'TRACKED_DATA_PRESERVED',
        changedTables: changed,
      }),
    );
    return changed.length ? 1 : 0;
  } catch {
    console.error(
      'Upgrade preservation check failed. Check the explicit local URL, schema and baseline file. No database writes were performed.',
    );
    return 1;
  } finally {
    if (db) await db.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
