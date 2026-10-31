ALTER TABLE "PackageFeature" ADD COLUMN IF NOT EXISTS "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE "PackageFeature" ADD COLUMN IF NOT EXISTS "effectiveTo" DATE;
ALTER TABLE "PackageFeature" DROP CONSTRAINT IF EXISTS "PackageFeature_effective_dates_check";
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_effective_dates_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
