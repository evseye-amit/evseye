-- Commercial offers and agreements allocate their public numbers through these sequences.
CREATE SEQUENCE IF NOT EXISTS rider_commercial_offer_number_seq;
CREATE SEQUENCE IF NOT EXISTS rider_rental_agreement_number_seq;
ALTER TABLE "Allocation" ADD COLUMN "commercialOfferId" TEXT, ADD COLUMN "rentalAgreementId" TEXT;
CREATE INDEX "Allocation_clientId_commercialOfferId_idx" ON "Allocation"("clientId", "commercialOfferId");
CREATE INDEX "Allocation_clientId_rentalAgreementId_idx" ON "Allocation"("clientId", "rentalAgreementId");
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_clientId_commercialOfferId_fkey" FOREIGN KEY ("clientId", "commercialOfferId") REFERENCES "RiderCommercialOffer"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_clientId_rentalAgreementId_fkey" FOREIGN KEY ("clientId", "rentalAgreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateCardFee" ADD COLUMN "selectionGroup" VARCHAR(80), ADD COLUMN "city" VARCHAR(100), ADD COLUMN "hubId" TEXT, ADD COLUMN "minVehicleAgeMonths" INTEGER, ADD COLUMN "maxVehicleAgeMonths" INTEGER, ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RateCardFee" ADD CONSTRAINT "RateCardFee_age_range_check" CHECK (("minVehicleAgeMonths" IS NULL OR "minVehicleAgeMonths" >= 0) AND ("maxVehicleAgeMonths" IS NULL OR "maxVehicleAgeMonths" >= 0) AND ("minVehicleAgeMonths" IS NULL OR "maxVehicleAgeMonths" IS NULL OR "minVehicleAgeMonths" <= "maxVehicleAgeMonths"));
