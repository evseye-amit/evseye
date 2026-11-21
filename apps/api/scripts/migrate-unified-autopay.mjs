import { Client } from 'pg';
import { pathToFileURL } from 'node:url';

/** Default dry-run; no provider access and no financial posting. Cursor is a wallet UUID. */
export async function migrateUnifiedAutoPay(db, { clientId, runId, apply = false, after = '', limit = 100 }) {
  if (!clientId || !runId || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('clientId, runId and limit 1..500 are required');
  const wallets = await db.query(`SELECT id, "riderId" FROM "RiderWallet" WHERE "clientId"=$1 AND currency='INR' AND id>$2 ORDER BY id LIMIT $3`, [clientId, after, limit]);
  const counts = {};
  for (const wallet of wallets.rows) {
    await db.query('BEGIN');
    try {
      if (apply) {
        await db.query('SELECT id FROM "Rider" WHERE id=$1 AND "clientId"=$2 FOR UPDATE', [wallet.riderId, clientId]);
        await db.query('SELECT id FROM "RiderWallet" WHERE id=$1 FOR UPDATE', [wallet.id]);
      }
      const { rows: [row] } = await db.query(`SELECT p."collectionMode", p."autoPayEnabled", p."autoSettleInvoiceFromWallet", f.enabled, f."consentRevision", f."actionRequired", m.status AS "mandateStatus", m."autoDebitEnabled", m.provider, m."expiresAt", m."maxAmount", m."providerCancelRequestedAt", c.revision, c."rechargeAmount", c.enabled AS "policyEnabled"
        FROM "RiderWallet" w LEFT JOIN "RiderPaymentProfile" p ON p."clientId"=w."clientId" AND p."riderId"=w."riderId"
        LEFT JOIN "WalletAutoRechargePreference" f ON f."walletId"=w.id
        LEFT JOIN "PaymentMandate" m ON m.id=f."mandateId" AND m."clientId"=w."clientId"
        LEFT JOIN "WalletAutoRechargePolicy" c ON c."clientId"=w."clientId" WHERE w.id=$1`, [wallet.id]);
      const pending = await db.query(`SELECT id FROM "PaymentTransaction" WHERE "clientId"=$1 AND "riderId"=$2 AND status IN ('CREATING','PENDING','UNKNOWN') LIMIT 1`, [clientId, wallet.riderId]);
      const cohort = row?.collectionMode === 'LEDGER_WALLET' ? 'ALREADY_MIGRATED'
        : pending.rowCount ? 'PENDING_LEGACY_COLLECTION'
        : !row?.enabled ? 'CONSENT_REQUIRED'
        : !row.policyEnabled || row.consentRevision !== row.revision ? 'POLICY_OR_CONSENT_CHANGED'
        : !row.autoPayEnabled || row.actionRequired || !row.autoDebitEnabled ? 'INCONSISTENT_OR_ACTION_REQUIRED'
        : row.provider !== 'RAZORPAY' || row.mandateStatus !== 'ACTIVE' || row.providerCancelRequestedAt || new Date(row.expiresAt).getTime() <= Date.now() + 25 * 3600000 + 300000 || Number(row.maxAmount) < Number(row.rechargeAmount) ? 'MANDATE_ACTION_REQUIRED' : 'ELIGIBLE';
      counts[cohort] = (counts[cohort] ?? 0) + 1;
      if (apply && cohort === 'ELIGIBLE') {
        await db.query(`UPDATE "RiderPaymentProfile" SET "collectionMode"='LEDGER_WALLET', "autoSettleInvoiceFromWallet"=true, "updatedAt"=NOW() WHERE "clientId"=$1 AND "riderId"=$2`, [clientId, wallet.riderId]);
        await db.query(`UPDATE "WalletAutoRechargePreference" SET revision=revision+1, "updatedAt"=NOW() WHERE "walletId"=$1`, [wallet.id]);
        await db.query(`INSERT INTO "AuditLog" ("clientId", action, "entityType", "entityId", "previousData", "newData") VALUES ($1,'UNIFIED_AUTOPAY_MIGRATED','Rider',$2,$3::jsonb,$4::jsonb)`, [clientId, wallet.riderId, JSON.stringify({ collectionMode: row.collectionMode, autoSettleInvoiceFromWallet: row.autoSettleInvoiceFromWallet }), JSON.stringify({ runId, collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true, preservedConsentRevision: row.consentRevision })]);
      }
      await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
  return { apply, runId, counts, scanned: wallets.rowCount, nextCursor: wallets.rows.at(-1)?.id ?? after, hasMore: wallets.rowCount === limit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { console.log(JSON.stringify(await migrateUnifiedAutoPay(db, { clientId: value('client'), runId: value('run'), after: value('after'), limit: Number(value('limit') ?? 100), apply: args.includes('--apply') }))); }
  finally { await db.end(); }
}
