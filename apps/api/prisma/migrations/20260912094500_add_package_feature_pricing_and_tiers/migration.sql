-- Package-specific Feature configuration, pricing overrides, and tiered Feature Pricing.
ALTER TABLE "PackageFeature"
  ALTER COLUMN "includedQuantity" TYPE BIGINT,
  ALTER COLUMN "usageLimit" TYPE BIGINT,
  ADD COLUMN "configuration" JSONB,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PackageFeaturePricing" (
  "id" TEXT NOT NULL,
  "packageFeatureId" TEXT NOT NULL,
  "featurePricingId" TEXT,
  "pricingModel" "PricingModel",
  "includedQuantity" BIGINT NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,4),
  "minimumCharge" DECIMAL(12,2),
  "maximumCharge" DECIMAL(12,2),
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackageFeaturePricing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeaturePricingTier" (
  "id" TEXT NOT NULL,
  "featurePricingId" TEXT NOT NULL,
  "tierOrder" INTEGER NOT NULL,
  "fromQuantity" BIGINT NOT NULL,
  "toQuantity" BIGINT,
  "unitPrice" DECIMAL(12,4) NOT NULL,
  "costPrice" DECIMAL(12,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeaturePricingTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeaturePricingTier_featurePricingId_tierOrder_key"
  ON "FeaturePricingTier"("featurePricingId", "tierOrder");
CREATE INDEX "PackageFeaturePricing_packageFeatureId_isActive_effectiveFrom_idx"
  ON "PackageFeaturePricing"("packageFeatureId", "isActive", "effectiveFrom");
CREATE INDEX "PackageFeaturePricing_featurePricingId_idx"
  ON "PackageFeaturePricing"("featurePricingId");

ALTER TABLE "PackageFeaturePricing"
  ADD CONSTRAINT "PackageFeaturePricing_packageFeatureId_fkey"
  FOREIGN KEY ("packageFeatureId") REFERENCES "PackageFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageFeaturePricing"
  ADD CONSTRAINT "PackageFeaturePricing_featurePricingId_fkey"
  FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeaturePricingTier"
  ADD CONSTRAINT "FeaturePricingTier_featurePricingId_fkey"
  FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
