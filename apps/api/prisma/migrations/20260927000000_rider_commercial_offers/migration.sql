-- CreateEnum
CREATE TYPE "RiderCommercialOfferStatus" AS ENUM ('CALCULATED', 'PRESENTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiderRentalAgreementStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING', 'TERMINATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderAcceptanceMethod" AS ENUM ('APP_CONFIRMATION', 'OPERATIONS_ASSISTED');

-- CreateEnum
CREATE TYPE "RiderCommercialTermsStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "RiderRateCard" ADD COLUMN     "offerValidityMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "RiderCommercialTerms" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "status" "RiderCommercialTermsStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCommercialTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCommercialOffer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "offerNumber" VARCHAR(50) NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "hubId" TEXT,
    "rateCardId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" TEXT,
    "batteryPlanId" TEXT,
    "promotionCode" TEXT,
    "effectiveDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RiderCommercialOfferStatus" NOT NULL DEFAULT 'CALCULATED',
    "finalRecurringAmount" DECIMAL(12,2) NOT NULL,
    "upfrontAmount" DECIMAL(12,2) NOT NULL,
    "refundableAmount" DECIMAL(12,2) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingSnapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "calculationHash" CHAR(64) NOT NULL,
    "selectionHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "presentedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededByOfferId" TEXT,
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "acceptedById" TEXT,
    "rejectedById" TEXT,
    "cancelledById" TEXT,
    "acceptanceMethod" "RiderAcceptanceMethod",
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderCommercialOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementNumber" VARCHAR(50) NOT NULL,
    "commercialOfferId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "hubId" TEXT,
    "rateCardId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" TEXT,
    "batteryPlanId" TEXT,
    "currency" CHAR(3) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "billingAnchorDate" DATE,
    "status" "RiderRentalAgreementStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "finalRecurringAmount" DECIMAL(12,2) NOT NULL,
    "upfrontAmount" DECIMAL(12,2) NOT NULL,
    "refundableAmount" DECIMAL(12,2) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingSnapshotSchemaVersion" INTEGER NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "pricingSource" VARCHAR(40) NOT NULL DEFAULT 'COMMERCIAL_OFFER',
    "termsSnapshot" TEXT NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptanceMethod" "RiderAcceptanceMethod" NOT NULL,
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "terminationRequestedAt" TIMESTAMP(3),
    "terminationEffectiveAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreementStatusHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "previousStatus" "RiderRentalAgreementStatus",
    "newStatus" "RiderRentalAgreementStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderRentalAgreementStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreementAmendment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "amendmentNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "previousPricingHash" CHAR(64) NOT NULL,
    "proposedPricingHash" CHAR(64) NOT NULL,
    "proposedPricingSnapshot" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "RiderRentalAgreementAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderCommercialTerms_clientId_code_status_idx" ON "RiderCommercialTerms"("clientId", "code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialTerms_clientId_code_version_key" ON "RiderCommercialTerms"("clientId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_offerNumber_key" ON "RiderCommercialOffer"("offerNumber");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_riderId_status_createdAt_idx" ON "RiderCommercialOffer"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_vehicleId_status_expiresAt_idx" ON "RiderCommercialOffer"("clientId", "vehicleId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_rateCardVersionId_idx" ON "RiderCommercialOffer"("clientId", "rateCardVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_clientId_idempotencyKey_key" ON "RiderCommercialOffer"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_clientId_id_key" ON "RiderCommercialOffer"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_agreementNumber_key" ON "RiderRentalAgreement"("agreementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_commercialOfferId_key" ON "RiderRentalAgreement"("commercialOfferId");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_riderId_status_createdAt_idx" ON "RiderRentalAgreement"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_vehicleId_status_idx" ON "RiderRentalAgreement"("clientId", "vehicleId", "status");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_startDate_endDate_idx" ON "RiderRentalAgreement"("clientId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "RiderRentalAgreementStatusHistory_clientId_agreementId_chan_idx" ON "RiderRentalAgreementStatusHistory"("clientId", "agreementId", "changedAt");

-- CreateIndex
CREATE INDEX "RiderRentalAgreementAmendment_clientId_agreementId_status_idx" ON "RiderRentalAgreementAmendment"("clientId", "agreementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreementAmendment_agreementId_amendmentNumber_key" ON "RiderRentalAgreementAmendment"("agreementId", "amendmentNumber");

-- AddForeignKey
ALTER TABLE "RiderCommercialTerms" ADD CONSTRAINT "RiderCommercialTerms_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCommercialOffer" ADD CONSTRAINT "RiderCommercialOffer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreement" ADD CONSTRAINT "RiderRentalAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreement" ADD CONSTRAINT "RiderRentalAgreement_commercialOfferId_fkey" FOREIGN KEY ("commercialOfferId") REFERENCES "RiderCommercialOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreementStatusHistory" ADD CONSTRAINT "RiderRentalAgreementStatusHistory_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreementAmendment" ADD CONSTRAINT "RiderRentalAgreementAmendment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Human-readable identifiers are allocated by PostgreSQL, independently of table counts.
CREATE SEQUENCE rider_commercial_offer_number_seq;
CREATE SEQUENCE rider_rental_agreement_number_seq;

-- One pending/active commercial agreement per rider and vehicle within a client.
CREATE UNIQUE INDEX "one_live_agreement_per_vehicle" ON "RiderRentalAgreement" ("clientId", "vehicleId") WHERE "status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING');
CREATE UNIQUE INDEX "one_live_agreement_per_rider" ON "RiderRentalAgreement" ("clientId", "riderId") WHERE "status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING');
CREATE UNIQUE INDEX "one_active_rider_terms_per_client" ON "RiderCommercialTerms" ("clientId") WHERE "status" = 'ACTIVE';
ALTER TABLE "RiderRateCard" ADD CONSTRAINT "offer_validity_positive" CHECK ("offerValidityMinutes" BETWEEN 1 AND 10080);
ALTER TABLE "RiderCommercialOffer" ADD CONSTRAINT "offer_amounts_nonnegative" CHECK ("finalRecurringAmount" >= 0 AND "upfrontAmount" >= 0 AND "refundableAmount" >= 0 AND "expiresAt" > "createdAt");
ALTER TABLE "RiderRentalAgreement" ADD CONSTRAINT "agreement_amounts_nonnegative" CHECK ("finalRecurringAmount" >= 0 AND "upfrontAmount" >= 0 AND "refundableAmount" >= 0 AND ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" > "startDate"));

CREATE FUNCTION protect_rider_offer_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'CALCULATED' AND (
    NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
    NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
    NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
    NEW."hubId" IS DISTINCT FROM OLD."hubId" OR
    NEW."rateCardId" IS DISTINCT FROM OLD."rateCardId" OR
    NEW."rentalPeriodType" IS DISTINCT FROM OLD."rentalPeriodType" OR
    NEW."durationValue" IS DISTINCT FROM OLD."durationValue" OR
    NEW."durationUnit" IS DISTINCT FROM OLD."durationUnit" OR
    NEW."batteryPlanId" IS DISTINCT FROM OLD."batteryPlanId" OR
    NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR
    NEW."selectionHash" IS DISTINCT FROM OLD."selectionHash" OR
    NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
    NEW."pricingSnapshotSchemaVersion" IS DISTINCT FROM OLD."pricingSnapshotSchemaVersion" OR
    NEW."calculationHash" IS DISTINCT FROM OLD."calculationHash" OR
    NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
    NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
    NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
    NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
    NEW."finalRecurringAmount" IS DISTINCT FROM OLD."finalRecurringAmount" OR
    NEW."upfrontAmount" IS DISTINCT FROM OLD."upfrontAmount" OR
    NEW."refundableAmount" IS DISTINCT FROM OLD."refundableAmount" OR
    NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId"
  ) THEN RAISE EXCEPTION 'Presented offer commercial terms are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_rider_offer_terms_trigger BEFORE UPDATE ON "RiderCommercialOffer" FOR EACH ROW EXECUTE FUNCTION protect_rider_offer_terms();

CREATE FUNCTION protect_rider_agreement_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
     NEW."commercialOfferId" IS DISTINCT FROM OLD."commercialOfferId" OR
     NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."hubId" IS DISTINCT FROM OLD."hubId" OR
     NEW."rateCardId" IS DISTINCT FROM OLD."rateCardId" OR
     NEW."rentalPeriodType" IS DISTINCT FROM OLD."rentalPeriodType" OR
     NEW."durationValue" IS DISTINCT FROM OLD."durationValue" OR
     NEW."durationUnit" IS DISTINCT FROM OLD."durationUnit" OR
     NEW."batteryPlanId" IS DISTINCT FROM OLD."batteryPlanId" OR
     NEW."currency" IS DISTINCT FROM OLD."currency" OR
     NEW."pricingSnapshotSchemaVersion" IS DISTINCT FROM OLD."pricingSnapshotSchemaVersion" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
    NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
     NEW."finalRecurringAmount" IS DISTINCT FROM OLD."finalRecurringAmount" OR
     NEW."upfrontAmount" IS DISTINCT FROM OLD."upfrontAmount" OR
     NEW."refundableAmount" IS DISTINCT FROM OLD."refundableAmount" OR
     NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId"
  THEN RAISE EXCEPTION 'Agreement commercial terms are immutable; create an amendment'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_rider_agreement_terms_trigger BEFORE UPDATE ON "RiderRentalAgreement" FOR EACH ROW EXECUTE FUNCTION protect_rider_agreement_terms();
