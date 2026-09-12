-- Package categories and vehicle/user ceilings are not part of the package master.
-- Preserve existing default-package data as the renamed custom-package marker.
DROP INDEX IF EXISTS "Package_isActive_packageType_displayOrder_idx";

ALTER TABLE "Package" RENAME COLUMN "isDefault" TO "isCustom";
ALTER TABLE "Package"
  DROP COLUMN "packageType",
  DROP COLUMN "maxVehicles",
  DROP COLUMN "maxUsers";

DROP TYPE "PackageType";

CREATE INDEX "Package_isActive_isCustom_displayOrder_idx"
  ON "Package"("isActive", "isCustom", "displayOrder");
