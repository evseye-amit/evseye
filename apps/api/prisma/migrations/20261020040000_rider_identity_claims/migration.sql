BEGIN;

-- Freeze legacy identity writers while candidates are audited and the trigger
-- protected claim table is installed.
LOCK TABLE "Rider", "RiderOnboardingProgress", "User" IN SHARE MODE;

CREATE TEMP TABLE rider_identity_candidates (
  source text NOT NULL,
  source_id text NOT NULL,
  client_id text NOT NULL,
  user_id text,
  kind text NOT NULL,
  value text NOT NULL
) ON COMMIT DROP;

INSERT INTO rider_identity_candidates (source, source_id, client_id, user_id, kind, value)
SELECT 'RIDER', r.id, r."clientId", r."userId", identity.kind,
  CASE WHEN identity.kind = 'PAN' THEN upper(btrim(r.metadata->>identity.key))
       ELSE btrim(r.metadata->>identity.key) END
FROM "Rider" r
CROSS JOIN (VALUES ('AADHAAR', 'aadhaarNumber'), ('PAN', 'panNumber')) AS identity(kind, key)
WHERE r.metadata IS NOT NULL
  AND NULLIF(btrim(r.metadata->>identity.key), '') IS NOT NULL;

-- Completed progress is a historical snapshot and is intentionally excluded.
INSERT INTO rider_identity_candidates (source, source_id, client_id, user_id, kind, value)
SELECT 'RIDER_ONBOARDING_PROGRESS', p.id, p."clientId", p."userId", identity.kind,
  CASE WHEN identity.kind = 'PAN' THEN upper(btrim(p."values"->>identity.key))
       ELSE btrim(p."values"->>identity.key) END
FROM "RiderOnboardingProgress" p
CROSS JOIN (VALUES ('AADHAAR', 'AADHAAR_NUMBER'), ('PAN', 'PAN_NUMBER')) AS identity(kind, key)
WHERE p."completedAt" IS NULL
  AND p."values" IS NOT NULL
  AND NULLIF(btrim(p."values"->>identity.key), '') IS NOT NULL;

DO $$
DECLARE
  missing_owner bigint;
  client_mismatch bigint;
  owner_conflicts bigint;
  cross_user_conflicts bigint;
BEGIN
  SELECT count(*) INTO missing_owner
  FROM rider_identity_candidates c
  LEFT JOIN "User" u ON u.id = c.user_id
  WHERE c.user_id IS NULL OR u.id IS NULL;

  SELECT count(*) INTO client_mismatch
  FROM rider_identity_candidates c
  JOIN "User" u ON u.id = c.user_id
  WHERE u."clientId" IS DISTINCT FROM c.client_id;

  SELECT count(*) INTO owner_conflicts
  FROM (
    SELECT client_id, user_id, kind
    FROM rider_identity_candidates
    WHERE user_id IS NOT NULL
    GROUP BY client_id, user_id, kind
    HAVING count(DISTINCT value) > 1
  ) conflicts;

  SELECT count(*) INTO cross_user_conflicts
  FROM (
    SELECT client_id, kind, value
    FROM rider_identity_candidates
    WHERE user_id IS NOT NULL
    GROUP BY client_id, kind, value
    HAVING count(DISTINCT user_id) > 1
  ) conflicts;

  IF missing_owner > 0 OR client_mismatch > 0 OR owner_conflicts > 0 OR cross_user_conflicts > 0 THEN
    RAISE EXCEPTION
      'Rider identity claim preflight failed: missing_owner=%, client_mismatch=%, owner_conflicts=%, cross_user_conflicts=%',
      missing_owner, client_mismatch, owner_conflicts, cross_user_conflicts;
  END IF;
END $$;

CREATE TABLE "RiderIdentityClaim" (
  "clientId" text NOT NULL,
  "userId" text NOT NULL,
  "aadhaarNumber" text,
  "panNumber" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "RiderIdentityClaim_pkey" PRIMARY KEY ("clientId", "userId"),
  CONSTRAINT "rider_identity_claim_client_aadhaar_unique" UNIQUE ("clientId", "aadhaarNumber"),
  CONSTRAINT "rider_identity_claim_client_pan_unique" UNIQUE ("clientId", "panNumber")
);

ALTER TABLE "RiderIdentityClaim"
  ADD CONSTRAINT "RiderIdentityClaim_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RiderIdentityClaim"
  ADD CONSTRAINT "RiderIdentityClaim_clientId_userId_fkey"
  FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "RiderIdentityClaim" ("clientId", "userId", "aadhaarNumber", "panNumber", "createdAt", "updatedAt")
SELECT client_id, user_id,
  max(value) FILTER (WHERE kind = 'AADHAAR'),
  max(value) FILTER (WHERE kind = 'PAN'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM rider_identity_candidates
GROUP BY client_id, user_id;

-- Completed progress is a historical snapshot. Before delta-based triggers are
-- installed, make rows with a current Rider match that Rider identity so an
-- explicit mobile save cannot look unchanged against stale JSON. Rows without
-- a current Rider remain untouched historical data.
WITH completed_progress_identity AS (
  SELECT
    p.id,
    COALESCE(NULLIF(btrim(r.metadata->>'aadhaarNumber'), ''), '') AS aadhaar_number,
    COALESCE(NULLIF(upper(btrim(r.metadata->>'panNumber')), ''), '') AS pan_number
  FROM "RiderOnboardingProgress" p
  JOIN "Rider" r
    ON r."clientId" = p."clientId" AND r."userId" = p."userId"
  WHERE p."completedAt" IS NOT NULL
)
UPDATE "RiderOnboardingProgress" p
SET "values" = jsonb_set(
  jsonb_set(
    CASE WHEN jsonb_typeof(p."values") = 'object' THEN p."values" ELSE '{}'::jsonb END,
    '{AADHAAR_NUMBER}', to_jsonb(c.aadhaar_number), true
  ),
  '{PAN_NUMBER}', to_jsonb(c.pan_number), true
),
"updatedAt" = CURRENT_TIMESTAMP
FROM completed_progress_identity c
WHERE p.id = c.id;

CREATE OR REPLACE FUNCTION rider_identity_canonical(value text, kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(CASE WHEN kind = 'PAN' THEN upper(btrim(value)) ELSE btrim(value) END, '')
$$;

CREATE OR REPLACE FUNCTION rider_identity_claim_upsert(
  claim_client_id text,
  claim_user_id text,
  claim_aadhaar text,
  claim_pan text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF claim_user_id IS NULL OR (claim_aadhaar IS NULL AND claim_pan IS NULL) THEN
    RETURN;
  END IF;

  INSERT INTO "RiderIdentityClaim" ("clientId", "userId", "aadhaarNumber", "panNumber", "createdAt", "updatedAt")
  VALUES (claim_client_id, claim_user_id, claim_aadhaar, claim_pan, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("clientId", "userId") DO UPDATE SET
    "aadhaarNumber" = COALESCE(EXCLUDED."aadhaarNumber", "RiderIdentityClaim"."aadhaarNumber"),
    "panNumber" = COALESCE(EXCLUDED."panNumber", "RiderIdentityClaim"."panNumber"),
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE FUNCTION rider_identity_normalize_rider_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized jsonb;
  value text;
BEGIN
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    RETURN NEW;
  END IF;
  normalized := NEW.metadata;
  IF normalized ? 'aadhaarNumber' THEN
    value := rider_identity_canonical(normalized->>'aadhaarNumber', 'AADHAAR');
    normalized := jsonb_set(normalized, '{aadhaarNumber}', to_jsonb(COALESCE(value, '')), true);
  END IF;
  IF normalized ? 'panNumber' THEN
    value := rider_identity_canonical(normalized->>'panNumber', 'PAN');
    normalized := jsonb_set(normalized, '{panNumber}', to_jsonb(COALESCE(value, '')), true);
  END IF;
  NEW.metadata := normalized;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rider_identity_normalize_progress_values()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized jsonb;
  value text;
BEGIN
  IF NEW."values" IS NULL OR jsonb_typeof(NEW."values") <> 'object' THEN
    RETURN NEW;
  END IF;
  normalized := NEW."values";
  IF normalized ? 'AADHAAR_NUMBER' THEN
    value := rider_identity_canonical(normalized->>'AADHAAR_NUMBER', 'AADHAAR');
    normalized := jsonb_set(normalized, '{AADHAAR_NUMBER}', to_jsonb(COALESCE(value, '')), true);
  END IF;
  IF normalized ? 'PAN_NUMBER' THEN
    value := rider_identity_canonical(normalized->>'PAN_NUMBER', 'PAN');
    normalized := jsonb_set(normalized, '{PAN_NUMBER}', to_jsonb(COALESCE(value, '')), true);
  END IF;
  NEW."values" := normalized;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rider_identity_sync_from_rider()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_aadhaar text;
  old_pan text;
  new_aadhaar text;
  new_pan text;
  claim_aadhaar text;
  claim_pan text;
  progress_values jsonb;
BEGIN
  old_aadhaar := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE rider_identity_canonical(OLD.metadata->>'aadhaarNumber', 'AADHAAR') END;
  old_pan := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE rider_identity_canonical(OLD.metadata->>'panNumber', 'PAN') END;
  new_aadhaar := rider_identity_canonical(NEW.metadata->>'aadhaarNumber', 'AADHAAR');
  new_pan := rider_identity_canonical(NEW.metadata->>'panNumber', 'PAN');

  IF NEW."userId" IS NULL THEN
    IF new_aadhaar IS NOT NULL OR new_pan IS NOT NULL THEN
      RAISE EXCEPTION 'Rider identity requires a linked user.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR new_aadhaar IS DISTINCT FROM old_aadhaar THEN
    claim_aadhaar := new_aadhaar;
  END IF;
  IF TG_OP = 'INSERT' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR new_pan IS DISTINCT FROM old_pan THEN
    claim_pan := new_pan;
  END IF;

  IF claim_aadhaar IS NULL AND claim_pan IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM rider_identity_claim_upsert(NEW."clientId", NEW."userId", claim_aadhaar, claim_pan);

  SELECT p."values" INTO progress_values
  FROM "RiderOnboardingProgress" p
  WHERE p."clientId" = NEW."clientId" AND p."userId" = NEW."userId"
  FOR UPDATE;
  IF FOUND THEN
    progress_values := COALESCE(progress_values, '{}'::jsonb);
    IF claim_aadhaar IS NOT NULL THEN progress_values := jsonb_set(progress_values, '{AADHAAR_NUMBER}', to_jsonb(claim_aadhaar), true); END IF;
    IF claim_pan IS NOT NULL THEN progress_values := jsonb_set(progress_values, '{PAN_NUMBER}', to_jsonb(claim_pan), true); END IF;
    UPDATE "RiderOnboardingProgress"
    SET "values" = progress_values, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "clientId" = NEW."clientId" AND "userId" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rider_identity_sync_from_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_aadhaar text;
  old_pan text;
  new_aadhaar text;
  new_pan text;
  changed_aadhaar text;
  changed_pan text;
  rider_metadata jsonb;
  rider_updated bigint;
BEGIN
  old_aadhaar := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE rider_identity_canonical(OLD."values"->>'AADHAAR_NUMBER', 'AADHAAR') END;
  old_pan := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE rider_identity_canonical(OLD."values"->>'PAN_NUMBER', 'PAN') END;
  new_aadhaar := rider_identity_canonical(NEW."values"->>'AADHAAR_NUMBER', 'AADHAAR');
  new_pan := rider_identity_canonical(NEW."values"->>'PAN_NUMBER', 'PAN');

  IF TG_OP = 'INSERT' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR new_aadhaar IS DISTINCT FROM old_aadhaar THEN
    changed_aadhaar := new_aadhaar;
  END IF;
  IF TG_OP = 'INSERT' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR new_pan IS DISTINCT FROM old_pan THEN
    changed_pan := new_pan;
  END IF;

  IF changed_aadhaar IS NULL AND changed_pan IS NULL THEN
    RETURN NEW;
  END IF;

  rider_metadata := NULL;
  SELECT r.metadata INTO rider_metadata
  FROM "Rider" r
  WHERE r."clientId" = NEW."clientId" AND r."userId" = NEW."userId"
  FOR UPDATE;
  IF FOUND THEN
    rider_metadata := CASE WHEN jsonb_typeof(rider_metadata) = 'object' THEN rider_metadata ELSE '{}'::jsonb END;
    IF changed_aadhaar IS NOT NULL THEN rider_metadata := jsonb_set(rider_metadata, '{aadhaarNumber}', to_jsonb(changed_aadhaar), true); END IF;
    IF changed_pan IS NOT NULL THEN rider_metadata := jsonb_set(rider_metadata, '{panNumber}', to_jsonb(changed_pan), true); END IF;
    UPDATE "Rider"
    SET metadata = rider_metadata, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "clientId" = NEW."clientId" AND "userId" = NEW."userId";
    GET DIAGNOSTICS rider_updated = ROW_COUNT;
  ELSE
    rider_updated := 0;
  END IF;

  IF rider_updated = 0 THEN
    PERFORM rider_identity_claim_upsert(NEW."clientId", NEW."userId", changed_aadhaar, changed_pan);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rider_identity_normalize_metadata
BEFORE INSERT OR UPDATE OF metadata ON "Rider"
FOR EACH ROW EXECUTE FUNCTION rider_identity_normalize_rider_metadata();

CREATE TRIGGER rider_identity_sync_rider
AFTER INSERT OR UPDATE OF metadata, "clientId", "userId" ON "Rider"
FOR EACH ROW EXECUTE FUNCTION rider_identity_sync_from_rider();

CREATE TRIGGER rider_identity_normalize_values
BEFORE INSERT OR UPDATE OF "values" ON "RiderOnboardingProgress"
FOR EACH ROW EXECUTE FUNCTION rider_identity_normalize_progress_values();

CREATE TRIGGER rider_identity_sync_progress
AFTER INSERT OR UPDATE OF "values", "clientId", "userId" ON "RiderOnboardingProgress"
FOR EACH ROW EXECUTE FUNCTION rider_identity_sync_from_progress();

COMMIT;
