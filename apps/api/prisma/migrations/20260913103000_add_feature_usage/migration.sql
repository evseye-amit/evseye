CREATE TABLE "FeatureUsage" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "usageReference" VARCHAR(150),
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "usageTimestamp" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeatureUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeatureUsage_subscriptionId_featureId_usageTimestamp_idx"
  ON "FeatureUsage"("subscriptionId", "featureId", "usageTimestamp");
CREATE INDEX "FeatureUsage_clientId_usageTimestamp_idx"
  ON "FeatureUsage"("clientId", "usageTimestamp");

ALTER TABLE "FeatureUsage"
  ADD CONSTRAINT "FeatureUsage_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureUsage"
  ADD CONSTRAINT "FeatureUsage_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureUsage"
  ADD CONSTRAINT "FeatureUsage_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
