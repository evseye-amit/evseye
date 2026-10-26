-- Reconcile inspection workflow and subject values before removing the legacy owner discriminator.
UPDATE "Photo" p
SET "workFlowType" = 'SUBMISSION'::"PhotoWorkflowType"
FROM "Inspection" i
WHERE p."entityId" = i.id
  AND p."clientId" = i."clientId"
  AND p."entityType" = 'INSPECTION'::"PhotoEntityType"
  AND i.type = 'POST_DEALLOCATION';

-- All entity owner variants map to the canonical workflow subject vocabulary.
UPDATE "Photo"
SET "subjectType" = CASE
  WHEN "entityType" = 'PAYMENT_DEPLOYMENT' THEN 'OTHER'
  WHEN "entityType" = 'PAYMENT_COLLECTION' THEN 'COLLECTION'
  WHEN "entityType" = 'PAYMENT_AUTOPAY' THEN 'AUTOPAY'
  WHEN "entityType" = 'PAYMENT_RECEIVED' THEN 'OTHER'
  WHEN "entityType" = 'RIDER' THEN 'PROFILE'
  WHEN "entityType" = 'INSPECTION' THEN 'FLEET'
  WHEN "entityType" = 'FLEET' AND "subjectType"::text = 'INSTALLATION' THEN 'OTHER'
  WHEN "entityType" = 'PREPARATION' AND "subjectType"::text = 'INSTALLATION' THEN 'OTHER'
  WHEN "entityType" = 'PREPARATION' THEN 'FLEET'
  WHEN "entityType" = 'FLEET' THEN 'FLEET'
  WHEN "entityType" = 'BATTERY' THEN 'BATTERY'
  WHEN "entityType" = 'CONTROLLER' THEN 'CONTROLLER'
  WHEN "entityType" = 'IOT_DEVICE' THEN 'IOT_DEVICE'
  WHEN "entityType" = 'RIDER_ONBOARDING' AND "subjectType"::text IN ('PAN', 'AADHAR', 'PROFILE', 'DRIVING_LICENSE', 'BANK', 'ONBOARDING_FEES', 'DECLARATION') THEN "subjectType"::text
  WHEN "entityType" = 'RIDER_ONBOARDING' THEN 'DECLARATION'
  WHEN "entityType" = 'SUPPORT_TICKET' THEN 'SUPPORT_TICKET'
  ELSE 'OTHER'
END::"PhotoSubjectType";

-- Subject remapping can merge requirement keys. Preserve required rules and
-- the newest configuration, then remap the surviving rows.
WITH mapped AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "clientId", "workFlowType",
      CASE "subjectType"::text
        WHEN 'PREPARATION' THEN 'FLEET'
        WHEN 'INSTALLATION' THEN 'OTHER'
        WHEN 'INSPECTION' THEN 'FLEET'
        WHEN 'RIDER_DOCUMENT' THEN 'DECLARATION'
        WHEN 'DEPLOYMENT' THEN 'OTHER'
        WHEN 'RECEIVED' THEN 'OTHER'
        ELSE "subjectType"::text
      END, "photoType"
    ORDER BY "isRequired" DESC, "updatedAt" DESC, "id" ASC
  ) AS duplicate_rank
  FROM "PhotoRequirement"
)
DELETE FROM "PhotoRequirement" p USING mapped m
WHERE p.id = m.id AND m.duplicate_rank > 1;

UPDATE "PhotoRequirement"
SET "subjectType" = CASE "subjectType"::text
  WHEN 'PREPARATION' THEN 'FLEET'
  WHEN 'INSTALLATION' THEN 'OTHER'
  WHEN 'INSPECTION' THEN 'FLEET'
  WHEN 'RIDER_DOCUMENT' THEN 'DECLARATION'
  WHEN 'DEPLOYMENT' THEN 'OTHER'
  WHEN 'RECEIVED' THEN 'OTHER'
  ELSE "subjectType"::text
END::"PhotoSubjectType";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Photo"
    WHERE ("workFlowType"::text, "subjectType"::text) NOT IN (
      ('FLEET_MANAGEMENT', 'FLEET'), ('FLEET_MANAGEMENT', 'BATTERY'),
      ('FLEET_MANAGEMENT', 'CONTROLLER'), ('FLEET_MANAGEMENT', 'IOT_DEVICE'),
      ('FLEET_MANAGEMENT', 'MOTOR'), ('FLEET_MANAGEMENT', 'TYRE'), ('FLEET_MANAGEMENT', 'DOCK'),
      ('FLEET_MANAGEMENT', 'CHASSIS'), ('FLEET_MANAGEMENT', 'DASHBOARD'), ('FLEET_MANAGEMENT', 'OTHER'),
      ('PREPARATION', 'FLEET'), ('PREPARATION', 'OTHER'),
      ('ALLOTMENT', 'FLEET'), ('SUBMISSION', 'FLEET'),
      ('RIDER_MANAGEMENT', 'PROFILE'), ('RIDER_MANAGEMENT', 'DECLARATION'),
      ('RIDER_ONBOARDING', 'PROFILE'), ('RIDER_ONBOARDING', 'PAN'), ('RIDER_ONBOARDING', 'AADHAR'),
      ('RIDER_ONBOARDING', 'DRIVING_LICENSE'), ('RIDER_ONBOARDING', 'BANK'),
      ('RIDER_ONBOARDING', 'DECLARATION'), ('RIDER_ONBOARDING', 'ONBOARDING_FEES'), ('RIDER_ONBOARDING', 'OTHER'),
      ('SUPPORT', 'SUPPORT_TICKET'), ('SUPPORT', 'OTHER'),
      ('PAYMENT', 'ONBOARDING_FEES'), ('PAYMENT', 'COLLECTION'), ('PAYMENT', 'AUTOPAY'), ('PAYMENT', 'OTHER')
    )
  ) THEN
    RAISE EXCEPTION 'Photo workflow/subject mapping is incomplete; refusing to drop legacy Photo.entityType';
  END IF;
END $$;

DROP INDEX IF EXISTS "Photo_clientId_entityType_entityId_idx";
ALTER TABLE "Photo" DROP COLUMN "entityType";
DROP TYPE "PhotoEntityType";
