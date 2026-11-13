import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env.PAYMENT_CONFIGURATION_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
describe.skipIf(!url)('Payment configuration migration', () => {
  it('backfills only matching merchants and makes versions/bindings immutable transactionally', async () => {
    const db = new Client({ connectionString: url });
    await db.connect();
    const schema = `payment_test_${randomUUID().replaceAll('-', '')}`;
    try {
      await db.query('BEGIN');
      await db.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await db.query(`
        CREATE TABLE "ClientPaymentProvider" (id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, provider VARCHAR(32), environment VARCHAR(16), "merchantAccountId" VARCHAR(128), "keyId" VARCHAR(128), "secretReference" VARCHAR(512));
        CREATE TABLE "PaymentMandate" (id TEXT PRIMARY KEY, "clientId" TEXT, provider TEXT, "providerKeyId" TEXT);
        CREATE TABLE "PaymentTransaction" (id TEXT PRIMARY KEY, "clientId" TEXT, provider TEXT, "providerKeyId" TEXT);
        CREATE TABLE "DeploymentPaymentAttempt" (id TEXT PRIMARY KEY, "clientId" TEXT, provider TEXT, "providerKeyReference" TEXT, "providerEnvironment" TEXT);
        CREATE TABLE "PaymentCollectionRequest" (id TEXT PRIMARY KEY, "clientId" TEXT);
        CREATE TABLE "RazorpayPenaltyOrder" (id TEXT PRIMARY KEY, "collectionId" TEXT, "keyId" TEXT);
        CREATE TABLE "PaymentProviderEvent" (id TEXT PRIMARY KEY, "clientId" TEXT);
        INSERT INTO "ClientPaymentProvider" VALUES ('config-a','a','RAZORPAY','TEST',NULL,'key-a','env:A'),('config-b','b','RAZORPAY','TEST',NULL,'key-b','env:B');
        INSERT INTO "PaymentMandate" VALUES ('matching','a','RAZORPAY','key-a'),('foreign-key','a','RAZORPAY','key-b'),('unknown','a','RAZORPAY',NULL);
      `);
      const migration = readFileSync(new URL('../../prisma/migrations/20261113180000_payment_configuration_versions/migration.sql', import.meta.url), 'utf8');
      await db.query(migration);
      const rows = (await db.query('SELECT id, "configurationVersionId" FROM "PaymentMandate" ORDER BY id')).rows;
      expect(rows).toEqual([
        { id: 'foreign-key', configurationVersionId: null },
        { id: 'matching', configurationVersionId: 'initial:config-a' },
        { id: 'unknown', configurationVersionId: null },
      ]);
      async function rejected(sql: string, message: string) {
        await db.query('SAVEPOINT invalid_write');
        await expect(db.query(sql)).rejects.toThrow(message);
        await db.query('ROLLBACK TO SAVEPOINT invalid_write');
      }
      await rejected(`UPDATE "PaymentProviderConfigurationVersion" SET "keyId"='changed' WHERE id='initial:config-a'`, 'immutable');
      await rejected(`DELETE FROM "PaymentProviderConfigurationVersion" WHERE id='initial:config-a'`, 'cannot be deleted');
      await rejected(`UPDATE "PaymentMandate" SET "configurationVersionId"='initial:config-b' WHERE id='matching'`, 'immutable');
      await rejected(`UPDATE "PaymentMandate" SET "configurationVersionId"='initial:config-b' WHERE id='unknown'`, 'foreign key');
      await db.query(`UPDATE "PaymentProviderConfigurationVersion" SET "credentialFingerprint"='sealed' WHERE id='initial:config-a'`);
      await rejected(`UPDATE "PaymentProviderConfigurationVersion" SET "credentialFingerprint"='changed' WHERE id='initial:config-a'`, 'immutable');
      await db.query(`INSERT INTO "PaymentCollectionRequest" VALUES ('collection-a','a')`);
      await rejected(`INSERT INTO "RazorpayPenaltyOrder" VALUES ('order-a','collection-a','key-a','initial:config-b')`, 'merchant mismatch');
    } finally {
      // All fixtures and schema changes are rolled back, including on assertion failure.
      await db.query('ROLLBACK');
      await db.end();
    }
  });
});
