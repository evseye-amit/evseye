-- AlterTable
ALTER TABLE "RiderPaymentProfile" ADD COLUMN     "billingMode" VARCHAR(20) NOT NULL DEFAULT 'PREPAID',
ADD COLUMN     "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RiderCharge" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "commercialVersionId" TEXT,
ADD COLUMN     "pricingDetail" JSONB,
ADD COLUMN     "servicePeriodEnd" TIMESTAMP(3),
ADD COLUMN     "servicePeriodStart" TIMESTAMP(3),
ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "RiderInvoice" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "billingPeriodId" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "taxSnapshot" JSONB;

-- AlterTable
ALTER TABLE "RiderInvoiceLine" ADD COLUMN     "chargeType" VARCHAR(60),
ADD COLUMN     "commercialVersionId" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(14,2),
ADD COLUMN     "grossAmount" DECIMAL(14,2),
ADD COLUMN     "pricingDetail" JSONB,
ADD COLUMN     "quantity" DECIMAL(14,4),
ADD COLUMN     "servicePeriodEnd" TIMESTAMP(3),
ADD COLUMN     "servicePeriodStart" TIMESTAMP(3),
ADD COLUMN     "taxAmount" DECIMAL(14,2),
ADD COLUMN     "taxSnapshot" JSONB,
ADD COLUMN     "taxableAmount" DECIMAL(14,2),
ADD COLUMN     "unit" VARCHAR(20),
ADD COLUMN     "unitPrice" DECIMAL(14,2),
ADD COLUMN     "vehicleId" TEXT;

-- CreateTable
CREATE TABLE "RiderBillingSchedule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "frequency" VARCHAR(20) NOT NULL,
    "customDays" INTEGER,
    "billingMode" VARCHAR(20) NOT NULL,
    "anchorType" VARCHAR(30) NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "nextPeriodStart" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderBillingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderBillingPeriod" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "RiderBillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTaxProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "supplierState" VARCHAR(80) NOT NULL,
    "supplierGstin" VARCHAR(20),
    "placeOfSupply" VARCHAR(80) NOT NULL,
    "customerGstin" VARCHAR(20),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTaxRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "taxCode" VARCHAR(60) NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "cgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "igstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "RiderTaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoiceSequence" (
    "clientId" TEXT NOT NULL,
    "financialYear" VARCHAR(9) NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RiderInvoiceSequence_pkey" PRIMARY KEY ("clientId","financialYear")
);

-- CreateTable
CREATE TABLE "RiderPayment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "unallocatedAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "externalReference" VARCHAR(160),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPaymentAllocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "RiderPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderBillingSchedule_agreementId_key" ON "RiderBillingSchedule"("agreementId");

-- CreateIndex
CREATE INDEX "RiderBillingSchedule_clientId_status_nextPeriodStart_idx" ON "RiderBillingSchedule"("clientId", "status", "nextPeriodStart");

-- CreateIndex
CREATE INDEX "RiderBillingPeriod_clientId_scheduleId_status_idx" ON "RiderBillingPeriod"("clientId", "scheduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderBillingPeriod_clientId_agreementId_periodStart_periodE_key" ON "RiderBillingPeriod"("clientId", "agreementId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RiderTaxProfile_clientId_key" ON "RiderTaxProfile"("clientId");

-- CreateIndex
CREATE INDEX "RiderTaxRule_clientId_chargeType_effectiveFrom_idx" ON "RiderTaxRule"("clientId", "chargeType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RiderPayment_clientId_riderId_receivedAt_idx" ON "RiderPayment"("clientId", "riderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPayment_clientId_idempotencyKey_key" ON "RiderPayment"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPayment_clientId_method_externalReference_key" ON "RiderPayment"("clientId", "method", "externalReference");

-- CreateIndex
CREATE INDEX "RiderPaymentAllocation_clientId_paymentId_idx" ON "RiderPaymentAllocation"("clientId", "paymentId");

-- CreateIndex
CREATE INDEX "RiderPaymentAllocation_clientId_invoiceId_idx" ON "RiderPaymentAllocation"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_billingPeriodId_key" ON "RiderInvoice"("billingPeriodId");

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "RiderBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingSchedule" ADD CONSTRAINT "RiderBillingSchedule_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RiderBillingSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderTaxRule" ADD CONSTRAINT "RiderTaxRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderTaxProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cross-worker period safety and money invariants.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_no_overlap" EXCLUDE USING gist (
  "agreementId" WITH =,
  tsrange("periodStart", "periodEnd", '[)') WITH &&
);
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_valid_range" CHECK ("periodStart" < "periodEnd");
ALTER TABLE "RiderBillingSchedule" ADD CONSTRAINT "RiderBillingSchedule_valid_policy" CHECK (
  "frequency" IN ('DAILY','WEEKLY','FORTNIGHTLY','MONTHLY','CUSTOM') AND
  "billingMode" IN ('PREPAID','POSTPAID') AND
  ("frequency" <> 'CUSTOM' OR "customDays" BETWEEN 1 AND 366)
);
ALTER TABLE "RiderPayment" ADD CONSTRAINT "RiderPayment_valid_money" CHECK ("amount" > 0 AND "unallocatedAmount" >= 0 AND "unallocatedAmount" <= "amount");
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "RiderTaxRule" ADD CONSTRAINT "RiderTaxRule_valid_rates" CHECK (
  "cgstRate" BETWEEN 0 AND 100 AND "sgstRate" BETWEEN 0 AND 100 AND "igstRate" BETWEEN 0 AND 100 AND
  ("igstRate" = 0 OR ("cgstRate" = 0 AND "sgstRate" = 0)) AND
  ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

-- The existing invoice trigger covers original fields. Include Phase 6 references and tax snapshot.
CREATE OR REPLACE FUNCTION rider_invoice_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."clientId", NEW."riderId", NEW."invoiceNumber", NEW."billingPeriodStart",
    NEW."billingPeriodEnd", NEW."subtotal", NEW."creditAmount", NEW."adjustmentAmount",
    NEW."taxAmount", NEW."totalAmount", NEW."currency", NEW."agreementId",
    NEW."billingPeriodId", NEW."taxSnapshot", NEW."dueDate", NEW."issuedAt"
  ) IS DISTINCT FROM (
    OLD."clientId", OLD."riderId", OLD."invoiceNumber", OLD."billingPeriodStart",
    OLD."billingPeriodEnd", OLD."subtotal", OLD."creditAmount", OLD."adjustmentAmount",
    OLD."taxAmount", OLD."totalAmount", OLD."currency", OLD."agreementId",
    OLD."billingPeriodId", OLD."taxSnapshot", OLD."dueDate", OLD."issuedAt"
  ) THEN
    RAISE EXCEPTION 'Issued invoice financial snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION rider_payment_allocation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations are append-only';
  END IF;
  IF (NEW."clientId", NEW."riderId", NEW."paymentId", NEW."invoiceId", NEW."amount", NEW."createdAt", NEW."createdById") IS DISTINCT FROM
     (OLD."clientId", OLD."riderId", OLD."paymentId", OLD."invoiceId", OLD."amount", OLD."createdAt", OLD."createdById")
     OR OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Payment allocations may only be reversed once';
  END IF;
  IF NEW."reversedAt" IS NULL OR NEW."reversalReason" IS NULL OR btrim(NEW."reversalReason") = '' THEN
    RAISE EXCEPTION 'Allocation reversal needs timestamp and reason';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_payment_allocation_immutable BEFORE UPDATE OR DELETE ON "RiderPaymentAllocation"
FOR EACH ROW EXECUTE FUNCTION rider_payment_allocation_guard();

CREATE FUNCTION rider_payment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recorded payments are immutable'; END IF;
  IF (NEW."clientId", NEW."riderId", NEW."amount", NEW."currency", NEW."method", NEW."externalReference", NEW."idempotencyKey", NEW."receivedAt", NEW."createdById", NEW."createdAt") IS DISTINCT FROM
     (OLD."clientId", OLD."riderId", OLD."amount", OLD."currency", OLD."method", OLD."externalReference", OLD."idempotencyKey", OLD."receivedAt", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded payment financial details are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_payment_immutable BEFORE UPDATE OR DELETE ON "RiderPayment"
FOR EACH ROW EXECUTE FUNCTION rider_payment_guard();

ALTER TABLE "RiderTaxRule" ADD CONSTRAINT "RiderTaxRule_no_overlap" EXCLUDE USING gist (
  "clientId" WITH =,
  "chargeType" WITH =,
  tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&
);
ALTER TABLE "RiderBillingSchedule" ADD CONSTRAINT "RiderBillingSchedule_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "RiderPayment" ADD CONSTRAINT "RiderPayment_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT;
