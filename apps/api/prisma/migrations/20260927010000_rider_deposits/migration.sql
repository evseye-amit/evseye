-- CreateEnum
CREATE TYPE "RiderLedgerCategory" AS ENUM ('CHARGE_BALANCE', 'REFUNDABLE_DEPOSIT_LIABILITY');

-- CreateEnum
CREATE TYPE "RiderDepositStatus" AS ENUM ('REQUIRED', 'PARTIALLY_COLLECTED', 'HELD', 'SETTLEMENT_PENDING', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FORFEITED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiderDepositTransactionType" AS ENUM ('COLLECTION', 'WAIVER', 'DEDUCTION', 'REFUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'REVERSAL', 'FORFEITURE');

-- CreateEnum
CREATE TYPE "RiderDepositRefundStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DepositActivationPolicyType" AS ENUM ('FULL_REQUIRED', 'MINIMUM_PERCENTAGE', 'MINIMUM_AMOUNT', 'WAIVER_ALLOWED', 'NOT_REQUIRED_BEFORE_ACTIVATION');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "depositActivationPolicy" "DepositActivationPolicyType" NOT NULL DEFAULT 'FULL_REQUIRED',
ADD COLUMN     "depositActivationThreshold" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "RiderLedgerEntry" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "category" "RiderLedgerCategory" NOT NULL DEFAULT 'CHARGE_BALANCE',
ADD COLUMN     "vehicleId" TEXT;

-- CreateTable
CREATE TABLE "RiderDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "obligationKey" VARCHAR(160) NOT NULL,
    "depositType" VARCHAR(80) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "originalRequiredAmount" DECIMAL(14,2) NOT NULL,
    "waiverAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requiredAmount" DECIMAL(14,2) NOT NULL,
    "fundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "availableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "RiderDepositStatus" NOT NULL DEFAULT 'REQUIRED',
    "sourceType" VARCHAR(60) NOT NULL DEFAULT 'RENTAL_AGREEMENT',
    "sourceId" VARCHAR(120) NOT NULL,
    "snapshotLine" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDepositTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "transactionType" "RiderDepositTransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceDelta" DECIMAL(14,2) NOT NULL,
    "fundingDelta" DECIMAL(14,2) NOT NULL,
    "balanceBefore" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "referenceType" VARCHAR(80),
    "referenceId" VARCHAR(120),
    "reasonCode" VARCHAR(80),
    "reason" VARCHAR(500),
    "externalReference" VARCHAR(160),
    "paymentMethod" VARCHAR(80),
    "idempotencyKey" VARCHAR(200),
    "transferReferenceId" TEXT,
    "reversalOfTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RiderDepositTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDepositRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "RiderDepositRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "externalReference" VARCHAR(160),
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RiderDepositRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_riderId_status_createdAt_idx" ON "RiderDeposit"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_agreementId_status_idx" ON "RiderDeposit"("clientId", "agreementId", "status");

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_vehicleId_depositType_idx" ON "RiderDeposit"("clientId", "vehicleId", "depositType");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDeposit_clientId_agreementId_obligationKey_key" ON "RiderDeposit"("clientId", "agreementId", "obligationKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_reversalOfTransactionId_key" ON "RiderDepositTransaction"("reversalOfTransactionId");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_depositId_createdAt_idx" ON "RiderDepositTransaction"("clientId", "depositId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_riderId_agreementId_create_idx" ON "RiderDepositTransaction"("clientId", "riderId", "agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_transferReferenceId_idx" ON "RiderDepositTransaction"("clientId", "transferReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_clientId_idempotencyKey_key" ON "RiderDepositTransaction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_clientId_depositId_externalReferenc_key" ON "RiderDepositTransaction"("clientId", "depositId", "externalReference");

-- CreateIndex
CREATE INDEX "RiderDepositRefundRequest_clientId_depositId_status_idx" ON "RiderDepositRefundRequest"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositRefundRequest_clientId_idempotencyKey_key" ON "RiderDepositRefundRequest"("clientId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "RiderDeposit" ADD CONSTRAINT "RiderDeposit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiderDeposit" ADD CONSTRAINT "RiderDeposit_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDepositTransaction" ADD CONSTRAINT "RiderDepositTransaction_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDepositRefundRequest" ADD CONSTRAINT "RiderDepositRefundRequest_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RiderDeposit" ADD CONSTRAINT "deposit_nonnegative" CHECK (
  "originalRequiredAmount" >= 0 AND "waiverAmount" >= 0 AND "requiredAmount" >= 0
  AND "fundedAmount" >= 0 AND "availableAmount" >= 0
);
ALTER TABLE "RiderDepositTransaction" ADD CONSTRAINT "deposit_transaction_amount_positive" CHECK (
  "amount" > 0 AND "balanceBefore" >= 0 AND "balanceAfter" >= 0
  AND "balanceAfter" = "balanceBefore" + "balanceDelta"
);
ALTER TABLE "RiderDepositRefundRequest" ADD CONSTRAINT "deposit_refund_request_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Client" ADD CONSTRAINT "deposit_activation_threshold_valid" CHECK (
  ("depositActivationPolicy" IN ('MINIMUM_PERCENTAGE', 'MINIMUM_AMOUNT') AND "depositActivationThreshold" IS NOT NULL AND "depositActivationThreshold" >= 0
   AND ("depositActivationPolicy" <> 'MINIMUM_PERCENTAGE' OR "depositActivationThreshold" <= 100))
  OR ("depositActivationPolicy" NOT IN ('MINIMUM_PERCENTAGE', 'MINIMUM_AMOUNT') AND "depositActivationThreshold" IS NULL)
);

CREATE FUNCTION rider_deposit_transaction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Deposit transactions are immutable; post a reversal';
END $$;
CREATE TRIGGER rider_deposit_transaction_immutable_trigger BEFORE UPDATE OR DELETE ON "RiderDepositTransaction"
FOR EACH ROW EXECUTE FUNCTION rider_deposit_transaction_immutable();

CREATE FUNCTION rider_deposit_obligation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  posted_balance DECIMAL(14,2);
  posted_funding DECIMAL(14,2);
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
     NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
     NEW."agreementId" IS DISTINCT FROM OLD."agreementId" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."obligationKey" IS DISTINCT FROM OLD."obligationKey" OR
     NEW."depositType" IS DISTINCT FROM OLD."depositType" OR
     NEW."code" IS DISTINCT FROM OLD."code" OR
     NEW."currency" IS DISTINCT FROM OLD."currency" OR
     NEW."originalRequiredAmount" IS DISTINCT FROM OLD."originalRequiredAmount" OR
     NEW."waiverAmount" IS DISTINCT FROM OLD."waiverAmount" OR
     NEW."requiredAmount" IS DISTINCT FROM OLD."requiredAmount" OR
     NEW."snapshotLine" IS DISTINCT FROM OLD."snapshotLine" OR
     NEW."sourceType" IS DISTINCT FROM OLD."sourceType" OR
     NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
  THEN RAISE EXCEPTION 'Accepted deposit obligation is immutable'; END IF;
  SELECT COALESCE(SUM("balanceDelta"), 0), COALESCE(SUM("fundingDelta"), 0)
    INTO posted_balance, posted_funding
    FROM "RiderDepositTransaction" WHERE "depositId" = NEW."id";
  IF NEW."availableAmount" IS DISTINCT FROM posted_balance OR
     NEW."fundedAmount" IS DISTINCT FROM posted_funding
  THEN RAISE EXCEPTION 'Deposit materialized balances must reconcile to transactions'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rider_deposit_obligation_immutable_trigger BEFORE UPDATE ON "RiderDeposit"
FOR EACH ROW EXECUTE FUNCTION rider_deposit_obligation_immutable();
