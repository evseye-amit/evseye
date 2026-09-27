-- CreateEnum
CREATE TYPE "AdjustmentBasis" AS ENUM ('BASE_AMOUNT', 'CURRENT_AMOUNT');

-- CreateEnum
CREATE TYPE "RiderAdjustmentTarget" AS ENUM ('RENTAL', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "RiderRuleSelection" AS ENUM ('EXCLUSIVE', 'STACKABLE');

-- CreateEnum
CREATE TYPE "FeeEligibility" AS ENUM ('EVERY_NEW_AGREEMENT', 'FIRST_RENTAL_ONLY', 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP', 'MANUAL');

-- AlterEnum
ALTER TYPE "RiderAdjustmentType" ADD VALUE 'DISCOUNT';

-- AlterTable
ALTER TABLE "RiderRateCard" ADD COLUMN     "collectFirstRentalUpfront" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RateCardRentalRate" ADD COLUMN     "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxCode" TEXT,
ADD COLUMN     "taxRate" DECIMAL(7,4),
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RateCardFee" ADD COLUMN     "eligibility" "FeeEligibility" NOT NULL DEFAULT 'EVERY_NEW_AGREEMENT';

-- AlterTable
ALTER TABLE "RateCardDeposit" ADD COLUMN     "guaranteedBy" TEXT,
ADD COLUMN     "waiverAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "waiverReason" TEXT;

-- AlterTable
ALTER TABLE "RateCardAdjustment" ADD COLUMN     "country" VARCHAR(100),
ADD COLUMN     "maximumDiscount" DECIMAL(12,2),
ADD COLUMN     "percentageBasis" "AdjustmentBasis" NOT NULL DEFAULT 'BASE_AMOUNT',
ADD COLUMN     "selection" "RiderRuleSelection" NOT NULL DEFAULT 'EXCLUSIVE',
ADD COLUMN     "target" "RiderAdjustmentTarget" NOT NULL DEFAULT 'RENTAL',
ADD COLUMN     "targetDepositCode" VARCHAR(80);

-- CreateTable
CREATE TABLE "RiderPromotion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "calculationType" "RiderAdjustmentCalculationType" NOT NULL,
    "amount" DECIMAL(12,2),
    "percentage" DECIMAL(7,4),
    "maximumDiscount" DECIMAL(12,2),
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "rentalPeriodType" "RentalPeriodType",
    "maxUsage" INTEGER,
    "perRiderUsageLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderPromotion_clientId_isActive_validFrom_validTo_idx" ON "RiderPromotion"("clientId", "isActive", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPromotion_clientId_code_key" ON "RiderPromotion"("clientId", "code");

-- AddForeignKey
ALTER TABLE "RiderPromotion" ADD CONSTRAINT "RiderPromotion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Commercial constraints not representable in Prisma.
ALTER TABLE "RateCardRentalRate" ADD CONSTRAINT "rental_tax_configuration_valid" CHECK ((NOT "taxable" OR "taxRate" IS NOT NULL) AND ("taxRate" IS NULL OR "taxRate" BETWEEN 0 AND 100));
ALTER TABLE "RateCardDeposit" ADD CONSTRAINT "deposit_waiver_valid" CHECK ("waiverAmount" >= 0 AND "waiverAmount" <= "amount");
ALTER TABLE "RiderPromotion" ADD CONSTRAINT "promotion_configuration_valid" CHECK (("calculationType" = 'FIXED_AMOUNT' AND "amount" IS NOT NULL AND "amount" >= 0 AND "percentage" IS NULL) OR ("calculationType" = 'PERCENTAGE' AND "percentage" IS NOT NULL AND "percentage" BETWEEN 0 AND 100 AND "amount" IS NULL));
ALTER TABLE "RiderPromotion" ADD CONSTRAINT "promotion_period_valid" CHECK ("validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "RiderPromotion" ADD CONSTRAINT "promotion_limits_valid" CHECK (("maximumDiscount" IS NULL OR "maximumDiscount" >= 0) AND ("maxUsage" IS NULL OR "maxUsage" > 0) AND ("perRiderUsageLimit" IS NULL OR "perRiderUsageLimit" > 0));

ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "adjustment_target_valid" CHECK (("target" = 'RENTAL' AND "targetDepositCode" IS NULL) OR ("target" = 'DEPOSIT' AND "targetDepositCode" IS NOT NULL));
ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "adjustment_discount_cap_valid" CHECK ("maximumDiscount" IS NULL OR "maximumDiscount" >= 0);
