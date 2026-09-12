CREATE TABLE "ClientFeaturePricing" (
  "id" TEXT NOT NULL,
  "clientFeatureId" TEXT NOT NULL,
  "featurePricingId" TEXT NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
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

CREATE INDEX "ClientFeaturePricing_clientFeatureId_effectiveFrom_idx"
  ON "ClientFeaturePricing"("clientFeatureId", "effectiveFrom");
CREATE INDEX "ClientFeaturePricing_featurePricingId_effectiveFrom_idx"
  ON "ClientFeaturePricing"("featurePricingId", "effectiveFrom");

ALTER TABLE "ClientFeaturePricing"
  ADD CONSTRAINT "ClientFeaturePricing_clientFeatureId_fkey"
  FOREIGN KEY ("clientFeatureId") REFERENCES "ClientFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFeaturePricing"
  ADD CONSTRAINT "ClientFeaturePricing_featurePricingId_fkey"
  FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
