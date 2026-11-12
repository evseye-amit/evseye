ALTER TABLE "RateCardFee"
  ADD COLUMN "oemId" TEXT,
  ADD COLUMN "clientWorkPartnerId" TEXT;

ALTER TABLE "RateCardDeposit"
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "hubId" TEXT,
  ADD COLUMN "oemId" TEXT,
  ADD COLUMN "clientWorkPartnerId" TEXT,
  ADD COLUMN "minVehicleAgeMonths" INTEGER,
  ADD COLUMN "maxVehicleAgeMonths" INTEGER;

CREATE INDEX "RateCardFee_clientId_rateCardVersionId_city_hubId_oemId_clientWorkPartnerId_idx"
  ON "RateCardFee"("clientId", "rateCardVersionId", "city", "hubId", "oemId", "clientWorkPartnerId");

CREATE INDEX "RateCardDeposit_clientId_rateCardVersionId_city_hubId_oemId_clientWorkPartnerId_idx"
  ON "RateCardDeposit"("clientId", "rateCardVersionId", "city", "hubId", "oemId", "clientWorkPartnerId");

INSERT INTO "RateCardDeposit"
  ("id", "clientId", "rateCardVersionId", "code", "name", "depositType", "amount", "currency", "waiverAmount", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v."clientId", v."id", 'VEHICLE-SECURITY', 'Vehicle security deposit', 'VEHICLE_SECURITY', 500.00, v."currency", 0.00, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "RiderRateCardVersion" v
WHERE NOT EXISTS (
  SELECT 1 FROM "RateCardDeposit" d
  WHERE d."clientId" = v."clientId" AND d."rateCardVersionId" = v."id" AND d."code" = 'VEHICLE-SECURITY'
);

INSERT INTO "RateCardFee"
  ("id", "clientId", "rateCardVersionId", "code", "name", "chargeType", "nature", "eligibility", "amount", "currency", "taxable", "priceIncludesTax", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v."clientId", v."id", 'ONBOARDING_FEE', 'Onboarding fee', 'ONBOARDING_FEE', 'ONE_TIME', 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP', 1939.00, v."currency", false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "RiderRateCardVersion" v
WHERE NOT EXISTS (
  SELECT 1 FROM "RateCardFee" f
  WHERE f."clientId" = v."clientId" AND f."rateCardVersionId" = v."id" AND f."code" = 'ONBOARDING_FEE'
);
