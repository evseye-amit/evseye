ALTER TABLE "PaymentCollectionRequest" ADD COLUMN "configurationVersionId" TEXT;
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_configurationVersionId_clientId_fkey" FOREIGN KEY ("configurationVersionId", "clientId") REFERENCES "PaymentProviderConfigurationVersion"("id", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentMandate" ADD COLUMN "providerEnvironment" VARCHAR(16);
CREATE OR REPLACE FUNCTION protect_cashfree_collection_binding() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD."configurationVersionId" IS NOT NULL AND NEW."configurationVersionId" IS DISTINCT FROM OLD."configurationVersionId" THEN
  RAISE EXCEPTION 'Merchant binding is immutable';
 END IF;
 IF NEW."configurationVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PaymentProviderConfigurationVersion" v WHERE v.id=NEW."configurationVersionId" AND v."clientId"=NEW."clientId" AND v.provider=NEW.provider) THEN
  RAISE EXCEPTION 'Merchant provider mismatch';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER cashfree_collection_binding BEFORE INSERT OR UPDATE ON "PaymentCollectionRequest" FOR EACH ROW EXECUTE FUNCTION protect_cashfree_collection_binding();
