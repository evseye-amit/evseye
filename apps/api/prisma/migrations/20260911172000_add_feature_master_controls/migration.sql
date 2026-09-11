-- Controlled Feature Master values owned by the platform.
CREATE TYPE "FeatureCategory" AS ENUM (
  'RIDER_ONBOARDING', 'RIDER_VERIFICATION', 'RIDER_TRAINING', 'RIDER_MANAGEMENT',
  'ATTENDANCE', 'FACE_RECOGNITION', 'FLEET_MANAGEMENT', 'VEHICLE_MANAGEMENT',
  'IOT_TELEMATICS', 'TRACKING_GEOFENCING', 'BATTERY_MANAGEMENT', 'SERVICE_MAINTENANCE',
  'MECHANIC_MANAGEMENT', 'SAFETY_COMPLIANCE', 'ANALYTICS', 'REPORTING', 'NOTIFICATION',
  'INTEGRATION', 'API_ACCESS', 'USER_ACCESS', 'DOCUMENT_MANAGEMENT', 'SUPPORT', 'AI_AUTOMATION'
);

CREATE TYPE "FeatureType" AS ENUM ('BOOLEAN', 'QUANTITY', 'USAGE_BASED', 'CONFIGURATION');
CREATE TYPE "FeatureBillingUnit" AS ENUM (
  'VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL', 'FACE_SCAN', 'TRAINING', 'DEVICE', 'MONTH'
);

ALTER TABLE "Feature"
  ADD COLUMN "category_new" "FeatureCategory",
  ADD COLUMN "featureType_new" "FeatureType",
  ADD COLUMN "billingUnit_new" "FeatureBillingUnit",
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Feature"
SET
  "category_new" = CASE
    WHEN "code" = 'RIDER_ONBOARDING' THEN 'RIDER_ONBOARDING'::"FeatureCategory"
    WHEN "category" = 'KYC' THEN 'RIDER_VERIFICATION'::"FeatureCategory"
    WHEN "category" = 'Telematics' THEN 'IOT_TELEMATICS'::"FeatureCategory"
    ELSE 'RIDER_MANAGEMENT'::"FeatureCategory"
  END,
  "featureType_new" = CASE
    WHEN "featureType" = 'Verification' THEN 'USAGE_BASED'::"FeatureType"
    WHEN "featureType" = 'Module' THEN 'BOOLEAN'::"FeatureType"
    ELSE 'CONFIGURATION'::"FeatureType"
  END,
  "billingUnit_new" = CASE
    WHEN lower("billingUnit") = 'verification' THEN 'VERIFICATION'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'rider' THEN 'RIDER'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'vehicle' THEN 'VEHICLE'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'fleet' THEN 'FLEET'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'user' THEN 'USER'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'api_call' THEN 'API_CALL'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'face_scan' THEN 'FACE_SCAN'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'training' THEN 'TRAINING'::"FeatureBillingUnit"
    WHEN lower("billingUnit") = 'device' THEN 'DEVICE'::"FeatureBillingUnit"
    ELSE 'MONTH'::"FeatureBillingUnit"
  END,
  "isActive" = "status" = 'ACTIVE';

ALTER TABLE "Feature"
  DROP COLUMN "category",
  DROP COLUMN "featureType",
  DROP COLUMN "billingUnit",
  DROP COLUMN "status";

ALTER TABLE "Feature"
  RENAME COLUMN "category_new" TO "category";
ALTER TABLE "Feature"
  RENAME COLUMN "featureType_new" TO "featureType";
ALTER TABLE "Feature"
  RENAME COLUMN "billingUnit_new" TO "billingUnit";

ALTER TABLE "Feature"
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "featureType" SET NOT NULL,
  ALTER COLUMN "billingUnit" SET NOT NULL;

DROP INDEX IF EXISTS "Feature_status_category_idx";
CREATE INDEX "Feature_isActive_category_displayOrder_idx"
  ON "Feature"("isActive", "category", "displayOrder");
