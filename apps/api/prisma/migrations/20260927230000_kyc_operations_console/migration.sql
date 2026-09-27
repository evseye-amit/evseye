ALTER TABLE "KycWorkflowExecution"
  ADD COLUMN "reviewPriority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "reviewAssignedTo" TEXT,
  ADD COLUMN "reviewAssignedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "reviewResolvedAt" TIMESTAMP(3),
  ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "KycVerification" ADD COLUMN "recoveryVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "KycRecoveryRequest" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycRecoveryRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycRecoveryRequest_clientId_keyHash_key" ON "KycRecoveryRequest"("clientId", "keyHash");
CREATE INDEX "KycRecoveryRequest_verificationId_createdAt_idx"
  ON "KycRecoveryRequest"("verificationId", "createdAt");

CREATE INDEX "KycVerification_clientId_status_createdAt_idx"
  ON "KycVerification"("clientId", "status", "createdAt");
CREATE INDEX "KycVerification_verificationType_status_createdAt_idx"
  ON "KycVerification"("verificationType", "status", "createdAt");
CREATE INDEX "KycWorkflowExecution_clientId_status_updatedAt_idx"
  ON "KycWorkflowExecution"("clientId", "status", "updatedAt");

CREATE INDEX "KycWorkflowExecution_clientId_status_reviewPriority_reviewDueAt_idx"
  ON "KycWorkflowExecution"("clientId", "status", "reviewPriority", "reviewDueAt");
CREATE INDEX "KycWorkflowExecution_reviewAssignedTo_status_reviewDueAt_idx"
  ON "KycWorkflowExecution"("reviewAssignedTo", "status", "reviewDueAt");

UPDATE "KycWorkflowExecution" AS workflow
SET "reviewResolvedAt" = workflow."completedAt", "reviewVersion" = 1
WHERE workflow."completedAt" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "KycDecision" AS decision
    WHERE decision."workflowExecutionId" = workflow."id"
      AND decision."reasonCode" IN ('MANUAL_REVIEW_APPROVED', 'MANUAL_REVIEW_REJECTED'));

CREATE TABLE "KycOperationalAlert" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "clientId" TEXT,
  "providerId" TEXT,
  "capability" TEXT,
  "entityId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "acknowledgedBy" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycOperationalAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycOperationalAlert_dedupeKey_key" ON "KycOperationalAlert"("dedupeKey");
CREATE INDEX "KycOperationalAlert_clientId_status_lastSeenAt_idx"
  ON "KycOperationalAlert"("clientId", "status", "lastSeenAt");
CREATE INDEX "KycOperationalAlert_type_status_lastSeenAt_idx"
  ON "KycOperationalAlert"("type", "status", "lastSeenAt");
