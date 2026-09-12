CREATE TABLE "ClientFeature" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "source" VARCHAR(30) NOT NULL DEFAULT 'ADD_ON',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "includedQuantity" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "usageLimit" DECIMAL(14,2),
  "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "configuration" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClientFeature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFeature_subscriptionId_featureId_key"
  ON "ClientFeature"("subscriptionId", "featureId");
CREATE INDEX "ClientFeature_clientId_enabled_idx"
  ON "ClientFeature"("clientId", "enabled");
CREATE INDEX "ClientFeature_featureId_enabled_idx"
  ON "ClientFeature"("featureId", "enabled");

ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFeature"
  ADD CONSTRAINT "ClientFeature_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
