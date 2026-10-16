-- CreateEnum
CREATE TYPE "KycWorkflowStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'WAITING', 'RECONCILING', 'DECISION_PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'ACTION_REQUIRED', 'VERIFIED', 'FAILED', 'SKIPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycStepFailureBehavior" AS ENUM ('STOP_WORKFLOW', 'CONTINUE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "KycStepActionMode" AS ENUM ('AUTOMATIC', 'USER_ACTION', 'MANUAL_ACTION');

-- CreateEnum
CREATE TYPE "KycDecisionOutcome" AS ENUM ('PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED');

-- CreateTable
CREATE TABLE "KycWorkflowDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "expiryMinutes" INTEGER NOT NULL DEFAULT 43200,
    "matchThresholds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "failureBehavior" "KycStepFailureBehavior" NOT NULL DEFAULT 'STOP_WORKFLOW',
    "actionMode" "KycStepActionMode" NOT NULL DEFAULT 'USER_ACTION',
    "retryPolicy" JSONB,
    "conditionConfig" JSONB,
    "timeoutConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowExecution" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "status" "KycWorkflowStatus" NOT NULL DEFAULT 'CREATED',
    "currentStepId" TEXT,
    "previousWorkflowExecutionId" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowStepExecution" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowStepId" TEXT NOT NULL,
    "verificationId" TEXT,
    "status" "KycStepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDecisionRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workflowDefinitionId" TEXT,
    "priority" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "action" "KycDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycDecisionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDecision" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "decision" "KycDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "ruleId" TEXT,
    "summary" TEXT,
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycReconciliationResult" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceA" TEXT NOT NULL,
    "sourceB" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycWorkflowDefinition_clientId_isDefault_status_idx" ON "KycWorkflowDefinition"("clientId", "isDefault", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowDefinition_code_version_clientId_key" ON "KycWorkflowDefinition"("code", "version", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStep_workflowDefinitionId_code_key" ON "KycWorkflowStep"("workflowDefinitionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStep_workflowDefinitionId_sequence_key" ON "KycWorkflowStep"("workflowDefinitionId", "sequence");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_riderId_startedAt_idx" ON "KycWorkflowExecution"("clientId", "riderId", "startedAt");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_status_expiresAt_idx" ON "KycWorkflowExecution"("clientId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowExecution_clientId_idempotencyKey_key" ON "KycWorkflowExecution"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStepExecution_verificationId_key" ON "KycWorkflowStepExecution"("verificationId");

-- CreateIndex
CREATE INDEX "KycWorkflowStepExecution_workflowExecutionId_status_idx" ON "KycWorkflowStepExecution"("workflowExecutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStepExecution_workflowExecutionId_workflowStepId_key" ON "KycWorkflowStepExecution"("workflowExecutionId", "workflowStepId");

-- CreateIndex
CREATE INDEX "KycDecisionRule_workflowDefinitionId_isActive_priority_idx" ON "KycDecisionRule"("workflowDefinitionId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "KycDecisionRule_code_workflowDefinitionId_key" ON "KycDecisionRule"("code", "workflowDefinitionId");

-- CreateIndex
CREATE INDEX "KycDecision_workflowExecutionId_decidedAt_idx" ON "KycDecision"("workflowExecutionId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycReconciliationResult_workflowExecutionId_type_key" ON "KycReconciliationResult"("workflowExecutionId", "type");

-- AddForeignKey
ALTER TABLE "KycWorkflowStep" ADD CONSTRAINT "KycWorkflowStep_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowExecution" ADD CONSTRAINT "KycWorkflowExecution_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowExecution" ADD CONSTRAINT "KycWorkflowExecution_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "KycWorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecisionRule" ADD CONSTRAINT "KycDecisionRule_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecision" ADD CONSTRAINT "KycDecision_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecision" ADD CONSTRAINT "KycDecision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "KycDecisionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycReconciliationResult" ADD CONSTRAINT "KycReconciliationResult_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A single live journey per rider; terminal journeys remain as history.
CREATE UNIQUE INDEX "KycWorkflowExecution_one_active_rider" ON "KycWorkflowExecution"("clientId", "riderId")
WHERE "status" IN ('CREATED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'WAITING', 'RECONCILING', 'DECISION_PENDING');

-- PostgreSQL UNIQUE treats NULL client IDs as distinct; global definitions still need version uniqueness.
CREATE UNIQUE INDEX "KycWorkflowDefinition_global_version" ON "KycWorkflowDefinition"("code", "version") WHERE "clientId" IS NULL;

-- Executions pin a definition version. Once used, its steps and decision rules are immutable.
CREATE FUNCTION kyc_guard_used_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition_id TEXT;
BEGIN
    IF TG_TABLE_NAME = 'KycWorkflowDefinition' THEN
        definition_id := OLD."id";
    ELSIF TG_OP = 'INSERT' THEN
        definition_id := NEW."workflowDefinitionId";
    ELSE
        definition_id := OLD."workflowDefinitionId";
    END IF;
    IF definition_id IS NOT NULL AND EXISTS (SELECT 1 FROM "KycWorkflowExecution" WHERE "workflowDefinitionId" = definition_id) THEN
        RAISE EXCEPTION 'KYC_WORKFLOW_DEFINITION_VERSION_IN_USE' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'KycWorkflowDefinition' THEN
        IF NEW."workflowDefinitionId" IS DISTINCT FROM OLD."workflowDefinitionId"
           AND EXISTS (SELECT 1 FROM "KycWorkflowExecution" WHERE "workflowDefinitionId" = NEW."workflowDefinitionId") THEN
            RAISE EXCEPTION 'KYC_WORKFLOW_DEFINITION_VERSION_IN_USE' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER kyc_definition_immutable BEFORE UPDATE OR DELETE ON "KycWorkflowDefinition"
FOR EACH ROW EXECUTE FUNCTION kyc_guard_used_definition();
CREATE TRIGGER kyc_step_immutable BEFORE INSERT OR UPDATE OR DELETE ON "KycWorkflowStep"
FOR EACH ROW EXECUTE FUNCTION kyc_guard_used_definition();
CREATE TRIGGER kyc_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON "KycDecisionRule"
FOR EACH ROW EXECUTE FUNCTION kyc_guard_used_definition();
