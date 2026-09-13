/*
  Warnings:

  - The values [PER_VEHICLE_DEVICE,TIERED_VOLUME] on the enum `PricingModel` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PricingModel_new" AS ENUM ('FREE', 'INCLUDED', 'FLAT_FEE', 'PER_UNIT', 'TIERED', 'VOLUME', 'PER_USER', 'PER_RIDER', 'PER_VEHICLE', 'PER_FLEET', 'USAGE_BASED', 'ONE_TIME', 'CUSTOM');
ALTER TABLE "FeaturePricing" ALTER COLUMN "pricingModel" TYPE "PricingModel_new" USING ("pricingModel"::text::"PricingModel_new");
ALTER TYPE "PricingModel" RENAME TO "PricingModel_old";
ALTER TYPE "PricingModel_new" RENAME TO "PricingModel";
DROP TYPE "public"."PricingModel_old";
COMMIT;

-- CreateIndex
CREATE INDEX "Oem_status_displayName_idx" ON "Oem"("status", "displayName");
