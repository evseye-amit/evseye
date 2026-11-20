-- CreateTable
CREATE TABLE "WalletAutoRechargePolicy" (
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold" DECIMAL(14,2) NOT NULL DEFAULT 550,
    "rechargeAmount" DECIMAL(14,2) NOT NULL DEFAULT 750,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAutoRechargePolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "WalletAutoRechargePreference" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "consentRevision" INTEGER NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "nextEligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluationRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAutoRechargePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletAutoRecharge" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "threshold" DECIMAL(14,2) NOT NULL,
    "balanceAtTrigger" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(32) NOT NULL DEFAULT 'CREATING',
    "failureCode" VARCHAR(80),
    "configurationVersionId" TEXT,
    "providerKeyId" TEXT,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "orderClaimedAt" TIMESTAMP(3),
    "debitClaimedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAutoRecharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletAutoRechargePreference_walletId_key" ON "WalletAutoRechargePreference"("walletId");

-- CreateIndex
CREATE INDEX "WalletAutoRechargePreference_checkedAt_idx" ON "WalletAutoRechargePreference"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAutoRechargePreference_clientId_riderId_key" ON "WalletAutoRechargePreference"("clientId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAutoRechargePreference_clientId_riderId_walletId_key" ON "WalletAutoRechargePreference"("clientId", "riderId", "walletId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAutoRecharge_providerOrderId_key" ON "WalletAutoRecharge"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAutoRecharge_providerPaymentId_key" ON "WalletAutoRecharge"("providerPaymentId");

-- CreateIndex
CREATE INDEX "WalletAutoRecharge_status_checkedAt_idx" ON "WalletAutoRecharge"("status", "checkedAt");

-- CreateIndex
CREATE INDEX "WalletAutoRecharge_clientId_riderId_createdAt_idx" ON "WalletAutoRecharge"("clientId", "riderId", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletAutoRechargePolicy" ADD CONSTRAINT "WalletAutoRechargePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRechargePreference" ADD CONSTRAINT "WalletAutoRechargePreference_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRechargePreference" ADD CONSTRAINT "WalletAutoRechargePreference_clientId_riderId_walletId_fkey" FOREIGN KEY ("clientId", "riderId", "walletId") REFERENCES "RiderWallet"("clientId", "riderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRechargePreference" ADD CONSTRAINT "WalletAutoRechargePreference_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRecharge" ADD CONSTRAINT "WalletAutoRecharge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRecharge" ADD CONSTRAINT "WalletAutoRecharge_clientId_riderId_walletId_fkey" FOREIGN KEY ("clientId", "riderId", "walletId") REFERENCES "RiderWallet"("clientId", "riderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAutoRecharge" ADD CONSTRAINT "WalletAutoRecharge_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Includes ambiguous and review states: a timeout must never permit a second debit.
CREATE UNIQUE INDEX "WalletAutoRecharge_one_open_per_wallet" ON "WalletAutoRecharge" ("walletId")
WHERE "status" IN ('CREATING', 'PENDING', 'UNKNOWN', 'REVIEW_REQUIRED');
ALTER TABLE "WalletAutoRechargePolicy" ADD CONSTRAINT "WalletAutoRechargePolicy_amounts_check"
CHECK ("threshold" > 0 AND "threshold" <= 5000 AND "rechargeAmount" BETWEEN 500 AND 5000);
ALTER TABLE "WalletAutoRecharge" ADD CONSTRAINT "WalletAutoRecharge_amount_check" CHECK ("amount" BETWEEN 500 AND 5000 AND "currency" = 'INR');
ALTER TABLE "WalletAutoRecharge" ADD CONSTRAINT "WalletAutoRecharge_status_check" CHECK ("status" IN ('CREATING','PENDING','UNKNOWN','REVIEW_REQUIRED','SUCCESS','FAILED','CANCELLED'));
