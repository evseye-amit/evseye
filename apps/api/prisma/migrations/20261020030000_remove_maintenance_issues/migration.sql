BEGIN;

-- Match the report service's compact, recursively sorted JSON hash input.
CREATE OR REPLACE FUNCTION pg_temp.report_canonical(value JSONB) RETURNS TEXT LANGUAGE plpgsql AS $$
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

-- Every report with fleetStatus previously hashed its issues array. The new digest
-- hashes the same immutable snapshot with only that field removed.
CREATE TEMP TABLE changed_submission_reports ON COMMIT DROP AS
SELECT
  r.id,
  r.status,
  encode(sha256(convert_to(pg_temp.report_canonical(
    jsonb_build_object('fleetStatus', r."fleetStatus") ||
    jsonb_build_object(
      'stage', r.stage,
      'mechanicName', r."mechanicName",
      'summary', r.summary,
      'safeForReuse', r."safeForReuse",
      'unsafeReason', r."unsafeReason",
      'checksComplete', r."checksComplete",
      'evidencePhotoIds', r."evidencePhotoIds",
      'items', r.items,
      'totalAmount', r."totalAmount"::text,
      'currency', r.currency
    )
  ), 'UTF8')), 'hex') AS new_digest
FROM "VehicleSubmissionReport" r
WHERE r."fleetStatus" IS NOT NULL;

-- The normal guard makes imposed/completed report content immutable. Removing and
-- restoring this one trigger inside the transaction permits only this data rewrite.
DROP TRIGGER vehicle_submission_report_guard ON "VehicleSubmissionReport";

-- Pending consent still names the old digest. Keep verified OTP and finalized invoice
-- snapshots unchanged as historical evidence; active reports must obtain fresh consent.
UPDATE "OtpRequest" o
SET status = 'CANCELLED'
FROM changed_submission_reports c
WHERE o.context->>'reportId' = c.id
  AND o.purpose::text IN ('VEHICLE_SUBMISSION_RIDER', 'VEHICLE_SUBMISSION_TEAM_LEAD')
  AND o.status = 'PENDING';

UPDATE "VehicleSubmissionReport" r
SET
  digest = c.new_digest,
  "riderOtpRequestId" = CASE WHEN c.status IN ('DRAFT', 'SUBMITTED') THEN NULL ELSE r."riderOtpRequestId" END,
  "riderVerifiedUserId" = CASE WHEN c.status IN ('DRAFT', 'SUBMITTED') THEN NULL ELSE r."riderVerifiedUserId" END,
  "teamLeadOtpRequestId" = CASE WHEN c.status IN ('DRAFT', 'SUBMITTED') THEN NULL ELSE r."teamLeadOtpRequestId" END,
  "teamLeadVerifiedUserId" = CASE WHEN c.status IN ('DRAFT', 'SUBMITTED') THEN NULL ELSE r."teamLeadVerifiedUserId" END
FROM changed_submission_reports c
WHERE r.id = c.id;

-- A posted BASIC report proves the first confirmation completed. Under the new
-- workflow that confirmation always finishes mechanic checks, without changing
-- the vehicle's chosen fleet status or allocation readiness.
UPDATE "VehicleSubmission" s
SET
  "mechanicChecksComplete" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE s.status = 'CONFIRMED'
  AND NOT s."mechanicChecksComplete"
  AND EXISTS (
    SELECT 1
    FROM "VehicleSubmissionReport" r
    WHERE r."submissionId" = s.id
      AND r."clientId" = s."clientId"
      AND r.stage = 'BASIC'
      AND r.status = 'POSTED'
  );

-- Confirmation audit snapshots stored issue arrays at the root. Remove only those
-- feature-owned keys so unrelated audit JSON and penalty item categories remain intact.
UPDATE "AuditLog"
SET
  "previousData" = CASE
    WHEN "previousData" IS NULL THEN NULL
    ELSE "previousData" - ARRAY['issues', 'previousIssues', 'maintenanceIssues']
  END,
  "newData" = CASE
    WHEN "newData" IS NULL THEN NULL
    ELSE "newData" - ARRAY['issues', 'previousIssues', 'maintenanceIssues']
  END
WHERE "entityType" = 'VehicleSubmission'
  AND (
    COALESCE("previousData" ?| ARRAY['issues', 'previousIssues', 'maintenanceIssues'], FALSE)
    OR COALESCE("newData" ?| ARRAY['issues', 'previousIssues', 'maintenanceIssues'], FALSE)
  );

DROP TRIGGER unresolved_fleet_issues ON "Fleet";
DROP FUNCTION guard_unresolved_fleet_issues();
DROP TRIGGER maintenance_issue_fleet_lock ON "VehicleMaintenanceIssue";
DROP FUNCTION lock_maintenance_issue_fleet();
DROP TABLE "VehicleMaintenanceIssue";
DROP TYPE "MaintenanceIssueStatus";
ALTER TABLE "VehicleSubmissionReport" DROP COLUMN "issues";

CREATE TRIGGER vehicle_submission_report_guard
BEFORE UPDATE ON "VehicleSubmissionReport"
FOR EACH ROW EXECUTE FUNCTION guard_vehicle_submission_report();

COMMIT;
