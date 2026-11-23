import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const migrations = [
  '20261123120000_notification_foundation',
  '20261123130000_notification_binding_dispatch',
  '20261123140000_notification_targeting',
  '20261123150000_notification_preferences',
  '20261123160000_notification_installations',
  '20261123170000_notification_topics',
  '20261123180000_notification_scheduling',
];
export async function notificationReadiness(db, environment) {
  const checks = [];
  const check = (name, severity, count) =>
    checks.push({ name, severity, count: Number(count) });
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout='10s'");
    await db.query("SET LOCAL lock_timeout='2s'");
    const applied = await db.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    check(
      'missing_notification_migrations',
      'blocker',
      migrations.filter(
        (name) => !applied.rows.some((r) => r.migration_name === name),
      ).length,
    );
    if (checks[0].count) return { environment, checks, status: 'BLOCKED' };
    const catalog = JSON.parse(
      readFileSync(
        new URL('../prisma/notification-catalog.json', import.meta.url),
        'utf8',
      ),
    );
    const codes = catalog.categories.map((c) => c.code);
    const categories = await db.query(
      'SELECT count(*) AS count FROM "NotificationCategory" WHERE code=ANY($1::text[])',
      [codes],
    );
    check(
      'missing_seed_categories',
      'blocker',
      codes.length - Number(categories.rows[0].count),
    );
    const bindings = await db.query(
      `SELECT
      count(*) FILTER (WHERE b."isActive" AND (NOT c."isActive" OR b.environment<>c.environment)) AS invalid,
      count(*) FILTER (WHERE b."isActive" AND c."isActive") AS active
      FROM "NotificationAppBinding" b JOIN "FirebaseProjectConfiguration" c ON c.id=b."firebaseConfigurationId"
      WHERE b.environment=$1`,
      [environment],
    );
    check('invalid_active_bindings', 'blocker', bindings.rows[0].invalid);
    check(
      'no_active_bindings',
      'blocker',
      Number(bindings.rows[0].active) === 0 ? 1 : 0,
    );
    const devices = await db.query(
      `SELECT count(*) AS count FROM "PushDevice" d
      LEFT JOIN "NotificationAppBinding" b ON b.id=d."notificationAppBindingId"
      WHERE d."isActive" AND (b.id IS NULL OR (b.environment=$1 AND NOT b."isActive"))`,
      [environment],
    );
    check(
      'unbound_or_disabled_binding_devices',
      'warning',
      devices.rows[0].count,
    );
    const queue = await db.query(`SELECT
      count(*) FILTER (WHERE status='WAITING_FOR_CONFIGURATION') AS configuration,
      count(*) FILTER (WHERE status IN ('QUEUED','PROCESSING') AND COALESCE("scheduledFor","createdAt")<now()-interval '15 minutes') AS overdue
      FROM "NotificationMessage"`);
    check(
      'messages_waiting_for_configuration_all_environments',
      'warning',
      queue.rows[0].configuration,
    );
    check(
      'messages_overdue_15_minutes_all_environments',
      'warning',
      queue.rows[0].overdue,
    );
    const deliveries = await db.query(`SELECT
      count(*) FILTER (WHERE status='PROCESSING' AND "leaseUntil"<now()) AS leases,
      count(*) FILTER (WHERE status IN ('PENDING','RETRY') AND "nextAttemptAt"<now()-interval '15 minutes') AS overdue
      FROM "PushDelivery"`);
    check(
      'expired_delivery_leases_all_environments',
      'warning',
      deliveries.rows[0].leases,
    );
    check(
      'overdue_deliveries_all_environments',
      'warning',
      deliveries.rows[0].overdue,
    );
    const topics = await db.query(
      `SELECT
      count(*) FILTER (WHERE s."leaseUntil"<now()) AS leases,
      count(*) FILTER (WHERE s."nextAttemptAt"<now()-interval '15 minutes') AS overdue,
      count(*) FILTER (WHERE NOT s.desired AND s.applied=false AND s."claimId" IS NULL AND s."leaseUntil" IS NULL
        AND s."createdAt"<now()-interval '30 days') AS retained
      FROM "NotificationTopicSubscription" s JOIN "NotificationAppBinding" b ON b.id=s."bindingId" WHERE b.environment=$1`,
      [environment],
    );
    check('expired_topic_leases', 'warning', topics.rows[0].leases);
    check('overdue_topic_operations', 'warning', topics.rows[0].overdue);
    check(
      'old_acknowledged_unsubscriptions_retained',
      'info',
      topics.rows[0].retained,
    );
    return {
      environment,
      checks,
      status: checks.some((c) => c.severity === 'blocker' && c.count > 0)
        ? 'BLOCKED'
        : 'DATABASE_CHECKS_PASSED_REQUIRES_ACCEPTANCE',
    };
  } finally {
    await db.query('ROLLBACK');
  }
}
export async function main() {
  const connectionString = process.env.NOTIFICATION_READINESS_DATABASE_URL;
  const environment = process.env.PUSH_ENVIRONMENT;
  if (!connectionString || !environment) {
    console.error(
      'Set explicit NOTIFICATION_READINESS_DATABASE_URL and PUSH_ENVIRONMENT. No default application database is used.',
    );
    return 1;
  }
  const db = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    const report = await notificationReadiness(db, environment);
    console.log(JSON.stringify(report, null, 2));
    return report.status === 'BLOCKED' ? 1 : 0;
  } catch (error) {
    // Never print connection URLs, credentials, tokens or raw SQL error details.
    console.error(
      JSON.stringify({
        status: 'BLOCKED',
        reason: 'READINESS_QUERY_FAILED',
        code: /^[A-Z0-9]{5}$/.test(error.code ?? '')
          ? error.code
          : 'UNAVAILABLE',
      }),
    );
    return 1;
  } finally {
    await db.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
