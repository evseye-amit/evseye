-- AlterTable
ALTER TABLE "RiderInvoice" ADD COLUMN     "appliedSettlementCreditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RiderPayment" ADD COLUMN     "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RiderRentalAgreement" ADD COLUMN     "commercialClosureState" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "financiallyClosedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientSettlementPolicy" (
    "clientId" TEXT NOT NULL,
    "depositApplicationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualDepositRefundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSettlementPolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "RiderSettlementCreditApplication" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSettlementCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalTerminationRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "requestedTerminationDate" TIMESTAMP(3) NOT NULL,
    "actualTerminationDate" TIMESTAMP(3),
    "reasonCode" VARCHAR(60) NOT NULL,
    "reasonText" VARCHAR(500),
    "requestedById" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalTerminationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderFinalSettlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "settlementNumber" VARCHAR(80) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "terminationDate" TIMESTAMP(3) NOT NULL,
    "billingCutoffAt" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "snapshot" JSONB,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderFinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRevision" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementChargeAssessment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "sourceType" VARCHAR(60),
    "sourceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "assessedAmount" DECIMAL(14,2) NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ASSESSED',
    "evidence" JSONB,
    "assessedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementChargeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDepositHold" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "holdUntil" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementDepositHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDepositApplication" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "depositTransactionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementDepositApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT,
    "depositRefundId" TEXT,
    "paymentId" TEXT,
    "paymentRefundId" TEXT,
    "refundType" VARCHAR(40) NOT NULL,
    "destinationType" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "externalReference" VARCHAR(160),
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(500),

    CONSTRAINT "SettlementRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderFinancialNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT,
    "invoiceId" TEXT,
    "noteNumber" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "reasonCode" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxSnapshot" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderFinancialNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSequence" (
    "clientId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "year" VARCHAR(9) NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SettlementSequence_pkey" PRIMARY KEY ("clientId","kind","year")
);

-- CreateIndex
CREATE INDEX "RiderSettlementCreditApplication_clientId_invoiceId_idx" ON "RiderSettlementCreditApplication"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderSettlementCreditApplication_settlementId_creditId_invo_key" ON "RiderSettlementCreditApplication"("settlementId", "creditId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_agreementId_key" ON "RentalTerminationRequest"("agreementId");

-- CreateIndex
CREATE INDEX "RentalTerminationRequest_clientId_riderId_status_idx" ON "RentalTerminationRequest"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_clientId_idempotencyKey_key" ON "RentalTerminationRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_clientId_agreementId_key" ON "RentalTerminationRequest"("clientId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_agreementId_key" ON "RiderFinalSettlement"("agreementId");

-- CreateIndex
CREATE INDEX "RiderFinalSettlement_clientId_riderId_status_idx" ON "RiderFinalSettlement"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_id_key" ON "RiderFinalSettlement"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_agreementId_key" ON "RiderFinalSettlement"("clientId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_settlementNumber_key" ON "RiderFinalSettlement"("clientId", "settlementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRevision_settlementId_version_key" ON "SettlementRevision"("settlementId", "version");

-- CreateIndex
CREATE INDEX "SettlementChargeAssessment_clientId_settlementId_status_idx" ON "SettlementChargeAssessment"("clientId", "settlementId", "status");

-- CreateIndex
CREATE INDEX "SettlementDepositHold_clientId_depositId_status_idx" ON "SettlementDepositHold"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_depositTransactionId_key" ON "SettlementDepositApplication"("depositTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_paymentId_key" ON "SettlementDepositApplication"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_settlementId_depositId_key" ON "SettlementDepositApplication"("settlementId", "depositId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_depositRefundId_key" ON "SettlementRefundRequest"("depositRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_paymentRefundId_key" ON "SettlementRefundRequest"("paymentRefundId");

-- CreateIndex
CREATE INDEX "SettlementRefundRequest_clientId_settlementId_status_idx" ON "SettlementRefundRequest"("clientId", "settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_clientId_idempotencyKey_key" ON "SettlementRefundRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SettlementAdjustment_clientId_settlementId_status_idx" ON "SettlementAdjustment"("clientId", "settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinancialNote_sourceId_key" ON "RiderFinancialNote"("sourceId");

-- CreateIndex
CREATE INDEX "RiderFinancialNote_clientId_riderId_issuedAt_idx" ON "RiderFinancialNote"("clientId", "riderId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinancialNote_clientId_noteNumber_key" ON "RiderFinancialNote"("clientId", "noteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_clientId_id_key" ON "RiderRentalAgreement"("clientId", "id");

-- AddForeignKey
ALTER TABLE "ClientSettlementPolicy" ADD CONSTRAINT "ClientSettlementPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementCreditApplication" ADD CONSTRAINT "RiderSettlementCreditApplication_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "RiderCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementCreditApplication" ADD CONSTRAINT "RiderSettlementCreditApplication_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalTerminationRequest" ADD CONSTRAINT "RentalTerminationRequest_clientId_agreementId_fkey" FOREIGN KEY ("clientId", "agreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderFinalSettlement" ADD CONSTRAINT "RiderFinalSettlement_clientId_agreementId_fkey" FOREIGN KEY ("clientId", "agreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRevision" ADD CONSTRAINT "SettlementRevision_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementChargeAssessment" ADD CONSTRAINT "SettlementChargeAssessment_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDepositHold" ADD CONSTRAINT "SettlementDepositHold_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDepositApplication" ADD CONSTRAINT "SettlementDepositApplication_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundRequest" ADD CONSTRAINT "SettlementRefundRequest_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Issued invoice totals remain immutable. Applied credit notes reduce the receivable
-- through a separate application balance instead of rewriting the invoice total.
ALTER TABLE "RiderInvoice" DROP CONSTRAINT "RiderInvoice_valid_money";
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_valid_money" CHECK (
  "subtotal" >= 0 AND "creditAmount" >= 0 AND "taxAmount" >= 0 AND
  "totalAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0 AND
  "appliedSettlementCreditAmount" >= 0 AND
  "totalAmount" = "subtotal" - "creditAmount" + "adjustmentAmount" + "taxAmount" AND
  "totalAmount" = "paidAmount" + "outstandingAmount" + "appliedSettlementCreditAmount"
);
ALTER TABLE "RiderPayment" ADD CONSTRAINT "RiderPayment_refund_balanced" CHECK (
  "refundedAmount" >= 0 AND "refundedAmount" <= "amount" AND "unallocatedAmount" >= 0 AND "unallocatedAmount" + "refundedAmount" <= "amount"
);
