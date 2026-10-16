-- CreateEnum
CREATE TYPE "WalletInvoiceAllocationKind" AS ENUM ('APPLY', 'REVERSAL');

-- DropIndex
DROP INDEX "RiderInvoice_clientId_riderId_billingPeriodStart_billingPer_key";

-- AlterTable
ALTER TABLE "RiderPaymentProfile" ADD COLUMN     "autoSettleInvoiceFromWallet" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RiderInvoice" ADD COLUMN     "invoiceType" VARCHAR(40) NOT NULL DEFAULT 'RENTAL',
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "sourceKey" VARCHAR(160);

-- CreateTable
CREATE TABLE "WalletInvoiceAllocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "WalletInvoiceAllocationKind" NOT NULL DEFAULT 'APPLY',
    "sourceType" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "WalletInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletInvoiceAllocation_clientId_invoiceId_createdAt_idx" ON "WalletInvoiceAllocation"("clientId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletInvoiceAllocation_transactionId_sourceType_key" ON "WalletInvoiceAllocation"("transactionId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletInvoiceAllocation_reversalOfId_key" ON "WalletInvoiceAllocation"("reversalOfId");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_riderId_invoiceType_billingPeriodStar_idx" ON "RiderInvoice"("clientId", "riderId", "invoiceType", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_sourceKey_key" ON "RiderInvoice"("clientId", "sourceKey");

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "WalletInvoiceAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT wallet_invoice_allocation_positive CHECK ("amount" > 0);
ALTER TABLE "RiderInvoice" ADD CONSTRAINT wallet_invoice_amounts_nonnegative CHECK ("totalAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0 AND "outstandingAmount" <= "totalAmount" AND "billingPeriodEnd" >= "billingPeriodStart");

CREATE FUNCTION wallet_invoice_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."invoiceType" IS DISTINCT FROM OLD."invoiceType" OR
    NEW."sourceKey" IS DISTINCT FROM OLD."sourceKey" OR
    NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
    NEW."subtotal" IS DISTINCT FROM OLD."subtotal" OR
    NEW."creditAmount" IS DISTINCT FROM OLD."creditAmount" OR
    NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount" OR
    NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount" OR
    NEW."billingPeriodStart" IS DISTINCT FROM OLD."billingPeriodStart" OR
    NEW."billingPeriodEnd" IS DISTINCT FROM OLD."billingPeriodEnd"
  ) THEN RAISE EXCEPTION 'Issued invoice pricing is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_invoice_terms_no_update BEFORE UPDATE ON "RiderInvoice"
FOR EACH ROW EXECUTE FUNCTION wallet_invoice_terms_immutable();

CREATE FUNCTION wallet_invoice_line_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RiderInvoice" WHERE "id" = OLD."invoiceId" AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'Issued invoice lines are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_invoice_line_no_change BEFORE UPDATE OR DELETE ON "RiderInvoiceLine"
FOR EACH ROW EXECUTE FUNCTION wallet_invoice_line_immutable();

CREATE TRIGGER wallet_invoice_allocation_no_change BEFORE UPDATE OR DELETE ON "WalletInvoiceAllocation"
FOR EACH ROW EXECUTE FUNCTION wallet_ledger_immutable();

CREATE UNIQUE INDEX rider_invoice_rental_period_unique ON "RiderInvoice" ("clientId", "riderId", "billingPeriodStart", "billingPeriodEnd") WHERE "invoiceType" = 'RENTAL';
