ALTER TABLE "KycVerificationAttempt" ADD COLUMN "costSource" VARCHAR(40);
ALTER TABLE "KycProviderCapability" ADD COLUMN "billingRule" VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN';
UPDATE "KycVerificationAttempt" SET "costSource" = CASE WHEN "cost" IS NULL THEN 'UNKNOWN' ELSE 'PROVIDER_PRICING_CONFIG' END;

CREATE INDEX "KycVerificationAttempt_verificationId_reason_requestStartedAt_idx"
  ON "KycVerificationAttempt"("verificationId", "reason", "requestStartedAt");
CREATE INDEX "KycVerificationAttempt_requestStartedAt_providerId_idx"
  ON "KycVerificationAttempt"("requestStartedAt", "providerId");
CREATE INDEX "KycVerification_clientId_requestedAt_verificationType_idx"
  ON "KycVerification"("clientId", "requestedAt", "verificationType");
CREATE INDEX "FeatureUsageConsumption_clientId_occurredAt_idx"
  ON "FeatureUsageConsumption"("clientId", "occurredAt");

CREATE TABLE "KycProviderSlaPolicy" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "verificationType" "KycVerificationType",
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "availabilityTarget" DECIMAL(5,2),
  "technicalSuccessTarget" DECIMAL(5,2),
  "p95LatencyTargetMs" INTEGER,
  "timeoutRateTarget" DECIMAL(5,2),
  "minimumSampleSize" INTEGER NOT NULL DEFAULT 30,
  "contractReference" VARCHAR(150),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycProviderSlaPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KycProviderSlaPolicy_providerId_verificationType_effectiveFrom_effectiveUntil_idx"
  ON "KycProviderSlaPolicy"("providerId", "verificationType", "effectiveFrom", "effectiveUntil");
ALTER TABLE "KycProviderSlaPolicy" ADD CONSTRAINT "KycProviderSlaPolicy_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
