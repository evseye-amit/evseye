-- CreateEnum
CREATE TYPE "WalletDepositStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'LOCKED', 'PARTIALLY_DEDUCTED', 'REFUND_ELIGIBLE', 'REFUND_REQUESTED', 'REFUNDED', 'FORFEITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletDepositRefundStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'SECURITY_DEPOSIT_DEDUCTION';
ALTER TYPE "WalletTransactionType" ADD VALUE 'SECURITY_DEPOSIT_FORFEITURE';

-- AlterTable
ALTER TABLE "WalletHold" ADD COLUMN     "capturedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WalletPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "allowNegativeCashBalance" BOOLEAN NOT NULL DEFAULT false,
    "negativeBalanceLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimumCashBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allowRewardUsage" BOOLEAN NOT NULL DEFAULT false,
    "maxRewardUsagePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rewardCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowDepositDeduction" BOOLEAN NOT NULL DEFAULT false,
    "depositDeductionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowPartialSecurityDeposit" BOOLEAN NOT NULL DEFAULT true,
    "requireFullDepositBeforeAllocation" BOOLEAN NOT NULL DEFAULT false,
    "allowDepositRefundRequest" BOOLEAN NOT NULL DEFAULT false,
    "fundingPriority" TEXT[] DEFAULT ARRAY['REWARD', 'CASH', 'EXTERNAL_PAYMENT']::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSecurityDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "requiredAmount" DECIMAL(18,2) NOT NULL,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "status" "WalletDepositStatus" NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "WalletSecurityDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletDepositRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "WalletDepositRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletDepositRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletPolicy_clientId_effectiveFrom_idx" ON "WalletPolicy"("clientId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPolicy_clientId_version_key" ON "WalletPolicy"("clientId", "version");

-- CreateIndex
CREATE INDEX "WalletSecurityDeposit_clientId_walletId_status_idx" ON "WalletSecurityDeposit"("clientId", "walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSecurityDeposit_clientId_riderId_sourceType_sourceId_key" ON "WalletSecurityDeposit"("clientId", "riderId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSecurityDeposit_clientId_id_key" ON "WalletSecurityDeposit"("clientId", "id");

-- CreateIndex
CREATE INDEX "WalletDepositRefundRequest_clientId_depositId_status_idx" ON "WalletDepositRefundRequest"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDepositRefundRequest_clientId_idempotencyKey_key" ON "WalletDepositRefundRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_riderId_id_key" ON "RiderWallet"("clientId", "riderId", "id");

-- AddForeignKey
ALTER TABLE "WalletPolicy" ADD CONSTRAINT "WalletPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_riderId_walletId_fkey" FOREIGN KEY ("clientId", "riderId", "walletId") REFERENCES "RiderWallet"("clientId", "riderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletDepositRefundRequest" ADD CONSTRAINT "WalletDepositRefundRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletDepositRefundRequest" ADD CONSTRAINT "WalletDepositRefundRequest_clientId_depositId_fkey" FOREIGN KEY ("clientId", "depositId") REFERENCES "WalletSecurityDeposit"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "WalletHold" ADD CONSTRAINT wallet_hold_capture_range CHECK ("capturedAmount" >= 0 AND "capturedAmount" <= "amount");
ALTER TABLE "WalletPolicy" ADD CONSTRAINT wallet_policy_amounts_valid CHECK ("negativeBalanceLimit" >= 0 AND "minimumCashBalance" >= 0 AND "maxRewardUsagePercent" >= 0 AND "maxRewardUsagePercent" <= 100);
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT wallet_security_deposit_required_nonnegative CHECK ("requiredAmount" >= 0);
ALTER TABLE "WalletDepositRefundRequest" ADD CONSTRAINT wallet_deposit_refund_positive CHECK ("amount" > 0);
CREATE UNIQUE INDEX wallet_one_current_policy_per_client ON "WalletPolicy" ("clientId") WHERE "effectiveUntil" IS NULL;
