-- Existing upload features need a stable field code for rider document uploads.
-- Preserve any fieldCode explicitly configured by an administrator.
UPDATE "Feature"
SET "configuration" = COALESCE("configuration", '{}'::jsonb)
  || jsonb_build_object('fieldCode', "code")
WHERE "billingUnit" = 'UPLOAD'
  AND NULLIF(BTRIM("configuration"->>'fieldCode'), '') IS NULL;
