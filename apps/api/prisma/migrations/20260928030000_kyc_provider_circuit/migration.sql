CREATE TABLE "KycProviderCircuitState" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "verificationType" "KycVerificationType" NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "healthyProbes" INTEGER NOT NULL DEFAULT 0,
  "openUntil" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastProbeAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycProviderCircuitState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycProviderCircuitState_providerId_verificationType_key" ON "KycProviderCircuitState"("providerId", "verificationType");
CREATE INDEX "KycProviderCircuitState_state_openUntil_idx" ON "KycProviderCircuitState"("state", "openUntil");
