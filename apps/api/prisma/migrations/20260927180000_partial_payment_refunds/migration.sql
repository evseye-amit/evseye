DROP INDEX IF EXISTS "PaymentRefund_paymentId_key";
DROP INDEX IF EXISTS "PaymentRefund_clientId_paymentId_key";
CREATE INDEX "PaymentRefund_clientId_paymentId_status_idx" ON "PaymentRefund"("clientId", "paymentId", "status");
ALTER TYPE "WalletDepositRefundStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "WalletDepositRefundStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "WalletDepositRefundStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TABLE "WalletDepositRefundRequest" ADD COLUMN "destinationType" VARCHAR(40) NOT NULL DEFAULT 'WALLET_CASH', ADD COLUMN "externalReference" VARCHAR(160), ADD COLUMN "approvedById" TEXT, ADD COLUMN "approvedAt" TIMESTAMP(3), ADD COLUMN "completedAt" TIMESTAMP(3);
