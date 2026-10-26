CREATE TYPE "PhotoWorkflowType" AS ENUM (
  'FLEET_MANAGEMENT', 'PREPARATION', 'ALLOTMENT', 'SUBMISSION',
  'RIDER_MANAGEMENT', 'RIDER_ONBOARDING', 'SUPPORT', 'PAYMENT'
);

ALTER TABLE "Photo"
  ADD COLUMN "workFlowType" "PhotoWorkflowType",
  ADD COLUMN "subjectType" VARCHAR(100);

UPDATE "Photo" p SET
  "workFlowType" = CASE
    WHEN p."entityType" IN ('FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE') THEN 'FLEET_MANAGEMENT'::"PhotoWorkflowType"
    WHEN p."entityType" = 'PREPARATION' THEN 'PREPARATION'::"PhotoWorkflowType"
    WHEN p."entityType" = 'INSPECTION' AND EXISTS (SELECT 1 FROM "Inspection" i WHERE i.id = p."entityId" AND i.type = 'POST_DEALLOCATION') THEN 'SUBMISSION'::"PhotoWorkflowType"
    WHEN p."entityType" = 'INSPECTION' THEN 'ALLOTMENT'::"PhotoWorkflowType"
    WHEN p."entityType" = 'RIDER' THEN 'RIDER_MANAGEMENT'::"PhotoWorkflowType"
    WHEN p."entityType" = 'RIDER_ONBOARDING' THEN 'RIDER_ONBOARDING'::"PhotoWorkflowType"
    WHEN p."entityType" = 'SUPPORT_TICKET' THEN 'SUPPORT'::"PhotoWorkflowType"
    ELSE 'PAYMENT'::"PhotoWorkflowType"
  END,
  "subjectType" = CASE
    WHEN p."entityType" IN ('FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE') THEN p."entityType"::text
    WHEN p."entityType" = 'INSPECTION' THEN 'INSPECTION'
    WHEN p."entityType" = 'RIDER' THEN 'PROFILE'
    WHEN p."entityType" = 'RIDER_ONBOARDING' AND p."photoType" LIKE 'RIDER_DOCUMENT_%' THEN substring(p."photoType" from 16)
    WHEN p."entityType" = 'RIDER_ONBOARDING' THEN 'PROFILE'
    WHEN p."entityType" = 'SUPPORT_TICKET' THEN 'SUPPORT_TICKET'
    WHEN p."entityType"::text LIKE 'PAYMENT_%' THEN substring(p."entityType"::text from 9)
    ELSE 'PREPARATION'
  END;

ALTER TABLE "Photo" ALTER COLUMN "workFlowType" SET NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "subjectType" SET NOT NULL;
CREATE INDEX "Photo_clientId_workFlowType_subjectType_entityId_idx"
  ON "Photo"("clientId", "workFlowType", "subjectType", "entityId");

ALTER TABLE "PhotoRequirement"
  ADD COLUMN "workFlowType" "PhotoWorkflowType",
  ADD COLUMN "subjectType" VARCHAR(100),
  ADD COLUMN "featureCode" VARCHAR(100);

UPDATE "PhotoRequirement" SET
  "workFlowType" = CASE
    WHEN "entityType" IN ('FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE') THEN 'FLEET_MANAGEMENT'::"PhotoWorkflowType"
    WHEN "entityType" = 'PREPARATION' THEN 'PREPARATION'::"PhotoWorkflowType"
    WHEN "entityType" = 'INSPECTION' THEN 'ALLOTMENT'::"PhotoWorkflowType"
    WHEN "entityType" = 'RIDER' THEN 'RIDER_MANAGEMENT'::"PhotoWorkflowType"
    ELSE 'RIDER_ONBOARDING'::"PhotoWorkflowType"
  END,
  "subjectType" = CASE
    WHEN "entityType" IN ('FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE') THEN "entityType"::text
    WHEN "entityType" = 'INSPECTION' THEN 'INSPECTION'
    WHEN "entityType" = 'RIDER' THEN 'PROFILE'
    WHEN "entityType" = 'RIDER_ONBOARDING' THEN 'RIDER_DOCUMENT'
    ELSE 'PREPARATION'
  END;

ALTER TABLE "PhotoRequirement"
  ALTER COLUMN "workFlowType" SET NOT NULL,
  ALTER COLUMN "subjectType" SET NOT NULL;

DROP INDEX "PhotoRequirement_clientId_entityType_photoType_key";
DROP INDEX "PhotoRequirement_clientId_entityType_sortOrder_idx";

-- Inspection requirements applied to both inspection workflows before they
-- were distinguished. Preserve that behavior by copying slots to submission.
INSERT INTO "PhotoRequirement" ("id", "clientId", "workFlowType", "subjectType", "photoType", "isRequired", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "clientId", 'SUBMISSION'::"PhotoWorkflowType", 'INSPECTION', "photoType", "isRequired", "sortOrder", now(), now()
FROM "PhotoRequirement" WHERE "workFlowType" = 'ALLOTMENT' AND "subjectType" = 'INSPECTION'
ON CONFLICT DO NOTHING;

-- Standard rider document slots. Package features still determine whether
-- each upload field is enabled and required for a specific client.
INSERT INTO "PhotoRequirement" ("id", "clientId", "workFlowType", "subjectType", "photoType", "featureCode", "isRequired", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c.id, 'RIDER_ONBOARDING'::"PhotoWorkflowType", x.subject_type, x.photo_type, x.feature_code, true, x.sort_order, now(), now()
FROM "Client" c CROSS JOIN (VALUES
  ('AADHAR', 'FRONT', 'AADHAR_PROOF_DOCUMENT', 0), ('AADHAR', 'BACK', 'AADHAR_PROOF_DOCUMENT', 1),
  ('PAN', 'FRONT', 'PAN_PROOF_DOCUMENT', 0)
) AS x(subject_type, photo_type, feature_code, sort_order)
JOIN "Feature" f ON f.code = x.feature_code
ON CONFLICT DO NOTHING;

INSERT INTO "PhotoRequirement" ("id", "clientId", "workFlowType", "subjectType", "photoType", "featureCode", "isRequired", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c.id, 'RIDER_ONBOARDING'::"PhotoWorkflowType",
  CASE WHEN f.code = 'AADHAR_PROOF_DOCUMENT' THEN 'AADHAR' WHEN f.code = 'PAN_PROOF_DOCUMENT' THEN 'PAN' ELSE f.code END,
  'DOCUMENT', f.code, true, f."displayOrder", now(), now()
FROM "Client" c CROSS JOIN "Feature" f
WHERE f."billingUnit" = 'UPLOAD'
  AND f.category = 'RIDER_ONBOARDING'
  AND f.code NOT IN ('AADHAR_PROOF_DOCUMENT', 'PAN_PROOF_DOCUMENT')
ON CONFLICT DO NOTHING;

INSERT INTO "PhotoRequirement" ("id", "clientId", "workFlowType", "subjectType", "photoType", "isRequired", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c.id, 'PAYMENT'::"PhotoWorkflowType", 'ONBOARDING_FEES', 'RECEIPT', false, 0, now(), now()
FROM "Client" c
ON CONFLICT DO NOTHING;

ALTER TABLE "PhotoRequirement" DROP COLUMN "entityType";
CREATE UNIQUE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_photoType_key"
  ON "PhotoRequirement"("clientId", "workFlowType", "subjectType", "photoType");
CREATE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_sortOrder_idx"
  ON "PhotoRequirement"("clientId", "workFlowType", "subjectType", "sortOrder");
