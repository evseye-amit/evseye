-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletAccountType" AS ENUM ('CASH', 'SECURITY_DEPOSIT', 'REWARD', 'RECEIVABLE', 'ADJUSTMENT', 'CLEARING');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP', 'PAYMENT', 'RENTAL', 'ONBOARDING_FEE', 'SECURITY_DEPOSIT', 'SECURITY_DEPOSIT_REFUND', 'REWARD', 'REFERRAL_REWARD', 'SELF_SUBMISSION_REWARD', 'REFUND', 'PENALTY', 'REPAIR_CHARGE', 'SERVICE_CHARGE', 'BATTERY_CHARGE', 'SWAP_CHARGE', 'EXCHANGE_FEE', 'TRAFFIC_CHALLAN', 'ACCESSORY_CHARGE', 'LOST_EQUIPMENT_CHARGE', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('CREATED', 'PENDING', 'PROCESSING', 'POSTED', 'FAILED', 'CANCELLED', 'REVERSED', 'PARTIALLY_REVERSED');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "WalletHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CAPTURED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RiderWallet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "RiderWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountType" "WalletAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionNumber" VARCHAR(60) NOT NULL,
    "transactionType" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "parentTransactionId" TEXT,
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryType" "WalletEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "reason" VARCHAR(300) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_riderId_currency_key" ON "RiderWallet"("clientId", "riderId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_id_key" ON "RiderWallet"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_clientId_walletId_accountType_key" ON "WalletAccount"("clientId", "walletId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_clientId_walletId_id_key" ON "WalletAccount"("clientId", "walletId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_transactionNumber_key" ON "WalletTransaction"("transactionNumber");

-- CreateIndex
CREATE INDEX "WalletTransaction_clientId_walletId_createdAt_idx" ON "WalletTransaction"("clientId", "walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_clientId_idempotencyKey_key" ON "WalletTransaction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_clientId_id_key" ON "WalletTransaction"("clientId", "id");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_clientId_accountId_createdAt_idx" ON "WalletLedgerEntry"("clientId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_transactionId_sequence_key" ON "WalletLedgerEntry"("transactionId", "sequence");

-- CreateIndex
CREATE INDEX "WalletHold_clientId_walletId_status_idx" ON "WalletHold"("clientId", "walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletHold_clientId_idempotencyKey_key" ON "WalletHold"("clientId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "RiderWallet" ADD CONSTRAINT "RiderWallet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderWallet" ADD CONSTRAINT "RiderWallet_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_walletId_accountId_fkey" FOREIGN KEY ("clientId", "walletId", "accountId") REFERENCES "WalletAccount"("clientId", "walletId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_walletId_accountId_fkey" FOREIGN KEY ("clientId", "walletId", "accountId") REFERENCES "WalletAccount"("clientId", "walletId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The accounting journal is append-only, including for privileged database clients.
CREATE FUNCTION wallet_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Wallet ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_ledger_no_update BEFORE UPDATE OR DELETE ON "WalletLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION wallet_ledger_immutable();
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT wallet_ledger_positive CHECK ("amount" > 0);
ALTER TABLE "WalletTransaction" ADD CONSTRAINT wallet_transaction_positive CHECK ("amount" > 0);
ALTER TABLE "WalletHold" ADD CONSTRAINT wallet_hold_positive CHECK ("amount" > 0);
CREATE UNIQUE INDEX wallet_single_full_reversal ON "WalletTransaction" ("parentTransactionId") WHERE "transactionType" = 'REVERSAL';
