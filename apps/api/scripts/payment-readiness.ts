import { Client } from 'pg';
import { pathToFileURL } from 'node:url';

const requiredTables = ['PaymentProviderConfigurationVersion', 'ClientPaymentProvider', 'DeploymentPaymentAttempt', 'RazorpayPenaltyOrder', 'PaymentMandate', 'PaymentTransaction', 'PaymentProviderEvent', 'PaymentCollectionRequest', 'PaymentAutomationJob', 'PaymentOperationalAlert', 'WalletAutoRechargePolicy', 'WalletAutoRechargePreference', 'WalletAutoRecharge'];
const migrations = ['20261113180000_payment_configuration_versions', '20261114020000_payment_automation_jobs', '20261114030000_cashfree_merchant_binding', '20261114040000_payment_operations_evidence', '20261114120000_wallet_auto_recharge', '20261114133000_restore_commercial_number_sequences', '20261114140000_payment_failure_clock'];

/** Read-only inventory. Never resolve/seal secrets or repair uncertain historical ownership. */
export async function inspectPaymentReadiness(db: Pick<Client, 'query'>, environment: 'TEST' | 'PRODUCTION') {
  if (!['TEST', 'PRODUCTION'].includes(environment)) throw new Error('Choose TEST or PRODUCTION explicitly.');
  await db.query('BEGIN READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout = '15s'");
    const missingTables: string[] = [];
    for (const table of requiredTables) {
      const result = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public."${table}"`]);
      if (!result.rows[0].present) missingTables.push(table);
    }
    if (missingTables.length) return { status: 'BLOCKED', environment, missingTables, migrationRecorded: false, checks: {} };
    const history = await db.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present");
    let migrationRecorded = false;
    if (history.rows[0].present) {
      const result = await db.query('SELECT COUNT(DISTINCT migration_name)::int AS count FROM public._prisma_migrations WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [migrations]);
      migrationRecorded = result.rows[0].count === migrations.length;
    }
    const queries: Record<string, { sql: string; values?: string[] }> = {
      missingCommercialNumberSequences: { sql: `SELECT ((to_regclass('public.rider_commercial_offer_number_seq') IS NULL)::int + (to_regclass('public.rider_rental_agreement_number_seq') IS NULL)::int) AS count` },
      ambiguousActivePolicies: { sql: `SELECT COUNT(*)::int AS count FROM (SELECT "clientId" FROM "ClientPaymentProvider" WHERE environment=$1 AND status='ACTIVE' AND "validFrom" <= NOW() AND ("validUntil" IS NULL OR "validUntil" >= NOW()) GROUP BY "clientId" HAVING COUNT(*) > 1) policies`, values: [environment] },
      unsupportedClientMerchants: { sql: `SELECT COUNT(*)::int AS count FROM "ClientPaymentProvider" WHERE environment=$1 AND status='ACTIVE' AND provider NOT IN ('RAZORPAY','CASHFREE')`, values: [environment] },
      missingCurrentSnapshots: { sql: `SELECT COUNT(*)::int AS count FROM "ClientPaymentProvider" p LEFT JOIN "PaymentProviderConfigurationVersion" v ON v."providerConfigurationId"=p.id AND v.version=p."currentVersion" WHERE p.environment=$1 AND (v.id IS NULL OR v."keyId" IS DISTINCT FROM p."keyId" OR v."secretReference" IS DISTINCT FROM p."secretReference" OR v."merchantAccountId" IS DISTINCT FROM p."merchantAccountId")`, values: [environment] },
      unsealedSnapshots: { sql: `SELECT COUNT(*)::int AS count FROM "PaymentProviderConfigurationVersion" WHERE environment=$1 AND "credentialFingerprint" IS NULL`, values: [environment] },
      unboundDeploymentAttempts: { sql: `SELECT COUNT(*)::int AS count FROM "DeploymentPaymentAttempt" WHERE provider='RAZORPAY' AND "configurationVersionId" IS NULL AND status IN ('CREATING','CREATE_UNKNOWN','OPEN','PENDING','AUTHORIZED')` },
      unboundCollectionOrders: { sql: `SELECT COUNT(*)::int AS count FROM "RazorpayPenaltyOrder" o JOIN "PaymentCollectionRequest" c ON c.id=o."collectionId" WHERE o."configurationVersionId" IS NULL AND c.status IN ('CREATING','PENDING','UNKNOWN')` },
      unboundMandates: { sql: `SELECT COUNT(*)::int AS count FROM "PaymentMandate" WHERE provider='RAZORPAY' AND "configurationVersionId" IS NULL AND status IN ('CREATED','AUTHORIZATION_PENDING','ACTIVE','PAUSED','UNKNOWN')` },
      unboundDebits: { sql: `SELECT COUNT(*)::int AS count FROM "PaymentTransaction" WHERE provider='RAZORPAY' AND "configurationVersionId" IS NULL AND status IN ('CREATING','PENDING','UNKNOWN')` },
      unscopedWebhookEvents: { sql: `SELECT COUNT(*)::int AS count FROM "PaymentProviderEvent" WHERE provider='RAZORPAY' AND "clientId" IS NULL AND status IN ('RECEIVED','FAILED')` },
      cashfreeOrdersWithoutEnvironment: { sql: `SELECT COUNT(*)::int AS count FROM "PaymentCollectionRequest" WHERE provider='CASHFREE' AND status IN ('CREATING','PENDING','UNKNOWN') AND COALESCE("paymentSnapshot"->>'paymentEnvironment','') NOT IN ('SANDBOX','PRODUCTION')` },
    };
    const checks: Record<string, number> = {};
    for (const [name, query] of Object.entries(queries)) checks[name] = (await db.query(query.sql, query.values)).rows[0].count;
    return { status: migrationRecorded && Object.values(checks).every(count => count === 0) ? 'LOCAL_CHECKS_CLEAR' : 'REVIEW_REQUIRED', environment, missingTables, migrationRecorded, checks };
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main() {
  const connectionString = process.env.PAYMENT_READINESS_DATABASE_URL;
  const environment = process.env.PAYMENT_READINESS_ENVIRONMENT;
  if (!connectionString || !['TEST', 'PRODUCTION'].includes(environment ?? '')) throw new Error('Set PAYMENT_READINESS_DATABASE_URL and PAYMENT_READINESS_ENVIRONMENT explicitly.');
  const db = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    const result = await inspectPaymentReadiness(db, environment as 'TEST' | 'PRODUCTION');
    console.log(JSON.stringify({ ...result, scope: 'Configuration checks use the selected environment; pending-record checks cover the whole database.', gatewayConnectivityVerified: false, deviceAcceptanceVerified: false }, null, 2));
    if (result.status !== 'LOCAL_CHECKS_CLEAR') process.exitCode = 2;
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Payment readiness inspection failed. Check explicit connection settings, schema and read permissions. No credentials are printed.'); process.exitCode = 1; });
}
