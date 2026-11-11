-- AlterTable
ALTER TABLE "ClientPricingRevision" ADD COLUMN     "setupDiscountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "setupDiscountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vehicleDiscountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "vehicleDiscountValue" DECIMAL(12,2) NOT NULL DEFAULT 0;
