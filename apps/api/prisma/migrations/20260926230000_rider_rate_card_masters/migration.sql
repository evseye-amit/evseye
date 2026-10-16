-- CreateEnum
CREATE TYPE "RiderRateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RentalPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RiderChargeNature" AS ENUM ('ONE_TIME', 'RECURRING', 'USAGE_BASED', 'REFUNDABLE_DEPOSIT', 'PENALTY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RiderAdjustmentCalculationType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "RiderAdjustmentType" AS ENUM ('LOCATION', 'HUB', 'VEHICLE', 'VEHICLE_AGE', 'VEHICLE_GRADE', 'BATTERY_PLAN', 'RIDER_TIER', 'CLIENT_SUBSIDY', 'PROMOTION', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "BatteryPricingType" AS ENUM ('INCLUDED', 'FIXED_SUBSCRIPTION', 'PER_SWAP', 'PER_KM', 'PER_KWH', 'SWAPS_INCLUDED', 'UNLIMITED_SWAP');

-- CreateTable
CREATE TABLE "RiderRateCard" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "RiderRateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRateCardVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "RiderRateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "description" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRateCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardRentalRate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "oemId" TEXT,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "fleetId" TEXT,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" VARCHAR(20),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "includedKm" DECIMAL(12,2),
    "extraKmRate" DECIMAL(12,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardRentalRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardFee" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "chargeType" VARCHAR(80) NOT NULL,
    "nature" "RiderChargeNature" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4),
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "depositType" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "fleetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "adjustmentType" "RiderAdjustmentType" NOT NULL,
    "calculationType" "RiderAdjustmentCalculationType" NOT NULL,
    "amount" DECIMAL(12,2),
    "percentage" DECIMAL(7,4),
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "oemId" TEXT,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "fleetId" TEXT,
    "state" VARCHAR(100),
    "city" VARCHAR(100),
    "zone" VARCHAR(100),
    "hubId" TEXT,
    "minVehicleAgeMonths" INTEGER,
    "maxVehicleAgeMonths" INTEGER,
    "vehicleCommercialGrade" VARCHAR(30),
    "rentalPeriodType" "RentalPeriodType",
    "batteryPlanId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderBatteryPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "pricingType" "BatteryPricingType" NOT NULL,
    "rentalPeriodType" "RentalPeriodType",
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "includedSwaps" INTEGER,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4),
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderBatteryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCommercialGradeAssignment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "grade" VARCHAR(30) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleCommercialGradeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderRateCard_clientId_status_priority_idx" ON "RiderRateCard"("clientId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCard_clientId_code_key" ON "RiderRateCard"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCard_clientId_id_key" ON "RiderRateCard"("clientId", "id");

-- CreateIndex
CREATE INDEX "RiderRateCardVersion_clientId_rateCardId_status_effectiveFr_idx" ON "RiderRateCardVersion"("clientId", "rateCardId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCardVersion_clientId_rateCardId_version_key" ON "RiderRateCardVersion"("clientId", "rateCardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCardVersion_clientId_id_key" ON "RiderRateCardVersion"("clientId", "id");

-- CreateIndex
CREATE INDEX "RateCardRentalRate_clientId_rateCardVersionId_rentalPeriodT_idx" ON "RateCardRentalRate"("clientId", "rateCardVersionId", "rentalPeriodType", "isActive");

-- CreateIndex
CREATE INDEX "RateCardRentalRate_vehicleCategoryId_vehicleTypeId_oemId_mo_idx" ON "RateCardRentalRate"("vehicleCategoryId", "vehicleTypeId", "oemId", "modelName", "variantName", "fleetId");

-- CreateIndex
CREATE INDEX "RateCardFee_clientId_rateCardVersionId_nature_isActive_idx" ON "RateCardFee"("clientId", "rateCardVersionId", "nature", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardFee_clientId_rateCardVersionId_code_key" ON "RateCardFee"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RateCardDeposit_clientId_rateCardVersionId_depositType_isAc_idx" ON "RateCardDeposit"("clientId", "rateCardVersionId", "depositType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardDeposit_clientId_rateCardVersionId_code_key" ON "RateCardDeposit"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RateCardAdjustment_clientId_rateCardVersionId_adjustmentTyp_idx" ON "RateCardAdjustment"("clientId", "rateCardVersionId", "adjustmentType", "isActive");

-- CreateIndex
CREATE INDEX "RateCardAdjustment_city_hubId_fleetId_rentalPeriodType_idx" ON "RateCardAdjustment"("city", "hubId", "fleetId", "rentalPeriodType");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardAdjustment_clientId_rateCardVersionId_code_key" ON "RateCardAdjustment"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RiderBatteryPlan_clientId_isActive_pricingType_idx" ON "RiderBatteryPlan"("clientId", "isActive", "pricingType");

-- CreateIndex
CREATE UNIQUE INDEX "RiderBatteryPlan_clientId_code_key" ON "RiderBatteryPlan"("clientId", "code");

-- CreateIndex
CREATE INDEX "VehicleCommercialGradeAssignment_clientId_fleetId_effective_idx" ON "VehicleCommercialGradeAssignment"("clientId", "fleetId", "effectiveFrom", "effectiveTo");

-- AddForeignKey
ALTER TABLE "RiderRateCard" ADD CONSTRAINT "RiderRateCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRateCardVersion" ADD CONSTRAINT "RiderRateCardVersion_clientId_rateCardId_fkey" FOREIGN KEY ("clientId", "rateCardId") REFERENCES "RiderRateCard"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardRentalRate" ADD CONSTRAINT "RateCardRentalRate_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardFee" ADD CONSTRAINT "RateCardFee_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardDeposit" ADD CONSTRAINT "RateCardDeposit_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "RateCardAdjustment_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBatteryPlan" ADD CONSTRAINT "RiderBatteryPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "VehicleCommercialGradeAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "VehicleCommercialGradeAssignment_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Commercial invariants that Prisma cannot express.
ALTER TABLE "RiderRateCardVersion" ADD CONSTRAINT "rate_card_version_period_valid" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");
ALTER TABLE "RateCardRentalRate" ADD CONSTRAINT "rental_amount_nonnegative" CHECK ("amount" >= 0 AND ("extraKmRate" IS NULL OR "extraKmRate" >= 0));
ALTER TABLE "RateCardFee" ADD CONSTRAINT "fee_amount_nonnegative" CHECK ("amount" >= 0 AND ("taxRate" IS NULL OR "taxRate" BETWEEN 0 AND 100));
ALTER TABLE "RateCardDeposit" ADD CONSTRAINT "deposit_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "RiderBatteryPlan" ADD CONSTRAINT "battery_plan_amount_nonnegative" CHECK ("amount" >= 0 AND ("taxRate" IS NULL OR "taxRate" BETWEEN 0 AND 100));
ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "adjustment_value_valid" CHECK (("calculationType" = 'FIXED_AMOUNT' AND "amount" IS NOT NULL AND "percentage" IS NULL) OR ("calculationType" = 'PERCENTAGE' AND "percentage" IS NOT NULL AND "amount" IS NULL AND "percentage" BETWEEN -100 AND 100));
ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "adjustment_age_valid" CHECK (("minVehicleAgeMonths" IS NULL OR "minVehicleAgeMonths" >= 0) AND ("maxVehicleAgeMonths" IS NULL OR "maxVehicleAgeMonths" >= "minVehicleAgeMonths") AND ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveFrom" < "effectiveTo"));
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "vehicle_grade_period_valid" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");
CREATE UNIQUE INDEX "one_default_rider_rate_card_per_client" ON "RiderRateCard" ("clientId") WHERE "isDefault" = true AND "status" <> 'INACTIVE';
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "RiderRateCardVersion" ADD CONSTRAINT "no_overlapping_active_rate_card_versions" EXCLUDE USING gist ("clientId" WITH =, "rateCardId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&) WHERE ("status" = 'ACTIVE');
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "no_overlapping_vehicle_grade_periods" EXCLUDE USING gist ("clientId" WITH =, "fleetId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&);
