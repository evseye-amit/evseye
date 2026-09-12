ALTER TABLE "VehicleCategory"
  DROP COLUMN IF EXISTS "createdById",
  DROP COLUMN IF EXISTS "updatedById";

ALTER TABLE "VehicleType"
  DROP COLUMN IF EXISTS "createdById",
  DROP COLUMN IF EXISTS "updatedById";

ALTER TABLE "Package"
  DROP COLUMN IF EXISTS "createdById",
  DROP COLUMN IF EXISTS "updatedById";

ALTER TABLE "RiderOnboardingConfig"
  DROP COLUMN IF EXISTS "createdById";
