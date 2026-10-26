-- Reconcile legacy owner tags with the canonical workflow/subject dimensions
-- before removing the redundant owner discriminator.
UPDATE "Photo" p
SET "workFlowType" = 'SUBMISSION'::"PhotoWorkflowType"
FROM "Inspection" i
WHERE p."entityId" = i.id
  AND p."clientId" = i."clientId"
  AND p."entityType" = 'INSPECTION'::"PhotoEntityType"
  AND i.type = 'POST_DEALLOCATION';

UPDATE "Photo"
SET "subjectType" = CASE "entityType"
  WHEN 'PAYMENT_DEPLOYMENT' THEN 'DEPLOYMENT'
  WHEN 'PAYMENT_COLLECTION' THEN 'COLLECTION'
  WHEN 'PAYMENT_AUTOPAY' THEN 'AUTOPAY'
  WHEN 'PAYMENT_RECEIVED' THEN 'RECEIVED'
  WHEN 'RIDER' THEN 'PROFILE'
  WHEN 'RIDER_ONBOARDING' THEN CASE
    WHEN "subjectType" IN ('PAN', 'AADHAR', 'RIDER_DOCUMENT') THEN "subjectType"
    ELSE 'RIDER_DOCUMENT'
  END
  ELSE "subjectType"::text
END::"PhotoSubjectType"
WHERE "entityType" IN (
  'PAYMENT_DEPLOYMENT', 'PAYMENT_COLLECTION', 'PAYMENT_AUTOPAY',
  'PAYMENT_RECEIVED', 'RIDER', 'RIDER_ONBOARDING'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Photo"
    WHERE ("workFlowType", "subjectType") NOT IN (
      ('FLEET_MANAGEMENT', 'FLEET'), ('FLEET_MANAGEMENT', 'BATTERY'),
      ('FLEET_MANAGEMENT', 'CONTROLLER'), ('FLEET_MANAGEMENT', 'IOT_DEVICE'), ('FLEET_MANAGEMENT', 'OTHER'),
      ('PREPARATION', 'PREPARATION'), ('PREPARATION', 'INSTALLATION'), ('PREPARATION', 'OTHER'),
      ('ALLOTMENT', 'INSPECTION'), ('ALLOTMENT', 'OTHER'), ('SUBMISSION', 'INSPECTION'), ('SUBMISSION', 'OTHER'),
      ('RIDER_MANAGEMENT', 'PROFILE'), ('RIDER_MANAGEMENT', 'OTHER'), ('RIDER_ONBOARDING', 'RIDER_DOCUMENT'),
      ('RIDER_ONBOARDING', 'PAN'), ('RIDER_ONBOARDING', 'AADHAR'), ('RIDER_ONBOARDING', 'OTHER'),
      ('SUPPORT', 'SUPPORT_TICKET'), ('SUPPORT', 'OTHER'), ('PAYMENT', 'ONBOARDING_FEES'),
      ('PAYMENT', 'DEPLOYMENT'), ('PAYMENT', 'COLLECTION'),
      ('PAYMENT', 'AUTOPAY'), ('PAYMENT', 'RECEIVED'),
      ('PAYMENT', 'OTHER')
    )
  ) THEN
    RAISE EXCEPTION 'Photo workflow/subject mapping is incomplete; refusing to drop legacy Photo.entityType';
  END IF;
END $$;

DROP INDEX IF EXISTS "Photo_clientId_entityType_entityId_idx";
ALTER TABLE "Photo" DROP COLUMN "entityType";
DROP TYPE "PhotoEntityType";
