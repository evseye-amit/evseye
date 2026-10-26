-- Collapse historical photo labels into the intentionally small PhotoType enum.
-- Remove requirement-key collisions before converting both columns.
WITH mapped AS (
  SELECT id,
    CASE
      WHEN "photoType"::text LIKE 'RECEIPT_%' OR "photoType"::text = 'PAYMENT_RECEIPT' THEN 'RECEIPT'
      WHEN "photoType"::text IN ('FRONT', 'VEHICLE_FRONT', 'FLEET_FRONT') THEN 'FRONT'
      WHEN "photoType"::text IN ('BACK', 'REAR', 'VEHICLE_REAR', 'FLEET_BACK') THEN 'BACK'
      WHEN "photoType"::text IN ('LEFT', 'VEHICLE_LEFT', 'FLEET_LEFT') THEN 'LEFT'
      WHEN "photoType"::text IN ('RIGHT', 'VEHICLE_RIGHT', 'FLEET_RIGHT') THEN 'RIGHT'
      WHEN "photoType"::text IN ('BODY', 'BATTERY_BODY', 'CONTROLLER_BODY', 'IOT_BODY', 'INSTALLATION') THEN 'BODY'
      WHEN "photoType"::text IN ('LABEL', 'BATTERY_LABEL', 'CONTROLLER_LABEL', 'IOT_LABEL') THEN 'LABEL'
      WHEN "photoType"::text IN ('DOCUMENT', 'RIDER_DECLARATION') OR "photoType"::text LIKE 'RIDER_DOCUMENT_%' THEN 'DOCUMENT'
      WHEN "photoType"::text = 'FACE' THEN 'FACE'
      ELSE 'OTHER'
    END AS mapped_type,
    ROW_NUMBER() OVER (
      PARTITION BY "clientId", "workFlowType", "subjectType",
        CASE
          WHEN "photoType"::text LIKE 'RECEIPT_%' OR "photoType"::text = 'PAYMENT_RECEIPT' THEN 'RECEIPT'
          WHEN "photoType"::text IN ('FRONT', 'VEHICLE_FRONT', 'FLEET_FRONT') THEN 'FRONT'
          WHEN "photoType"::text IN ('BACK', 'REAR', 'VEHICLE_REAR', 'FLEET_BACK') THEN 'BACK'
          WHEN "photoType"::text IN ('LEFT', 'VEHICLE_LEFT', 'FLEET_LEFT') THEN 'LEFT'
          WHEN "photoType"::text IN ('RIGHT', 'VEHICLE_RIGHT', 'FLEET_RIGHT') THEN 'RIGHT'
          WHEN "photoType"::text IN ('BODY', 'BATTERY_BODY', 'CONTROLLER_BODY', 'IOT_BODY', 'INSTALLATION') THEN 'BODY'
          WHEN "photoType"::text IN ('LABEL', 'BATTERY_LABEL', 'CONTROLLER_LABEL', 'IOT_LABEL') THEN 'LABEL'
          WHEN "photoType"::text IN ('DOCUMENT', 'RIDER_DECLARATION') OR "photoType"::text LIKE 'RIDER_DOCUMENT_%' THEN 'DOCUMENT'
          WHEN "photoType"::text = 'FACE' THEN 'FACE'
          ELSE 'OTHER'
        END
      ORDER BY "isRequired" DESC, "sortOrder" ASC, "updatedAt" DESC, "id" ASC
    ) AS duplicate_rank
  FROM "PhotoRequirement"
)
DELETE FROM "PhotoRequirement" r USING mapped m
WHERE r.id = m.id AND m.duplicate_rank > 1;

CREATE TYPE "PhotoType_new" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT', 'BODY', 'LABEL', 'DOCUMENT', 'FACE', 'RECEIPT', 'OTHER');

ALTER TABLE "Photo"
  ALTER COLUMN "photoType" TYPE "PhotoType_new"
  USING (CASE
    WHEN "photoType"::text LIKE 'RECEIPT_%' OR "photoType"::text = 'PAYMENT_RECEIPT' THEN 'RECEIPT'
    WHEN "photoType"::text IN ('FRONT', 'VEHICLE_FRONT', 'FLEET_FRONT') THEN 'FRONT'
    WHEN "photoType"::text IN ('BACK', 'REAR', 'VEHICLE_REAR', 'FLEET_BACK') THEN 'BACK'
    WHEN "photoType"::text IN ('LEFT', 'VEHICLE_LEFT', 'FLEET_LEFT') THEN 'LEFT'
    WHEN "photoType"::text IN ('RIGHT', 'VEHICLE_RIGHT', 'FLEET_RIGHT') THEN 'RIGHT'
    WHEN "photoType"::text IN ('BODY', 'BATTERY_BODY', 'CONTROLLER_BODY', 'IOT_BODY', 'INSTALLATION') THEN 'BODY'
    WHEN "photoType"::text IN ('LABEL', 'BATTERY_LABEL', 'CONTROLLER_LABEL', 'IOT_LABEL') THEN 'LABEL'
    WHEN "photoType"::text IN ('DOCUMENT', 'RIDER_DECLARATION') OR "photoType"::text LIKE 'RIDER_DOCUMENT_%' THEN 'DOCUMENT'
    WHEN "photoType"::text = 'FACE' THEN 'FACE'
    ELSE 'OTHER'
  END)::"PhotoType_new";

ALTER TABLE "PhotoRequirement"
  ALTER COLUMN "photoType" TYPE "PhotoType_new"
  USING (CASE
    WHEN "photoType"::text LIKE 'RECEIPT_%' OR "photoType"::text = 'PAYMENT_RECEIPT' THEN 'RECEIPT'
    WHEN "photoType"::text IN ('FRONT', 'VEHICLE_FRONT', 'FLEET_FRONT') THEN 'FRONT'
    WHEN "photoType"::text IN ('BACK', 'REAR', 'VEHICLE_REAR', 'FLEET_BACK') THEN 'BACK'
    WHEN "photoType"::text IN ('LEFT', 'VEHICLE_LEFT', 'FLEET_LEFT') THEN 'LEFT'
    WHEN "photoType"::text IN ('RIGHT', 'VEHICLE_RIGHT', 'FLEET_RIGHT') THEN 'RIGHT'
    WHEN "photoType"::text IN ('BODY', 'BATTERY_BODY', 'CONTROLLER_BODY', 'IOT_BODY', 'INSTALLATION') THEN 'BODY'
    WHEN "photoType"::text IN ('LABEL', 'BATTERY_LABEL', 'CONTROLLER_LABEL', 'IOT_LABEL') THEN 'LABEL'
    WHEN "photoType"::text IN ('DOCUMENT', 'RIDER_DECLARATION') OR "photoType"::text LIKE 'RIDER_DOCUMENT_%' THEN 'DOCUMENT'
    WHEN "photoType"::text = 'FACE' THEN 'FACE'
    ELSE 'OTHER'
  END)::"PhotoType_new";

DROP TYPE "PhotoType";
ALTER TYPE "PhotoType_new" RENAME TO "PhotoType";
