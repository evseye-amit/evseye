-- Package Master controls owned by the platform.
CREATE TYPE "PackageType" AS ENUM ('STANDARD', 'CUSTOM', 'TRIAL', 'ADD_ON', 'ENTERPRISE', 'INTERNAL');

ALTER TABLE "Package"
  ADD COLUMN "packageType" "PackageType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "maxFleets" INTEGER,
  ADD COLUMN "maxVehicles" INTEGER,
  ADD COLUMN "maxRiders" INTEGER,
  ADD COLUMN "maxUsers" INTEGER,
  ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedById" TEXT;

UPDATE "Package"
SET "isActive" = "status" = 'ACTIVE';

ALTER TABLE "Package"
  ALTER COLUMN "monthlyPrice" DROP NOT NULL,
  DROP COLUMN "status";

DROP INDEX IF EXISTS "Package_status_idx";
CREATE INDEX "Package_isActive_packageType_displayOrder_idx"
  ON "Package"("isActive", "packageType", "displayOrder");
