-- CreateEnum
CREATE TYPE "KycUsageRecognition" AS ENUM ('ON_REQUEST', 'ON_COMPLETION', 'ON_SUCCESS');

-- CreateEnum
CREATE TYPE "KycOveragePolicy" AS ENUM ('BLOCK', 'ALLOW_AND_CHARGE', 'ALLOW_WITH_WARNING');

-- CreateEnum
CREATE TYPE "FeatureConsumptionSource" AS ENUM ('INCLUDED', 'ADD_ON', 'UNLIMITED', 'OVERAGE');

ALTER TABLE "KycVerification" ADD COLUMN "validityDaysSnapshot" INTEGER,
  ADD COLUMN "reverificationRequiredSnapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "validUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KycClientPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "workflowDefinitionId" TEXT,
    "routingPolicyId" TEXT,
    "validityDays" INTEGER,
    "reverificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "usageRecognition" "KycUsageRecognition" NOT NULL DEFAULT 'ON_REQUEST',
    "overagePolicy" "KycOveragePolicy" NOT NULL DEFAULT 'BLOCK',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycClientPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageConsumption" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "source" "FeatureConsumptionSource" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "basePrice" DECIMAL(14,4),
    "discount" DECIMAL(14,4),
    "effectivePrice" DECIMAL(14,4),
    "currency" CHAR(3),
    "pricingReferenceId" TEXT,
    "policyId" TEXT,
    "recognition" "KycUsageRecognition" NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "FeatureUsageConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycClientPolicy_clientId_verificationType_status_effectiveF_idx" ON "KycClientPolicy"("clientId", "verificationType", "status", "effectiveFrom");

CREATE UNIQUE INDEX "KycClientPolicy_one_active_per_type" ON "KycClientPolicy"("clientId", "verificationType") WHERE "status" = 'ACTIVE';
ALTER TABLE "KycClientPolicy" ADD CONSTRAINT "KycClientPolicy_valid_dates" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE "KycClientPolicy" ADD CONSTRAINT "KycClientPolicy_validity_days" CHECK ("validityDays" IS NULL OR "validityDays" BETWEEN 1 AND 3650);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureUsageConsumption_verificationId_key" ON "FeatureUsageConsumption"("verificationId");

-- CreateIndex
CREATE INDEX "FeatureUsageConsumption_clientId_featureId_occurredAt_idx" ON "FeatureUsageConsumption"("clientId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageConsumption_subscriptionId_occurredAt_idx" ON "FeatureUsageConsumption"("subscriptionId", "occurredAt");

ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_positive_quantity" CHECK ("quantity" > 0);
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_nonnegative_prices" CHECK (
  ("basePrice" IS NULL OR "basePrice" >= 0) AND ("discount" IS NULL OR "discount" >= 0)
  AND ("effectivePrice" IS NULL OR "effectivePrice" >= 0));

-- AddForeignKey
ALTER TABLE "KycClientPolicy" ADD CONSTRAINT "KycClientPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
