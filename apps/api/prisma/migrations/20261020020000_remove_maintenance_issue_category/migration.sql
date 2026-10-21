BEGIN;

-- Remove only structured maintenance issue categories, never penalty/spare categories.
CREATE FUNCTION pg_temp.strip_issue_categories(value JSONB, issue_object BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; entry RECORD;
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.strip_issue_categories(item, issue_object) ORDER BY ordinal), '[]'::jsonb)
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(item, ordinal);
    RETURN result;
  ELSIF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR entry IN SELECT key, val FROM jsonb_each(value) AS e(key, val) LOOP
      IF entry.key IN ('issueCategory', 'issueCategories') OR
        (entry.key = 'category' AND (issue_object OR value ? 'issueId' OR
          (value ? 'description' AND value ? 'status' AND value ? 'evidencePhotoIds'))) THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_object(entry.key,
        pg_temp.strip_issue_categories(entry.val, entry.key IN ('issues', 'previousIssues', 'maintenanceIssues')));
    END LOOP;
    RETURN result;
  END IF;
  RETURN value;
END $$;

-- Match the report service's compact, recursively sorted JSON hash input.
CREATE FUNCTION pg_temp.report_canonical(value JSONB) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    SELECT '[' || COALESCE(string_agg(pg_temp.report_canonical(item), ',' ORDER BY ordinal), '') || ']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(item, ordinal);
  ELSIF jsonb_typeof(value) = 'object' THEN
    SELECT '{' || COALESCE(string_agg(to_jsonb(key)::text || ':' || pg_temp.report_canonical(val), ',' ORDER BY lower(key) COLLATE "C", key COLLATE "C"), '') || '}'
      INTO result FROM jsonb_each(value) AS e(key, val);
  ELSE result := value::text;
  END IF;
  RETURN result;
END $$;

CREATE TEMP TABLE changed_issue_reports ON COMMIT DROP AS
SELECT id, digest AS old_digest FROM "VehicleSubmissionReport"
WHERE issues IS DISTINCT FROM pg_temp.strip_issue_categories(issues, TRUE);

-- Existing reports may already be terminal; disable the immutability guard only
-- while this migration rewrites the maintenance issue payload and digest.
DROP TRIGGER vehicle_submission_report_guard ON "VehicleSubmissionReport";

UPDATE "VehicleSubmissionReport" r
SET issues = pg_temp.strip_issue_categories(r.issues, TRUE)
FROM changed_issue_reports c WHERE r.id = c.id;

UPDATE "VehicleSubmissionReport" r SET digest = encode(sha256(convert_to(pg_temp.report_canonical(
  (CASE WHEN r."fleetStatus" IS NOT NULL THEN jsonb_build_object('fleetStatus', r."fleetStatus", 'issues', r.issues) ELSE '{}'::jsonb END) ||
  jsonb_build_object('stage', r.stage, 'mechanicName', r."mechanicName", 'summary', r.summary,
    'safeForReuse', r."safeForReuse", 'unsafeReason', r."unsafeReason", 'checksComplete', r."checksComplete",
    'evidencePhotoIds', r."evidencePhotoIds", 'items', r.items, 'totalAmount', r."totalAmount"::text, 'currency', r.currency)
), 'UTF8')), 'hex') FROM changed_issue_reports c WHERE r.id = c.id;

UPDATE "AuditLog" SET
  "previousData" = pg_temp.strip_issue_categories("previousData"),
  "newData" = pg_temp.strip_issue_categories("newData")
WHERE "previousData" IS DISTINCT FROM pg_temp.strip_issue_categories("previousData")
   OR "newData" IS DISTINCT FROM pg_temp.strip_issue_categories("newData");

-- Old OTP consent referred to the previous report digest. Require fresh consent.
UPDATE "OtpRequest" o SET status = 'CANCELLED'
FROM changed_issue_reports c
WHERE o.context->>'reportId' = c.id AND o.status = 'PENDING';
UPDATE "VehicleSubmissionReport" r SET
  "riderOtpRequestId" = NULL, "riderVerifiedUserId" = NULL,
  "teamLeadOtpRequestId" = NULL, "teamLeadVerifiedUserId" = NULL
FROM changed_issue_reports c WHERE r.id = c.id AND r.status IN ('DRAFT', 'SUBMITTED');

ALTER TABLE "VehicleMaintenanceIssue" DROP COLUMN "category";
DROP TYPE "MaintenanceIssueCategory";

CREATE TRIGGER vehicle_submission_report_guard
BEFORE UPDATE ON "VehicleSubmissionReport"
FOR EACH ROW EXECUTE FUNCTION guard_vehicle_submission_report();

COMMIT;
