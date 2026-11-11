import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const schemaBaseline = '20261101000400_schema_consolidated';
const nonSchemaBaseline = '20261101000500_non_schema_consolidated';
const consolidatedBaselines = [schemaBaseline, nonSchemaBaseline];

// These migrations were deployed before the migration history was consolidated.
// A database with every one applied already has the schema represented by the
// new baselines; replaying the new schema baseline would recreate existing
// PostgreSQL types and tables.
const legacyMigrations = [
  '20261027000000_schema_baseline',
  '20261027000100_non_schema_database_logic',
  '20261030231000_fix_freeze_preparation_photo_trigger',
  '20261031000200_client_onboarding_rejections',
  '20261031000300_client_subscription_single_open',
  '20261031000400_package_feature_effective_dates',
  '20261031000500_sms_delivery_tracking',
  '20261031062911_remove_unused_return_penalty_tables',
  '20261101000100_sms_provider_policy',
  '20261101000200_import_parent_jobs',
  '20261101000300_platform_import_scope',
];
const migrationsToCheck = [...legacyMigrations, ...consolidatedBaselines];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to deploy migrations.');

const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await db.connect();
let baselinesToAdopt = [];

try {
  const { rows: tableRows } = await db.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS exists`,
  );

  if (tableRows[0]?.exists) {
    const { rows: appliedRows } = await db.query(
      `SELECT migration_name
       FROM public."_prisma_migrations"
       WHERE migration_name = ANY($1::text[])
         AND finished_at IS NOT NULL
         AND rolled_back_at IS NULL`,
      [migrationsToCheck],
    );
    const applied = new Set(appliedRows.map((row) => row.migration_name));
    const missing = legacyMigrations.filter((name) => !applied.has(name));

    if (missing.length === 0) {
      baselinesToAdopt = consolidatedBaselines.filter((name) => !applied.has(name));
    } else if (!applied.has(schemaBaseline)) {
      const { rows: schemaRows } = await db.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typname = 'UserRole'
         ) AS exists`,
      );
      if (schemaRows[0]?.exists) {
        throw new Error(
          `Refusing to apply a fresh-schema baseline to an existing database with incomplete migration history. ` +
            `Unconfirmed legacy migrations: ${missing.join(', ')}. Reconcile the database history before deploying.`,
        );
      }
    }
  }
} finally {
  await db.end();
}

if (baselinesToAdopt.length > 0) {
  const prisma = './apps/api/node_modules/.bin/prisma';
  for (const migration of baselinesToAdopt) {
    execFileSync(
      prisma,
      ['migrate', 'resolve', '--applied', migration, '--config=apps/api/prisma.config.ts'],
      { stdio: 'inherit' },
    );
  }
  console.log('Adopted the consolidated baselines for a database with the complete legacy migration history.');
}

execFileSync('./apps/api/node_modules/.bin/prisma', [
  'migrate',
  'deploy',
  '--config=apps/api/prisma.config.ts',
], { stdio: 'inherit' });
