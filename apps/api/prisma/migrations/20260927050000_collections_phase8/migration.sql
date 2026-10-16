-- CreateTable
CREATE TABLE "CollectionPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPolicyVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "dunningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPayRetryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "promiseToPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "promiseHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumPromiseDays" INTEGER NOT NULL DEFAULT 14,
    "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "restrictionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumMessagesPerDay" INTEGER NOT NULL DEFAULT 1,
    "minimumMessageIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "communicationStartHour" INTEGER NOT NULL DEFAULT 8,
    "communicationEndHour" INTEGER NOT NULL DEFAULT 20,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPolicyStage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "daysFromDue" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionPolicyStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCollectionCase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "delinquencyState" TEXT NOT NULL,
    "totalOutstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overdueOutstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "oldestDueDate" DATE,
    "daysPastDue" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedById" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionType" TEXT,
    "activeRiderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderCollectionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCaseInvoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "promisedAmount" DECIMAL(14,2) NOT NULL,
    "baselinePaidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidSince" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "promiseDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeCaseId" TEXT,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "brokenAt" TIMESTAMP(3),

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCaseNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionWaiver" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "waiverType" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateFeePolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "feeType" TEXT NOT NULL DEFAULT 'NONE',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimumDaysPastDue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LateFeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDispute" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialRestriction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'COLLECTION_CASE',
    "sourceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECOMMENDED',
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvaluationQueue" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionEvaluationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionPolicy_clientId_status_idx" ON "CollectionPolicy"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicy_clientId_code_key" ON "CollectionPolicy"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicy_clientId_id_key" ON "CollectionPolicy"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionPolicyVersion_clientId_effectiveFrom_effectiveTo_idx" ON "CollectionPolicyVersion"("clientId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyVersion_policyId_version_key" ON "CollectionPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyVersion_clientId_id_key" ON "CollectionPolicyVersion"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionPolicyStage_policyVersionId_daysFromDue_idx" ON "CollectionPolicyStage"("policyVersionId", "daysFromDue");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyStage_policyVersionId_stageCode_key" ON "CollectionPolicyStage"("policyVersionId", "stageCode");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_caseNumber_key" ON "RiderCollectionCase"("caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_activeRiderId_key" ON "RiderCollectionCase"("activeRiderId");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_riderId_status_idx" ON "RiderCollectionCase"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_status_daysPastDue_idx" ON "RiderCollectionCase"("clientId", "status", "daysPastDue");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_assignedToId_status_idx" ON "RiderCollectionCase"("clientId", "assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_clientId_id_key" ON "RiderCollectionCase"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionCaseInvoice_clientId_invoiceId_idx" ON "CollectionCaseInvoice"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCaseInvoice_caseId_invoiceId_key" ON "CollectionCaseInvoice"("caseId", "invoiceId");

-- CreateIndex
CREATE INDEX "CollectionAction_clientId_status_scheduledAt_idx" ON "CollectionAction"("clientId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAction_clientId_idempotencyKey_key" ON "CollectionAction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PromiseToPay_activeCaseId_key" ON "PromiseToPay"("activeCaseId");

-- CreateIndex
CREATE INDEX "PromiseToPay_clientId_riderId_status_idx" ON "PromiseToPay"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "CollectionCaseNote_clientId_caseId_createdAt_idx" ON "CollectionCaseNote"("clientId", "caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_idempotencyKey_key" ON "CollectionTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CollectionTask_clientId_status_dueAt_idx" ON "CollectionTask"("clientId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CollectionWaiver_clientId_caseId_status_idx" ON "CollectionWaiver"("clientId", "caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LateFeePolicy_clientId_key" ON "LateFeePolicy"("clientId");

-- CreateIndex
CREATE INDEX "CollectionDispute_clientId_caseId_status_idx" ON "CollectionDispute"("clientId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CommercialRestriction_clientId_riderId_status_code_idx" ON "CommercialRestriction"("clientId", "riderId", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialRestriction_caseId_code_key" ON "CommercialRestriction"("caseId", "code");

-- CreateIndex
CREATE INDEX "CollectionEvent_clientId_caseId_createdAt_idx" ON "CollectionEvent"("clientId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionEvaluationQueue_requestedAt_idx" ON "CollectionEvaluationQueue"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEvaluationQueue_clientId_riderId_key" ON "CollectionEvaluationQueue"("clientId", "riderId");

-- AddForeignKey
ALTER TABLE "CollectionPolicyVersion" ADD CONSTRAINT "CollectionPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CollectionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPolicyStage" ADD CONSTRAINT "CollectionPolicyStage_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "CollectionPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCaseInvoice" ADD CONSTRAINT "CollectionCaseInvoice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCaseNote" ADD CONSTRAINT "CollectionCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionWaiver" ADD CONSTRAINT "CollectionWaiver_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDispute" ADD CONSTRAINT "CollectionDispute_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRestriction" ADD CONSTRAINT "CommercialRestriction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEvent" ADD CONSTRAINT "CollectionEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite references reject cross-client collection links at the database boundary.
ALTER TABLE "RiderCollectionCase" ADD CONSTRAINT "RiderCollectionCase_client_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "RiderCollectionCase" ADD CONSTRAINT "RiderCollectionCase_client_policy_fkey" FOREIGN KEY ("clientId", "policyVersionId") REFERENCES "CollectionPolicyVersion"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionPolicyVersion" ADD CONSTRAINT "CollectionPolicyVersion_client_policy_fkey" FOREIGN KEY ("clientId", "policyId") REFERENCES "CollectionPolicy"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionPolicyStage" ADD CONSTRAINT "CollectionPolicyStage_client_policy_fkey" FOREIGN KEY ("clientId", "policyVersionId") REFERENCES "CollectionPolicyVersion"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionCaseInvoice" ADD CONSTRAINT "CollectionCaseInvoice_client_invoice_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_client_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CommercialRestriction" ADD CONSTRAINT "CommercialRestriction_client_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionEvaluationQueue" ADD CONSTRAINT "CollectionEvaluationQueue_client_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "RiderCollectionCase" ADD CONSTRAINT "RiderCollectionCase_active_rider_matches" CHECK ("activeRiderId" IS NULL OR "activeRiderId" = "riderId");
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_positive_amount" CHECK ("promisedAmount" > 0);
CREATE UNIQUE INDEX "CollectionPolicy_one_active_per_client" ON "CollectionPolicy"("clientId") WHERE "status" = 'ACTIVE';

-- Invoice insert/payment/refund/overdue changes enqueue reevaluation in their own transaction.
CREATE FUNCTION collection_enqueue_invoice_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "CollectionEvaluationQueue" ("id", "clientId", "riderId", "requestedAt")
  VALUES (gen_random_uuid()::text, NEW."clientId", NEW."riderId", CURRENT_TIMESTAMP)
  ON CONFLICT ("clientId", "riderId") DO UPDATE SET "requestedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER collection_invoice_changed
AFTER INSERT OR UPDATE OF "outstandingAmount", "status", "dueDate" ON "RiderInvoice"
FOR EACH ROW EXECUTE FUNCTION collection_enqueue_invoice_change();

ALTER TABLE "CollectionCaseInvoice" ADD CONSTRAINT "CollectionCaseInvoice_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionCaseNote" ADD CONSTRAINT "CollectionCaseNote_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionWaiver" ADD CONSTRAINT "CollectionWaiver_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionDispute" ADD CONSTRAINT "CollectionDispute_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CommercialRestriction" ADD CONSTRAINT "CommercialRestriction_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "CollectionEvent" ADD CONSTRAINT "CollectionEvent_client_case_fkey" FOREIGN KEY ("clientId", "caseId") REFERENCES "RiderCollectionCase"("clientId", "id") ON DELETE RESTRICT;

-- Every collection timeline entry is mirrored into the existing audit log atomically.
CREATE FUNCTION collection_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "AuditLog" ("clientId", "actorId", "action", "entityType", "entityId", "newData")
  VALUES (NEW."clientId", NEW."actorId", NEW."eventType", 'RiderCollectionCase', NEW."caseId", NEW."details");
  RETURN NEW;
END;
$$;
CREATE TRIGGER collection_event_audit
AFTER INSERT ON "CollectionEvent"
FOR EACH ROW EXECUTE FUNCTION collection_audit_event();
