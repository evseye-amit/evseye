import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectPaymentReadiness } from './payment-readiness.ts';

/** Read-only checks using the candidate API task's environment and credentials. */
export async function checkPaymentMerchants(
  rows,
  env,
  request = fetch,
  now = new Date(),
) {
  const intended = (env.PAYMENT_READINESS_CLIENT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const clients = new Set(
    intended.length
      ? intended
      : rows
          .filter((row) => row.status === 'ACTIVE')
          .map((row) => row.clientId),
  );
  if (!clients.size) throw new Error('PAYMENT_MERCHANT_CONFIGURATION_REQUIRED');
  let verified = 0;
  for (const clientId of clients) {
    const active = rows.filter(
      (row) =>
        row.clientId === clientId &&
        row.status === 'ACTIVE' &&
        new Date(row.validFrom) <= now &&
        (!row.validUntil || new Date(row.validUntil) >= now),
    );
    if (active.length !== 1) throw new Error('PAYMENT_POLICY_UNAVAILABLE');
    const merchant = active[0];
    if (!['RAZORPAY', 'CASHFREE'].includes(merchant.provider))
      throw new Error('PAYMENT_CAPABILITY_UNAVAILABLE');
    if (!merchant.secretReference?.match(/^env:[A-Z][A-Z0-9_]{2,127}$/))
      throw new Error('PAYMENT_SECRET_UNAVAILABLE');
    let secret;
    try {
      secret = JSON.parse(env[merchant.secretReference.slice(4)] ?? '{}');
    } catch {
      throw new Error('PAYMENT_SECRET_UNAVAILABLE');
    }
    if (
      typeof secret.keySecret !== 'string' ||
      !secret.keySecret ||
      typeof secret.webhookSecret !== 'string' ||
      !secret.webhookSecret
    )
      throw new Error('PAYMENT_SECRET_UNAVAILABLE');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          merchant.keyId,
          secret.keySecret,
          secret.webhookSecret,
        ]),
      )
      .digest('hex');
    if (fingerprint !== merchant.credentialFingerprint)
      throw new Error('PAYMENT_SECRET_VERSION_CHANGED');
    const razorpay = merchant.provider === 'RAZORPAY';
    if (
      razorpay &&
      !merchant.keyId.startsWith(
        merchant.environment === 'TEST' ? 'rzp_test_' : 'rzp_live_',
      )
    )
      throw new Error('PAYMENT_KEY_ENVIRONMENT_MISMATCH');
    const url = razorpay
      ? 'https://api.razorpay.com/v1/orders?count=1'
      : `${merchant.environment === 'TEST' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com'}/pg/orders/EVS_READY_${randomUUID().replaceAll('-', '')}`;
    const headers = razorpay
      ? {
          Authorization: `Basic ${Buffer.from(`${merchant.keyId}:${secret.keySecret}`).toString('base64')}`,
        }
      : {
          'x-client-id': merchant.keyId,
          'x-client-secret': secret.keySecret,
          'x-api-version': '2025-01-01',
        };
    const response = await request(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    // The random Cashfree order is intentionally absent: require its precise,
    // authenticated not-found response, never accept arbitrary 4xx/5xx errors.
    const body = await response.json();
    if (
      razorpay
        ? response.status !== 200 || !Array.isArray(body.items)
        : response.status !== 404 || body.code !== 'order_not_found'
    )
      throw new Error('PAYMENT_GATEWAY_AUTH_CHECK_FAILED');
    verified++;
  }
  return {
    merchantsVerified: verified,
    credentialConnectivityVerified: true,
    livePaymentAcceptanceVerified: false,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const environment = process.env.RAZORPAY_ENVIRONMENT ?? 'TEST';
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    const readiness = await inspectPaymentReadiness(db, environment);
    console.log(JSON.stringify({ stage: 'payment-readiness', ...readiness }));
    if (readiness.status !== 'LOCAL_CHECKS_CLEAR')
      throw new Error('PAYMENT_READINESS_BLOCKED');
    const { rows } = await db.query(
      `SELECT p."clientId", p.provider, p.environment, p.status, p."validFrom", p."validUntil",
      p."keyId", p."secretReference", v."credentialFingerprint"
      FROM "ClientPaymentProvider" p JOIN "PaymentProviderConfigurationVersion" v
      ON v."providerConfigurationId"=p.id AND v.version=p."currentVersion" WHERE p.environment=$1`,
      [environment],
    );
    const result = await checkPaymentMerchants(rows, process.env);
    console.log(
      JSON.stringify({
        stage: 'payment-merchant-check',
        environment,
        ...result,
      }),
    );
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      'Payment deployment gate failed. Check readiness counts, merchant policy and versioned API-task credentials. Provider payloads and secrets are not printed.',
    );
    process.exitCode = 1;
  });
}
