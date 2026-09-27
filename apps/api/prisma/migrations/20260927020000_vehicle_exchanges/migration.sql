-- CreateEnum
CREATE TYPE "VehicleExchangeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED', 'ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleExchangeOfferStatus" AS ENUM ('PRESENTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExchangeProrationMode" AS ENUM ('NONE', 'DAILY', 'HOURLY', 'CALENDAR_DAY', 'BILLING_PERIOD_REMAINDER');

-- CreateEnum
CREATE TYPE "ExchangeProrationPolicy" AS ENUM ('NO_PRORATION', 'PRORATE_OLD_ONLY', 'PRORATE_NEW_ONLY', 'PRORATE_BOTH', 'START_NEW_NEXT_BILLING_CYCLE');

-- CreateEnum
CREATE TYPE "ExchangeDepositExcessPolicy" AS ENUM ('REFUND_REQUEST', 'RETAIN_HELD');

-- AlterTable
ALTER TABLE "RiderRentalAgreement" ADD COLUMN     "currentCommercialVersionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "currentVehicleId" TEXT;

-- AlterTable
ALTER TABLE "RiderRentalAgreementAmendment" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "commercialDifference" JSONB,
ADD COLUMN     "effectiveAt" TIMESTAMP(3),
ADD COLUMN     "exchangeRequestId" TEXT,
ADD COLUMN     "previousVehicleId" TEXT,
ADD COLUMN     "replacementVehicleId" TEXT;

-- CreateTable
CREATE TABLE "ClientExchangePolicy" (
    "clientId" TEXT NOT NULL,
    "exchangeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "minimumDaysOnVehicle" INTEGER NOT NULL DEFAULT 0,
    "prorationMode" "ExchangeProrationMode" NOT NULL DEFAULT 'NONE',
    "prorationPolicy" "ExchangeProrationPolicy" NOT NULL DEFAULT 'NO_PRORATION',
    "depositExcessPolicy" "ExchangeDepositExcessPolicy" NOT NULL DEFAULT 'REFUND_REQUEST',
    "exchangeFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeWaiverReasonCodes" JSONB NOT NULL DEFAULT '[]',
    "offerValidityMinutes" INTEGER NOT NULL DEFAULT 60,
    "reservationMinutes" INTEGER NOT NULL DEFAULT 120,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExchangePolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "RiderAgreementCommercialVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "recurringAmount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "billingStartAt" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "amendmentId" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderAgreementCommercialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleExchangeRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "oldVehicleId" TEXT NOT NULL,
    "replacementVehicleId" TEXT,
    "replacementSelection" JSONB,
    "baseVersionNumber" INTEGER NOT NULL,
    "reasonCode" VARCHAR(80) NOT NULL,
    "reason" TEXT,
    "status" "VehicleExchangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "oldAllocationId" TEXT,
    "returnInspectionId" TEXT,
    "newAllocationId" TEXT,
    "proposedEffectiveAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "reservationExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleExchangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleExchangeOffer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "exchangeRequestId" TEXT NOT NULL,
    "status" "VehicleExchangeOfferStatus" NOT NULL DEFAULT 'PRESENTED',
    "pricingSnapshot" JSONB NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "commercialDifference" JSONB NOT NULL,
    "offerHash" CHAR(64) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptanceMethod" "RiderAcceptanceMethod",
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleExchangeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderAgreementCommercialVersion_amendmentId_key" ON "RiderAgreementCommercialVersion"("amendmentId");

-- CreateIndex
CREATE INDEX "RiderAgreementCommercialVersion_clientId_agreementId_effect_idx" ON "RiderAgreementCommercialVersion"("clientId", "agreementId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RiderAgreementCommercialVersion_agreementId_versionNumber_key" ON "RiderAgreementCommercialVersion"("agreementId", "versionNumber");

-- CreateIndex
CREATE INDEX "VehicleExchangeRequest_clientId_agreementId_status_idx" ON "VehicleExchangeRequest"("clientId", "agreementId", "status");

-- CreateIndex
CREATE INDEX "VehicleExchangeRequest_clientId_replacementVehicleId_status_idx" ON "VehicleExchangeRequest"("clientId", "replacementVehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleExchangeOffer_clientId_exchangeRequestId_status_idx" ON "VehicleExchangeOffer"("clientId", "exchangeRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreementAmendment_exchangeRequestId_key" ON "RiderRentalAgreementAmendment"("exchangeRequestId");

-- AddForeignKey
ALTER TABLE "ClientExchangePolicy" ADD CONSTRAINT "ClientExchangePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderAgreementCommercialVersion" ADD CONSTRAINT "RiderAgreementCommercialVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleExchangeRequest" ADD CONSTRAINT "VehicleExchangeRequest_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleExchangeOffer" ADD CONSTRAINT "VehicleExchangeOffer_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "VehicleExchangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "RiderRentalAgreement" SET "currentVehicleId" = "vehicleId" WHERE "currentVehicleId" IS NULL;

INSERT INTO "RiderAgreementCommercialVersion" (
  "id", "clientId", "agreementId", "versionNumber", "vehicleId", "rateCardVersionId",
  "pricingSnapshot", "pricingHash", "termsVersion", "termsHash", "termsSnapshot", "termsTitle", "recurringAmount", "effectiveFrom", "billingStartAt", "status"
)
SELECT gen_random_uuid()::text, "clientId", "id", 1, "vehicleId", "rateCardVersionId",
  "pricingSnapshot", "pricingHash", "termsVersion", "termsHash", "termsSnapshot", "termsTitle", "finalRecurringAmount", COALESCE("startDate"::timestamp, "acceptedAt"), COALESCE("billingAnchorDate"::timestamp, "startDate"::timestamp, "acceptedAt"), 'ACTIVE'
FROM "RiderRentalAgreement";

DROP INDEX "one_live_agreement_per_vehicle";
CREATE UNIQUE INDEX "one_live_agreement_per_vehicle" ON "RiderRentalAgreement" ("clientId", "currentVehicleId")
WHERE "status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING');

CREATE UNIQUE INDEX "one_active_exchange_per_agreement" ON "VehicleExchangeRequest" ("clientId", "agreementId")
WHERE "status" IN ('REQUESTED', 'APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED', 'ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING');
CREATE UNIQUE INDEX "one_replacement_hold_per_vehicle" ON "VehicleExchangeRequest" ("clientId", "replacementVehicleId")
WHERE "replacementVehicleId" IS NOT NULL AND "status" IN ('REPLACEMENT_SELECTED', 'OFFER_PRESENTED', 'ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING');

CREATE OR REPLACE FUNCTION reject_exchange_offer_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."commercialDifference" IS DISTINCT FROM OLD."commercialDifference" OR
     NEW."offerHash" IS DISTINCT FROM OLD."offerHash" OR
     NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" THEN
    RAISE EXCEPTION 'EXCHANGE_OFFER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER exchange_offer_immutable BEFORE UPDATE ON "VehicleExchangeOffer"
FOR EACH ROW EXECUTE FUNCTION reject_exchange_offer_mutation();

CREATE OR REPLACE FUNCTION reject_commercial_version_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId" OR
     NEW."recurringAmount" IS DISTINCT FROM OLD."recurringAmount" THEN
    RAISE EXCEPTION 'COMMERCIAL_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER commercial_version_immutable BEFORE UPDATE ON "RiderAgreementCommercialVersion"
FOR EACH ROW EXECUTE FUNCTION reject_commercial_version_mutation();

CREATE OR REPLACE FUNCTION reject_exchange_amendment_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW."previousPricingHash" IS DISTINCT FROM OLD."previousPricingHash" OR
     NEW."proposedPricingHash" IS DISTINCT FROM OLD."proposedPricingHash" OR
     NEW."proposedPricingSnapshot" IS DISTINCT FROM OLD."proposedPricingSnapshot" OR
     NEW."commercialDifference" IS DISTINCT FROM OLD."commercialDifference" OR
     NEW."previousVehicleId" IS DISTINCT FROM OLD."previousVehicleId" OR
     NEW."replacementVehicleId" IS DISTINCT FROM OLD."replacementVehicleId" THEN
    RAISE EXCEPTION 'EXCHANGE_AMENDMENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER exchange_amendment_immutable BEFORE UPDATE ON "RiderRentalAgreementAmendment"
FOR EACH ROW WHEN (OLD."exchangeRequestId" IS NOT NULL) EXECUTE FUNCTION reject_exchange_amendment_mutation();
