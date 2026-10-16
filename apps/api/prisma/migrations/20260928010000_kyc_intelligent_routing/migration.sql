ALTER TABLE "KycRoutingDecision" ADD COLUMN "intelligentPolicyId" TEXT;
ALTER TABLE "KycRoutingDecision" ADD COLUMN "intelligentMode" TEXT;
ALTER TABLE "KycRoutingDecision" ADD COLUMN "intelligenceSnapshot" JSONB;

CREATE TABLE "KycIntelligentRoutingPolicy" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "clientId" TEXT,
  "verificationType" "KycVerificationType" NOT NULL,
  "environment" "KycProviderEnvironment" NOT NULL DEFAULT 'TEST',
  "mode" VARCHAR(20) NOT NULL DEFAULT 'STATIC',
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "weights" JSONB NOT NULL,
  "observationWindowMinutes" INTEGER NOT NULL DEFAULT 60,
  "minimumSampleSize" INTEGER NOT NULL DEFAULT 30,
  "maxSnapshotAgeMinutes" INTEGER NOT NULL DEFAULT 10,
  "latencyTargetMs" INTEGER NOT NULL DEFAULT 1000,
  "unknownCostBehavior" VARCHAR(20) NOT NULL DEFAULT 'NEUTRAL',
  "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
  "maxTechnicalFailurePercent" DECIMAL(5,2),
  "maxP95LatencyMs" INTEGER,
  "maxKnownCostPerVerification" DECIMAL(12,4),
  "sourceShadowPolicyId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycIntelligentRoutingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycIntelligentRoutingPolicy_rollout_check" CHECK ("rolloutPercent" BETWEEN 0 AND 100),
  CONSTRAINT "KycIntelligentRoutingPolicy_mode_check" CHECK ("mode" IN ('STATIC','RULE_BASED','SCORED','SHADOW')),
  CONSTRAINT "KycIntelligentRoutingPolicy_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
  CONSTRAINT "KycIntelligentRoutingPolicy_unknown_cost_check" CHECK ("unknownCostBehavior" IN ('NEUTRAL','EXCLUDE')),
  CONSTRAINT "KycIntelligentRoutingPolicy_window_check" CHECK ("observationWindowMinutes" BETWEEN 15 AND 10080),
  CONSTRAINT "KycIntelligentRoutingPolicy_samples_check" CHECK ("minimumSampleSize" >= 1),
  CONSTRAINT "KycIntelligentRoutingPolicy_freshness_check" CHECK ("maxSnapshotAgeMinutes" >= 1),
  CONSTRAINT "KycIntelligentRoutingPolicy_latency_target_check" CHECK ("latencyTargetMs" > 0),
  CONSTRAINT "KycIntelligentRoutingPolicy_failure_guardrail_check" CHECK ("maxTechnicalFailurePercent" IS NULL OR "maxTechnicalFailurePercent" BETWEEN 0 AND 100),
  CONSTRAINT "KycIntelligentRoutingPolicy_latency_guardrail_check" CHECK ("maxP95LatencyMs" IS NULL OR "maxP95LatencyMs" > 0),
  CONSTRAINT "KycIntelligentRoutingPolicy_cost_guardrail_check" CHECK ("maxKnownCostPerVerification" IS NULL OR "maxKnownCostPerVerification" >= 0)
);
CREATE UNIQUE INDEX "KycIntelligentRoutingPolicy_code_version_clientId_key"
  ON "KycIntelligentRoutingPolicy"("code", "version", "clientId");
CREATE UNIQUE INDEX "KycIntelligentRoutingPolicy_global_code_version_key"
  ON "KycIntelligentRoutingPolicy"("code", "version") WHERE "clientId" IS NULL;
CREATE INDEX "KycIntelligentRoutingPolicy_client_type_env_status_effective_idx"
  ON "KycIntelligentRoutingPolicy"("clientId", "verificationType", "environment", "status", "effectiveFrom");

CREATE TABLE "KycRoutingMetricSnapshot" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "verificationType" "KycVerificationType" NOT NULL,
  "windowMinutes" INTEGER NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "technicalSuccessRate" DECIMAL(6,5),
  "timeoutRate" DECIMAL(6,5),
  "p95LatencyMs" INTEGER,
  "knownUnitCost" DECIMAL(12,4),
  "currency" CHAR(3),
  "slaStatus" VARCHAR(30),
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycRoutingMetricSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycRoutingMetricSnapshot_providerId_verificationType_windowMinutes_key"
  ON "KycRoutingMetricSnapshot"("providerId", "verificationType", "windowMinutes");
CREATE INDEX "KycRoutingMetricSnapshot_verificationType_windowMinutes_generatedAt_idx"
  ON "KycRoutingMetricSnapshot"("verificationType", "windowMinutes", "generatedAt");

CREATE TABLE "KycIntelligentRoutingControl" (
  "scopeKey" VARCHAR(120) NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT true,
  "reason" VARCHAR(500) NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycIntelligentRoutingControl_pkey" PRIMARY KEY ("scopeKey")
);
INSERT INTO "KycIntelligentRoutingControl"("scopeKey", "disabled", "reason", "updatedAt")
  VALUES ('GLOBAL', true, 'Default-off production safety', CURRENT_TIMESTAMP);

CREATE TABLE "KycShadowDecision" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "actualProviderId" TEXT,
  "shadowProviderId" TEXT,
  "scoreSnapshot" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycShadowDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycShadowDecision_verificationId_key" ON "KycShadowDecision"("verificationId");
CREATE INDEX "KycShadowDecision_policyId_createdAt_idx" ON "KycShadowDecision"("policyId", "createdAt");
CREATE INDEX "KycShadowDecision_clientId_createdAt_idx" ON "KycShadowDecision"("clientId", "createdAt");
