-- CreateEnum
CREATE TYPE "RiderChargeStatus" AS ENUM ('OPEN', 'INVOICED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RiderCreditStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_APPLIED', 'APPLIED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RiderInvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "RiderInvoiceLineKind" AS ENUM ('CHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "RiderLedgerEntryType" AS ENUM ('CHARGE', 'CREDIT', 'PAYMENT', 'REFUND', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "RiderPaymentProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "autoPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "billingStatus" VARCHAR(30) NOT NULL DEFAULT 'CURRENT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPaymentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCharge" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "sourceKey" VARCHAR(120) NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RiderChargeStatus" NOT NULL DEFAULT 'OPEN',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCredit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "sourceKey" VARCHAR(120) NOT NULL,
    "creditType" VARCHAR(60) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remainingAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RiderCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "entryType" "RiderLedgerEntryType" NOT NULL,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceNumber" VARCHAR(80) NOT NULL,
    "billingPeriodStart" DATE NOT NULL,
    "billingPeriodEnd" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "adjustmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RiderInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" DATE NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoiceLine" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "RiderInvoiceLineKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderPaymentProfile_riderId_key" ON "RiderPaymentProfile"("riderId");

-- CreateIndex
CREATE INDEX "RiderPaymentProfile_clientId_billingStatus_idx" ON "RiderPaymentProfile"("clientId", "billingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPaymentProfile_clientId_riderId_key" ON "RiderPaymentProfile"("clientId", "riderId");

-- CreateIndex
CREATE INDEX "RiderCharge_clientId_riderId_status_effectiveAt_idx" ON "RiderCharge"("clientId", "riderId", "status", "effectiveAt");

-- CreateIndex
CREATE INDEX "RiderCharge_clientId_invoiceId_idx" ON "RiderCharge"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCharge_clientId_sourceKey_key" ON "RiderCharge"("clientId", "sourceKey");

-- CreateIndex
CREATE INDEX "RiderCredit_clientId_riderId_status_effectiveAt_idx" ON "RiderCredit"("clientId", "riderId", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCredit_clientId_sourceKey_key" ON "RiderCredit"("clientId", "sourceKey");

-- CreateIndex
CREATE INDEX "RiderLedgerEntry_clientId_riderId_effectiveAt_id_idx" ON "RiderLedgerEntry"("clientId", "riderId", "effectiveAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderLedgerEntry_clientId_entryType_sourceType_sourceId_key" ON "RiderLedgerEntry"("clientId", "entryType", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_riderId_createdAt_idx" ON "RiderInvoice"("clientId", "riderId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_status_dueDate_idx" ON "RiderInvoice"("clientId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_id_key" ON "RiderInvoice"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_invoiceNumber_key" ON "RiderInvoice"("clientId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_riderId_billingPeriodStart_billingPer_key" ON "RiderInvoice"("clientId", "riderId", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE INDEX "RiderInvoiceLine_clientId_invoiceId_idx" ON "RiderInvoiceLine"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoiceLine_invoiceId_kind_sourceId_key" ON "RiderInvoiceLine"("invoiceId", "kind", "sourceId");

-- AddForeignKey
ALTER TABLE "RiderPaymentProfile" ADD CONSTRAINT "RiderPaymentProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentProfile" ADD CONSTRAINT "RiderPaymentProfile_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCredit" ADD CONSTRAINT "RiderCredit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCredit" ADD CONSTRAINT "RiderCredit_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLedgerEntry" ADD CONSTRAINT "RiderLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLedgerEntry" ADD CONSTRAINT "RiderLedgerEntry_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoiceLine" ADD CONSTRAINT "RiderInvoiceLine_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants are enforced even for writers outside the API.
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_positive_amount" CHECK ("quantity" > 0 AND "unitAmount" >= 0 AND "amount" > 0);
ALTER TABLE "RiderCredit" ADD CONSTRAINT "RiderCredit_valid_balance" CHECK ("amount" > 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "amount");
ALTER TABLE "RiderLedgerEntry" ADD CONSTRAINT "RiderLedgerEntry_one_sided" CHECK (
  ("debitAmount" > 0 AND "creditAmount" = 0) OR ("creditAmount" > 0 AND "debitAmount" = 0)
);
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_valid_period" CHECK ("billingPeriodEnd" > "billingPeriodStart");
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_valid_money" CHECK (
  "subtotal" >= 0 AND "creditAmount" >= 0 AND "taxAmount" >= 0 AND
  "totalAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0 AND
  "totalAmount" = "subtotal" - "creditAmount" + "adjustmentAmount" + "taxAmount" AND
  "totalAmount" = "paidAmount" + "outstandingAmount"
);
ALTER TABLE "RiderInvoiceLine" ADD CONSTRAINT "RiderInvoiceLine_positive_amount" CHECK ("amount" > 0);

CREATE FUNCTION rider_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rider ledger entries are immutable; post a compensating entry';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_ledger_no_update BEFORE UPDATE OR DELETE ON "RiderLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION rider_ledger_immutable();

CREATE FUNCTION rider_invoice_line_guard() RETURNS trigger AS $$
DECLARE invoice_status "RiderInvoiceStatus";
DECLARE target_invoice_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN target_invoice_id := OLD."invoiceId";
  ELSE target_invoice_id := NEW."invoiceId";
  END IF;
  SELECT "status" INTO invoice_status FROM "RiderInvoice" WHERE "id" = target_invoice_id;
  IF invoice_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Finalized invoice lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_invoice_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON "RiderInvoiceLine"
FOR EACH ROW EXECUTE FUNCTION rider_invoice_line_guard();

CREATE FUNCTION rider_invoice_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."clientId", NEW."riderId", NEW."invoiceNumber", NEW."billingPeriodStart",
    NEW."billingPeriodEnd", NEW."subtotal", NEW."creditAmount", NEW."adjustmentAmount",
    NEW."taxAmount", NEW."totalAmount", NEW."currency"
  ) IS DISTINCT FROM (
    OLD."clientId", OLD."riderId", OLD."invoiceNumber", OLD."billingPeriodStart",
    OLD."billingPeriodEnd", OLD."subtotal", OLD."creditAmount", OLD."adjustmentAmount",
    OLD."taxAmount", OLD."totalAmount", OLD."currency"
  ) THEN
    RAISE EXCEPTION 'Finalized invoice financial snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_invoice_snapshot_immutable BEFORE UPDATE ON "RiderInvoice"
FOR EACH ROW EXECUTE FUNCTION rider_invoice_snapshot_guard();
