import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to check workflow integrity.');

const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await db.connect();
try {
  const { rows } = await db.query(`
    SELECT s.id AS "subscriptionId", s."clientId", s."packageRevisionId",
           p.id AS "workflowId", p.version AS "workflowVersion", p."packageRevisionId" AS "workflowPackageRevisionId"
    FROM "ClientSubscription" s
    LEFT JOIN LATERAL (
      SELECT id, version, "packageRevisionId"
      FROM "ClientWorkflowRevision"
      WHERE "subscriptionId" = s.id AND "publishedAt" IS NOT NULL
      ORDER BY version DESC LIMIT 1
    ) p ON true
    WHERE s.status = 'ACTIVE'
      AND (p.id IS NULL OR p."packageRevisionId" IS DISTINCT FROM s."packageRevisionId")
    ORDER BY s."clientId", s.id
  `);
  if (rows.length) {
    console.error(JSON.stringify({ ok: false, staleOrMissing: rows }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, checked: 'ACTIVE subscriptions', staleOrMissing: [] }));
  }
} finally {
  await db.end();
}
