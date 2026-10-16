-- CreateEnum
CREATE TYPE "KycRoutingStrategy" AS ENUM ('PRIORITY', 'FALLBACK', 'WEIGHTED', 'PARALLEL', 'HEDGED', 'LOWEST_COST', 'LOWEST_LATENCY', 'SMART');

-- CreateEnum
CREATE TYPE "KycArbitrationMode" AS ENUM ('FIRST_VERIFIED', 'FIRST_TERMINAL', 'MAJORITY', 'ALL_MUST_AGREE', 'MANUAL_REVIEW_ON_CONFLICT');

-- CreateEnum
CREATE TYPE "KycAttemptReason" AS ENUM ('PRIMARY', 'RETRY', 'FALLBACK', 'WEIGHTED_SELECTION', 'PARALLEL', 'HEDGE', 'HEALTH_FAILOVER');

-- AlterTable
ALTER TABLE "KycVerificationAttempt" ADD COLUMN     "isLateCompletion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reason" "KycAttemptReason" NOT NULL DEFAULT 'PRIMARY';

-- CreateTable
CREATE TABLE "KycRoutingPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT,
    "verificationType" "KycVerificationType" NOT NULL,
    "strategy" "KycRoutingStrategy" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "maxProvidersPerVerification" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "allowParallel" BOOLEAN NOT NULL DEFAULT false,
    "allowHedging" BOOLEAN NOT NULL DEFAULT false,
    "arbitrationMode" "KycArbitrationMode",
    "fallbackCategories" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRoutingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingProvider" (
    "id" TEXT NOT NULL,
    "routingPolicyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "weight" INTEGER,
    "hedgeDelayMs" INTEGER,
    "timeoutMs" INTEGER,
    "maxAttempts" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRoutingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingDecision" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "routingPolicyId" TEXT,
    "routingPolicyVersion" INTEGER NOT NULL,
    "strategy" "KycRoutingStrategy" NOT NULL,
    "selectedProviders" JSONB NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderConflict" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "resultStatus" "KycVerificationStatus" NOT NULL,
    "conflictType" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycProviderConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycRoutingPolicy_clientId_verificationType_status_isDefault_idx" ON "KycRoutingPolicy"("clientId", "verificationType", "status", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingPolicy_code_version_clientId_key" ON "KycRoutingPolicy"("code", "version", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingProvider_routingPolicyId_providerId_key" ON "KycRoutingProvider"("routingPolicyId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingProvider_routingPolicyId_priority_key" ON "KycRoutingProvider"("routingPolicyId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingDecision_verificationId_key" ON "KycRoutingDecision"("verificationId");

-- CreateIndex
CREATE INDEX "KycRoutingDecision_routingPolicyId_createdAt_idx" ON "KycRoutingDecision"("routingPolicyId", "createdAt");

-- CreateIndex
CREATE INDEX "KycProviderConflict_verificationId_conflictType_idx" ON "KycProviderConflict"("verificationId", "conflictType");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderConflict_verificationId_providerId_key" ON "KycProviderConflict"("verificationId", "providerId");

-- AddForeignKey
ALTER TABLE "KycRoutingProvider" ADD CONSTRAINT "KycRoutingProvider_routingPolicyId_fkey" FOREIGN KEY ("routingPolicyId") REFERENCES "KycRoutingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingProvider" ADD CONSTRAINT "KycRoutingProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingDecision" ADD CONSTRAINT "KycRoutingDecision_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingDecision" ADD CONSTRAINT "KycRoutingDecision_routingPolicyId_fkey" FOREIGN KEY ("routingPolicyId") REFERENCES "KycRoutingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderConflict" ADD CONSTRAINT "KycProviderConflict_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderConflict" ADD CONSTRAINT "KycProviderConflict_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "KycRoutingPolicy_global_version" ON "KycRoutingPolicy"("code", "version") WHERE "clientId" IS NULL;
ALTER TABLE "KycRoutingPolicy" ADD CONSTRAINT "KycRoutingPolicy_bounded_attempts" CHECK (
  "maxAttempts" BETWEEN 1 AND 5 AND "maxProvidersPerVerification" BETWEEN 1 AND 5
);
ALTER TABLE "KycRoutingProvider" ADD CONSTRAINT "KycRoutingProvider_valid_configuration" CHECK (
  "priority" > 0 AND ("weight" IS NULL OR "weight" > 0) AND
  ("hedgeDelayMs" IS NULL OR "hedgeDelayMs" >= 0) AND
  ("timeoutMs" IS NULL OR "timeoutMs" >= 1000) AND
  ("maxAttempts" IS NULL OR "maxAttempts" BETWEEN 1 AND 5)
);

CREATE FUNCTION kyc_guard_used_routing_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'KycRoutingPolicy' THEN
    policy_id := OLD."id";
  ELSIF TG_OP = 'INSERT' THEN
    policy_id := NEW."routingPolicyId";
  ELSE
    policy_id := OLD."routingPolicyId";
  END IF;
  IF EXISTS (SELECT 1 FROM "KycRoutingDecision" WHERE "routingPolicyId" = policy_id) THEN
    RAISE EXCEPTION 'KYC_ROUTING_POLICY_VERSION_IN_USE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'KycRoutingProvider' THEN
    IF NEW."routingPolicyId" IS DISTINCT FROM OLD."routingPolicyId" AND
       EXISTS (SELECT 1 FROM "KycRoutingDecision" WHERE "routingPolicyId" = NEW."routingPolicyId") THEN
      RAISE EXCEPTION 'KYC_ROUTING_POLICY_VERSION_IN_USE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyc_routing_policy_immutable BEFORE UPDATE OR DELETE ON "KycRoutingPolicy"
FOR EACH ROW EXECUTE FUNCTION kyc_guard_used_routing_policy();
CREATE TRIGGER kyc_routing_provider_immutable BEFORE INSERT OR UPDATE OR DELETE ON "KycRoutingProvider"
FOR EACH ROW EXECUTE FUNCTION kyc_guard_used_routing_policy();
