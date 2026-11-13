-- Additive schema. Legacy records are deliberately not guessed onto the current merchant.
ALTER TABLE "ClientPaymentProvider" ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "ClientPaymentProvider_id_clientId_key" ON "ClientPaymentProvider"("id", "clientId");
CREATE TABLE "PaymentProviderConfigurationVersion" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "providerConfigurationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "provider" VARCHAR(32) NOT NULL,
  "environment" VARCHAR(16) NOT NULL,
  "merchantAccountId" VARCHAR(128),
  "keyId" VARCHAR(128) NOT NULL,
  "secretReference" VARCHAR(512) NOT NULL,
  "credentialFingerprint" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProviderConfigurationVersion_parent_fkey" FOREIGN KEY ("providerConfigurationId", "clientId") REFERENCES "ClientPaymentProvider"("id", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentProviderConfigurationVersion_parent_version_key" ON "PaymentProviderConfigurationVersion"("providerConfigurationId", "version");
CREATE UNIQUE INDEX "PaymentProviderConfigurationVersion_clientId_id_key" ON "PaymentProviderConfigurationVersion"("clientId", "id");
CREATE INDEX "PaymentProviderConfigurationVersion_merchant_idx" ON "PaymentProviderConfigurationVersion"("clientId", "provider", "environment", "keyId");
-- Deterministic initial snapshot; no secrets are copied into the database.
INSERT INTO "PaymentProviderConfigurationVersion" ("id", "clientId", "providerConfigurationId", "version", "provider", "environment", "merchantAccountId", "keyId", "secretReference")
SELECT 'initial:' || "id", "clientId", "id", 1, "provider", "environment", "merchantAccountId", "keyId", "secretReference" FROM "ClientPaymentProvider";

ALTER TABLE "PaymentMandate" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "DeploymentPaymentAttempt" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "RazorpayPenaltyOrder" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "PaymentMandate" ADD CONSTRAINT "PaymentMandate_configurationVersion_fkey" FOREIGN KEY ("clientId", "configurationVersionId") REFERENCES "PaymentProviderConfigurationVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_configurationVersion_fkey" FOREIGN KEY ("clientId", "configurationVersionId") REFERENCES "PaymentProviderConfigurationVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeploymentPaymentAttempt" ADD CONSTRAINT "DeploymentPaymentAttempt_configurationVersion_fkey" FOREIGN KEY ("clientId", "configurationVersionId") REFERENCES "PaymentProviderConfigurationVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_configurationVersion_fkey" FOREIGN KEY ("clientId", "configurationVersionId") REFERENCES "PaymentProviderConfigurationVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RazorpayPenaltyOrder" ADD CONSTRAINT "RazorpayPenaltyOrder_configurationVersion_fkey" FOREIGN KEY ("configurationVersionId") REFERENCES "PaymentProviderConfigurationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A version may be sealed once after migration; all identity/reference fields are immutable.
CREATE FUNCTION protect_payment_configuration_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment configuration versions cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'credentialFingerprint') IS DISTINCT FROM (to_jsonb(OLD) - 'credentialFingerprint')
     OR (OLD."credentialFingerprint" IS NOT NULL AND NEW."credentialFingerprint" IS DISTINCT FROM OLD."credentialFingerprint") THEN
    RAISE EXCEPTION 'Payment configuration versions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_configuration_version_immutable BEFORE UPDATE OR DELETE ON "PaymentProviderConfigurationVersion" FOR EACH ROW EXECUTE FUNCTION protect_payment_configuration_version();

CREATE FUNCTION protect_payment_version_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."configurationVersionId" IS NOT NULL AND NEW."configurationVersionId" IS DISTINCT FROM OLD."configurationVersionId" THEN
    RAISE EXCEPTION 'Payment configuration binding is immutable';
  END IF;
  IF TG_TABLE_NAME = 'RazorpayPenaltyOrder' AND NEW."configurationVersionId" IS NOT NULL THEN
    SELECT "clientId" INTO owner FROM "PaymentCollectionRequest" WHERE "id" = NEW."collectionId";
    IF NOT EXISTS (SELECT 1 FROM "PaymentProviderConfigurationVersion" WHERE "id" = NEW."configurationVersionId" AND "clientId" = owner AND "provider" = 'RAZORPAY') THEN
      RAISE EXCEPTION 'Payment configuration merchant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mandate_version_binding BEFORE INSERT OR UPDATE ON "PaymentMandate" FOR EACH ROW EXECUTE FUNCTION protect_payment_version_binding();
CREATE TRIGGER transaction_version_binding BEFORE INSERT OR UPDATE ON "PaymentTransaction" FOR EACH ROW EXECUTE FUNCTION protect_payment_version_binding();
CREATE TRIGGER deployment_version_binding BEFORE INSERT OR UPDATE ON "DeploymentPaymentAttempt" FOR EACH ROW EXECUTE FUNCTION protect_payment_version_binding();
CREATE TRIGGER collection_version_binding BEFORE INSERT OR UPDATE ON "RazorpayPenaltyOrder" FOR EACH ROW EXECUTE FUNCTION protect_payment_version_binding();
CREATE TRIGGER webhook_version_binding BEFORE INSERT OR UPDATE ON "PaymentProviderEvent" FOR EACH ROW EXECUTE FUNCTION protect_payment_version_binding();

-- Conservative key-based backfill. Ambiguous/missing/mismatched keys stay NULL for review.
UPDATE "PaymentMandate" m SET "configurationVersionId" = v.id FROM (
 SELECT m.id AS record_id, min(v.id) AS id FROM "PaymentMandate" m
 JOIN "PaymentProviderConfigurationVersion" v ON v."clientId" = m."clientId" AND v.provider = m.provider AND v."keyId" = m."providerKeyId"
 WHERE m.provider = 'RAZORPAY' GROUP BY m.id HAVING count(*) = 1
) v WHERE m.id = v.record_id;
UPDATE "PaymentTransaction" t SET "configurationVersionId" = v.id FROM (
 SELECT t.id AS record_id, min(v.id) AS id FROM "PaymentTransaction" t
 JOIN "PaymentProviderConfigurationVersion" v ON v."clientId" = t."clientId" AND v.provider = t.provider AND v."keyId" = t."providerKeyId"
 WHERE t.provider = 'RAZORPAY' GROUP BY t.id HAVING count(*) = 1
) v WHERE t.id = v.record_id;
UPDATE "DeploymentPaymentAttempt" a SET "configurationVersionId" = v.id FROM (
 SELECT a.id AS record_id, min(v.id) AS id FROM "DeploymentPaymentAttempt" a
 JOIN "PaymentProviderConfigurationVersion" v ON v."clientId" = a."clientId" AND v.provider = a.provider AND v."keyId" = a."providerKeyReference"
 AND (a."providerEnvironment" IS NULL OR a."providerEnvironment" = 'LEGACY' OR a."providerEnvironment" = v.environment)
 WHERE a.provider = 'RAZORPAY' GROUP BY a.id HAVING count(*) = 1
) v WHERE a.id = v.record_id;
UPDATE "RazorpayPenaltyOrder" o SET "configurationVersionId" = v.id FROM (
 SELECT o.id AS record_id, min(v.id) AS id FROM "RazorpayPenaltyOrder" o
 JOIN "PaymentCollectionRequest" c ON c.id = o."collectionId"
 JOIN "PaymentProviderConfigurationVersion" v ON v."clientId" = c."clientId" AND v.provider = 'RAZORPAY' AND v."keyId" = o."keyId"
 GROUP BY o.id HAVING count(*) = 1
) v WHERE o.id = v.record_id;
