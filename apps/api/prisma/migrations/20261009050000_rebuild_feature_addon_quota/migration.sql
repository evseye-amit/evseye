-- Development cleanup: remove the unused seeded catalogue and any test purchases.
-- Package allowance lots and other feature history are retained.
DELETE FROM "FeatureUsageConsumption" WHERE "source" = 'ADD_ON';
DELETE FROM "FeatureUsageLedger" WHERE "sourceType" = 'FEATURE_ADDON';
DELETE FROM "FeatureCreditLot" WHERE "sourceType" = 'FEATURE_ADDON';
DELETE FROM "ClientFeatureAddOnPurchase";
DELETE FROM "PackageFeatureAddOn";
DELETE FROM "FeatureAddOn";

ALTER TABLE "FeatureAddOn" ADD COLUMN "validityMonths" INTEGER;
ALTER TABLE "ClientFeatureAddOnPurchase" ADD COLUMN "activationReference" VARCHAR(120);
ALTER TABLE "ClientFeatureAddOnPurchase" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt"::TIMESTAMPTZ(3);
ALTER TABLE "FeatureCreditLot" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt"::TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "ClientFeatureAddOnPurchase_clientId_activationReference_key" ON "ClientFeatureAddOnPurchase"("clientId", "activationReference");
