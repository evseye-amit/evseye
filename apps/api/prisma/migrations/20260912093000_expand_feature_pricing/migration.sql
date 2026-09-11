-- Expand the initial pricing scaffold into the platform-owned Feature Pricing catalogue.
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'FREE';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'TIERED';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'VOLUME';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'PER_USER';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'PER_VEHICLE';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'PER_FLEET';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'USAGE_BASED';
ALTER TYPE "PricingModel" ADD VALUE IF NOT EXISTS 'ONE_TIME';

ALTER TABLE "FeaturePricing"
  ADD COLUMN "pricingName" VARCHAR(150),
  ADD COLUMN "basePrice" DECIMAL(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN "setupFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "billingCycle" "BillingCycle",
  ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "FeaturePricing"
  RENAME COLUMN "minCharge" TO "minimumCharge";
ALTER TABLE "FeaturePricing"
  RENAME COLUMN "maxCharge" TO "maximumCharge";

ALTER TABLE "FeaturePricing"
  ALTER COLUMN "billingUnit" TYPE VARCHAR(50),
  ALTER COLUMN "unitPrice" TYPE DECIMAL(12,4),
  ALTER COLUMN "unitPrice" SET DEFAULT 0,
  ALTER COLUMN "costPrice" TYPE DECIMAL(12,4),
  ALTER COLUMN "costPrice" SET DEFAULT 0;

UPDATE "FeaturePricing" SET "costPrice" = 0 WHERE "costPrice" IS NULL;
ALTER TABLE "FeaturePricing" ALTER COLUMN "costPrice" SET NOT NULL;
