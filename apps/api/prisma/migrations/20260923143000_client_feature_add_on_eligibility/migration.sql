-- Keep add-on eligibility with the Feature catalog. Existing global add-on
-- records are preserved for audit, while their referenced Features become
-- available for future client-specific entitlements.
ALTER TABLE "Feature"
  ADD COLUMN IF NOT EXISTS "isAddOnEligible" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Feature"
SET "isAddOnEligible" = true
WHERE "id" IN (SELECT DISTINCT "featureId" FROM "FeatureAddOn");

CREATE TABLE "ClientFeature" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "source" "ClientFeatureSource" NOT NULL DEFAULT 'ADD_ON',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "includedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "usageLimit" DECIMAL(14,3),
  "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "configuration" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientFeature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientFeaturePricing" (
  "id" TEXT NOT NULL,
  "clientFeatureId" TEXT NOT NULL,
  "featurePricingId" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "listUnitPrice" DECIMAL(14,4) NOT NULL,
  "discountType" VARCHAR(20),
  "discountValue" DECIMAL(14,4),
  "finalUnitPrice" DECIMAL(14,4) NOT NULL,
  "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "reason" VARCHAR(500),
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientFeaturePricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFeature_subscriptionId_featureId_key"
  ON "ClientFeature"("subscriptionId", "featureId");
CREATE INDEX "ClientFeature_clientId_enabled_effectiveFrom_idx"
  ON "ClientFeature"("clientId", "enabled", "effectiveFrom");
CREATE INDEX "ClientFeature_featureId_idx" ON "ClientFeature"("featureId");
CREATE INDEX "ClientFeaturePricing_clientFeatureId_effectiveFrom_idx"
  ON "ClientFeaturePricing"("clientFeatureId", "effectiveFrom");
CREATE INDEX "ClientFeaturePricing_featurePricingId_idx"
  ON "ClientFeaturePricing"("featurePricingId");

ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFeaturePricing"
  ADD CONSTRAINT "ClientFeaturePricing_clientFeatureId_fkey"
  FOREIGN KEY ("clientFeatureId") REFERENCES "ClientFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFeaturePricing"
  ADD CONSTRAINT "ClientFeaturePricing_featurePricingId_fkey"
  FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
