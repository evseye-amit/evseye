-- Rider profile photos are part of rider onboarding evidence. Merge any
-- duplicate requirement slots before moving RIDER_MANAGEMENT to RIDER_ONBOARDING.
UPDATE "PhotoRequirement" target
SET "isRequired" = target."isRequired" OR source."isRequired",
    "featureCode" = COALESCE(target."featureCode", source."featureCode"),
    "sortOrder" = LEAST(target."sortOrder", source."sortOrder"),
    "updatedAt" = GREATEST(target."updatedAt", source."updatedAt")
FROM "PhotoRequirement" source
WHERE source."workFlowType" = 'RIDER_MANAGEMENT'::"PhotoWorkflowType"
  AND source."subjectType" = 'PROFILE'::"PhotoSubjectType"
  AND target."clientId" = source."clientId"
  AND target."workFlowType" = 'RIDER_ONBOARDING'::"PhotoWorkflowType"
  AND target."subjectType" = 'PROFILE'::"PhotoSubjectType"
  AND target."photoType" = source."photoType";

DELETE FROM "PhotoRequirement" source
USING "PhotoRequirement" target
WHERE source."workFlowType" = 'RIDER_MANAGEMENT'::"PhotoWorkflowType"
  AND source."subjectType" = 'PROFILE'::"PhotoSubjectType"
  AND target."clientId" = source."clientId"
  AND target."workFlowType" = 'RIDER_ONBOARDING'::"PhotoWorkflowType"
  AND target."subjectType" = 'PROFILE'::"PhotoSubjectType"
  AND target."photoType" = source."photoType";

CREATE TYPE "PhotoWorkflowType_new" AS ENUM (
  'FLEET_INSPECTION',
  'FLEET_PREPARATION',
  'FLEET_ALLOTMENT',
  'FLEET_SUBMISSION',
  'RIDER_ONBOARDING',
  'SUPPORT',
  'PAYMENT'
);

ALTER TABLE "Photo"
  ALTER COLUMN "workFlowType" TYPE "PhotoWorkflowType_new"
  USING (CASE "workFlowType"::text
    WHEN 'FLEET_MANAGEMENT' THEN 'FLEET_INSPECTION'
    WHEN 'PREPARATION' THEN 'FLEET_PREPARATION'
    WHEN 'ALLOTMENT' THEN 'FLEET_ALLOTMENT'
    WHEN 'SUBMISSION' THEN 'FLEET_SUBMISSION'
    WHEN 'RIDER_MANAGEMENT' THEN 'RIDER_ONBOARDING'
    ELSE "workFlowType"::text
  END)::"PhotoWorkflowType_new";

ALTER TABLE "PhotoRequirement"
  ALTER COLUMN "workFlowType" TYPE "PhotoWorkflowType_new"
  USING (CASE "workFlowType"::text
    WHEN 'FLEET_MANAGEMENT' THEN 'FLEET_INSPECTION'
    WHEN 'PREPARATION' THEN 'FLEET_PREPARATION'
    WHEN 'ALLOTMENT' THEN 'FLEET_ALLOTMENT'
    WHEN 'SUBMISSION' THEN 'FLEET_SUBMISSION'
    WHEN 'RIDER_MANAGEMENT' THEN 'RIDER_ONBOARDING'
    ELSE "workFlowType"::text
  END)::"PhotoWorkflowType_new";

DROP TYPE "PhotoWorkflowType";
ALTER TYPE "PhotoWorkflowType_new" RENAME TO "PhotoWorkflowType";
