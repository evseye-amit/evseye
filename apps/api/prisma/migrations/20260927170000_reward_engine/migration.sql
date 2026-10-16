CREATE TABLE "RewardProgram" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "totalBudget" DECIMAL(18,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "triggerType" VARCHAR(60) NOT NULL,
    "rewardType" VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    "rewardValue" DECIMAL(18,2) NOT NULL,
    "approvalMode" VARCHAR(30) NOT NULL DEFAULT 'MANUAL_APPROVAL',
    "expiryDays" INTEGER,
    "monthlyCountCap" INTEGER,
    "monthlyAmountCap" DECIMAL(18,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardClaim" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'APPROVAL_PENDING',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "calculatedAmount" DECIMAL(18,2) NOT NULL,
    "creditedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unrecoveredAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "creditedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardLot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardLotConsumption" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'SPEND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLotConsumption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RewardProgram_clientId_status_validFrom_validUntil_idx" ON "RewardProgram"("clientId", "status", "validFrom", "validUntil");

CREATE UNIQUE INDEX "RewardProgram_clientId_code_key" ON "RewardProgram"("clientId", "code");

CREATE UNIQUE INDEX "RewardProgram_clientId_id_key" ON "RewardProgram"("clientId", "id");

CREATE INDEX "RewardRule_clientId_triggerType_isActive_idx" ON "RewardRule"("clientId", "triggerType", "isActive");

CREATE UNIQUE INDEX "RewardRule_clientId_programId_code_key" ON "RewardRule"("clientId", "programId", "code");

CREATE UNIQUE INDEX "RewardRule_clientId_id_key" ON "RewardRule"("clientId", "id");

CREATE UNIQUE INDEX "RewardClaim_walletTransactionId_key" ON "RewardClaim"("walletTransactionId");

CREATE INDEX "RewardClaim_clientId_riderId_createdAt_idx" ON "RewardClaim"("clientId", "riderId", "createdAt");

CREATE INDEX "RewardClaim_clientId_status_createdAt_idx" ON "RewardClaim"("clientId", "status", "createdAt");

CREATE INDEX "RewardClaim_clientId_programId_status_idx" ON "RewardClaim"("clientId", "programId", "status");

CREATE UNIQUE INDEX "RewardClaim_clientId_ruleId_sourceType_sourceId_riderId_key" ON "RewardClaim"("clientId", "ruleId", "sourceType", "sourceId", "riderId");

CREATE UNIQUE INDEX "RewardClaim_clientId_id_key" ON "RewardClaim"("clientId", "id");

CREATE UNIQUE INDEX "RewardLot_claimId_key" ON "RewardLot"("claimId");

CREATE INDEX "RewardLot_clientId_riderId_status_expiresAt_idx" ON "RewardLot"("clientId", "riderId", "status", "expiresAt");

CREATE UNIQUE INDEX "RewardLot_clientId_id_key" ON "RewardLot"("clientId", "id");

CREATE UNIQUE INDEX "RewardLot_clientId_claimId_key" ON "RewardLot"("clientId", "claimId");

CREATE INDEX "RewardLotConsumption_clientId_transactionId_idx" ON "RewardLotConsumption"("clientId", "transactionId");

CREATE UNIQUE INDEX "RewardLotConsumption_lotId_transactionId_key" ON "RewardLotConsumption"("lotId", "transactionId");

CREATE INDEX "RewardEvent_clientId_claimId_createdAt_idx" ON "RewardEvent"("clientId", "claimId", "createdAt");

ALTER TABLE "RewardProgram" ADD CONSTRAINT "RewardProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_clientId_programId_fkey" FOREIGN KEY ("clientId", "programId") REFERENCES "RewardProgram"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_programId_fkey" FOREIGN KEY ("clientId", "programId") REFERENCES "RewardProgram"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_ruleId_fkey" FOREIGN KEY ("clientId", "ruleId") REFERENCES "RewardRule"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_walletTransactionId_fkey" FOREIGN KEY ("clientId", "walletTransactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_clientId_claimId_fkey" FOREIGN KEY ("clientId", "claimId") REFERENCES "RewardClaim"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardLotConsumption" ADD CONSTRAINT "RewardLotConsumption_clientId_lotId_fkey" FOREIGN KEY ("clientId", "lotId") REFERENCES "RewardLot"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardLotConsumption" ADD CONSTRAINT "RewardLotConsumption_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_clientId_claimId_fkey" FOREIGN KEY ("clientId", "claimId") REFERENCES "RewardClaim"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardProgram" ADD CONSTRAINT "RewardProgram_budget_check" CHECK ("totalBudget" IS NULL OR "totalBudget" >= 0);

ALTER TABLE "RewardProgram" ADD CONSTRAINT "RewardProgram_dates_check" CHECK ("validUntil" IS NULL OR "validUntil" >= "validFrom");

ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_value_check" CHECK ("rewardValue" > 0 AND ("expiryDays" IS NULL OR "expiryDays" > 0) AND ("monthlyCountCap" IS NULL OR "monthlyCountCap" > 0) AND ("monthlyAmountCap" IS NULL OR "monthlyAmountCap" > 0));

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_amount_check" CHECK ("calculatedAmount" > 0 AND "creditedAmount" >= 0 AND "unrecoveredAmount" >= 0);

ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_amount_check" CHECK ("originalAmount" > 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "originalAmount");

ALTER TABLE "RewardLotConsumption" ADD CONSTRAINT "RewardLotConsumption_amount_check" CHECK ("amount" > 0);

CREATE UNIQUE INDEX "RewardClaim_clientId_sourceType_sourceId_key" ON "RewardClaim"("clientId", "sourceType", "sourceId");
