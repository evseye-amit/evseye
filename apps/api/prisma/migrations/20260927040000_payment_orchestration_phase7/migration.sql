-- DropIndex
DROP INDEX "PaymentTransaction_clientId_invoiceId_key";

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "riderPaymentId" TEXT,
ADD COLUMN "failureCode" VARCHAR(80),
ADD COLUMN "retryability" VARCHAR(20);

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "collectionRequestId" TEXT,
ALTER COLUMN "transactionId" DROP NOT NULL;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN "collectionRequestId" TEXT;

-- CreateTable
CREATE TABLE "PaymentCollectionPolicy" (
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "collectionTiming" VARCHAR(30) NOT NULL DEFAULT 'ON_DUE_DATE',
    "beforeDueDays" INTEGER NOT NULL DEFAULT 0,
    "collectionHourIst" INTEGER NOT NULL DEFAULT 0,
    "collectionMinuteIst" INTEGER NOT NULL DEFAULT 0,
    "retryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumAttempts" INTEGER NOT NULL DEFAULT 1,
    "retryIntervalsDays" JSONB NOT NULL DEFAULT '[]',
    "autoCollectCategories" JSONB NOT NULL DEFAULT '["RECURRING_RENTAL"]',
    "maximumAutoDebit" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PaymentCollectionPolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "PaymentCollectionRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "depositId" TEXT,
    "collectionType" VARCHAR(40) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "providerOrderId" VARCHAR(80),
    "providerPaymentId" VARCHAR(120),
    "paymentSessionId" VARCHAR(300),
    "riderPaymentId" TEXT,
    "depositTransactionId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCollectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATING',
    "provider" VARCHAR(30) NOT NULL,
    "providerRefundId" VARCHAR(120) NOT NULL,
    "providerReference" VARCHAR(120),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRefund_paymentId_key" ON "PaymentRefund"("paymentId");
CREATE UNIQUE INDEX "PaymentRefund_clientId_paymentId_key" ON "PaymentRefund"("clientId", "paymentId");
CREATE UNIQUE INDEX "RiderPayment_clientId_id_key" ON "RiderPayment"("clientId", "id");
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");
CREATE UNIQUE INDEX "PaymentRefund_clientId_idempotencyKey_key" ON "PaymentRefund"("clientId", "idempotencyKey");
CREATE INDEX "PaymentRefund_clientId_riderId_status_idx" ON "PaymentRefund"("clientId", "riderId", "status");
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_clientId_paymentId_fkey" FOREIGN KEY ("clientId", "paymentId") REFERENCES "RiderPayment"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_positive_amount" CHECK ("amount" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_providerOrderId_key" ON "PaymentCollectionRequest"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_providerPaymentId_key" ON "PaymentCollectionRequest"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_riderPaymentId_key" ON "PaymentCollectionRequest"("riderPaymentId");
CREATE UNIQUE INDEX "PaymentCollectionRequest_depositTransactionId_key" ON "PaymentCollectionRequest"("depositTransactionId");

-- CreateIndex
CREATE INDEX "PaymentCollectionRequest_clientId_riderId_status_idx" ON "PaymentCollectionRequest"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "PaymentCollectionRequest_clientId_invoiceId_status_idx" ON "PaymentCollectionRequest"("clientId", "invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_clientId_idempotencyKey_key" ON "PaymentCollectionRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_riderPaymentId_key" ON "PaymentTransaction"("riderPaymentId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_clientId_invoiceId_status_idx" ON "PaymentTransaction"("clientId", "invoiceId", "status");
CREATE UNIQUE INDEX "PaymentTransaction_active_invoice_key"
ON "PaymentTransaction"("clientId", "invoiceId")
WHERE "status" IN ('CREATING', 'PENDING', 'UNKNOWN', 'SUCCESS');

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_collectionRequestId_sequence_key" ON "PaymentAttempt"("collectionRequestId", "sequence");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_riderPaymentId_fkey" FOREIGN KEY ("riderPaymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_collectionRequestId_fkey" FOREIGN KEY ("collectionRequestId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_collectionRequestId_fkey" FOREIGN KEY ("collectionRequestId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_riderPaymentId_fkey" FOREIGN KEY ("riderPaymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "RiderDepositTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A rider can have one checkout in flight for an invoice. The provider call is
-- made after this row commits, so this index closes the concurrent-request race.
CREATE UNIQUE INDEX "PaymentCollectionRequest_active_invoice_key"
ON "PaymentCollectionRequest"("clientId", "invoiceId")
WHERE "invoiceId" IS NOT NULL AND "status" IN ('CREATING', 'PENDING', 'UNKNOWN');
CREATE UNIQUE INDEX "PaymentCollectionRequest_active_outstanding_key"
ON "PaymentCollectionRequest"("clientId", "riderId")
WHERE "collectionType" = 'OUTSTANDING_PAYMENT' AND "status" IN ('CREATING', 'PENDING', 'UNKNOWN');
CREATE UNIQUE INDEX "PaymentCollectionRequest_active_deposit_key"
ON "PaymentCollectionRequest"("clientId", "depositId")
WHERE "depositId" IS NOT NULL AND "status" IN ('CREATING', 'PENDING', 'UNKNOWN');

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_one_collection_owner"
CHECK (("transactionId" IS NOT NULL) <> ("collectionRequestId" IS NOT NULL));
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_positive_amount"
CHECK ("amount" > 0);
ALTER TABLE "PaymentCollectionPolicy" ADD CONSTRAINT "PaymentCollectionPolicy_valid_attempts"
CHECK ("maximumAttempts" BETWEEN 1 AND 10 AND "beforeDueDays" BETWEEN 0 AND 30);
ALTER TABLE "PaymentCollectionPolicy" ADD CONSTRAINT "PaymentCollectionPolicy_valid_custom_time"
CHECK ("collectionHourIst" BETWEEN 0 AND 23 AND "collectionMinuteIst" BETWEEN 0 AND 59);

-- Align Phase 6 rider-owned financial rows with their schema-level client scope.
ALTER TABLE "RiderPayment" DROP CONSTRAINT IF EXISTS "RiderPayment_rider_fkey";
ALTER TABLE "RiderPayment" ADD CONSTRAINT "RiderPayment_clientId_riderId_fkey"
FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiderPaymentAllocation" DROP CONSTRAINT IF EXISTS "RiderPaymentAllocation_rider_fkey";
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_clientId_riderId_fkey"
FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
