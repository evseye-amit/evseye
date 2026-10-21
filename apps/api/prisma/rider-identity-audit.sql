-- Read-only preflight for the rider identity claim migration.
-- Run with psql against the target database. It never writes application tables.
BEGIN READ ONLY;

WITH candidate_rows AS (
  SELECT
    'RIDER'::text AS source,
    r.id::text AS source_id,
    r."clientId" AS client_id,
    r."userId" AS user_id,
    identity.kind,
    CASE WHEN identity.kind = 'PAN' THEN upper(btrim(r.metadata->>identity.key))
         ELSE btrim(r.metadata->>identity.key) END AS value
  FROM "Rider" r
  CROSS JOIN (VALUES ('AADHAAR', 'aadhaarNumber'), ('PAN', 'panNumber')) AS identity(kind, key)
  WHERE r.metadata IS NOT NULL
    AND NULLIF(btrim(r.metadata->>identity.key), '') IS NOT NULL

  UNION ALL

  SELECT
    'RIDER_ONBOARDING_PROGRESS'::text,
    p.id::text,
    p."clientId",
    p."userId",
    identity.kind,
    CASE WHEN identity.kind = 'PAN' THEN upper(btrim(p."values"->>identity.key))
         ELSE btrim(p."values"->>identity.key) END
  FROM "RiderOnboardingProgress" p
  CROSS JOIN (VALUES ('AADHAAR', 'AADHAAR_NUMBER'), ('PAN', 'PAN_NUMBER')) AS identity(kind, key)
  WHERE p."completedAt" IS NULL
    AND p."values" IS NOT NULL
    AND NULLIF(btrim(p."values"->>identity.key), '') IS NOT NULL
), owner_conflicts AS (
  SELECT client_id, user_id, kind
  FROM candidate_rows
  WHERE user_id IS NOT NULL
  GROUP BY client_id, user_id, kind
  HAVING count(DISTINCT value) > 1
), cross_user_conflicts AS (
  SELECT client_id, kind, value
  FROM candidate_rows
  WHERE user_id IS NOT NULL
  GROUP BY client_id, kind, value
  HAVING count(DISTINCT user_id) > 1
), annotated AS (
  SELECT
    c.*,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.user_id IS NULL OR u.id IS NULL THEN 'MISSING_OWNER'::text END,
      CASE WHEN c.user_id IS NOT NULL AND u."clientId" IS DISTINCT FROM c.client_id THEN 'CLIENT_MISMATCH'::text END,
      CASE WHEN oc.user_id IS NOT NULL THEN 'OWNER_CONFLICT'::text END,
      CASE WHEN xuc.value IS NOT NULL THEN 'CROSS_USER_CONFLICT'::text END
    ], NULL) AS issues
  FROM candidate_rows c
  LEFT JOIN "User" u ON u.id = c.user_id
  LEFT JOIN owner_conflicts oc
    ON oc.client_id = c.client_id AND oc.user_id = c.user_id AND oc.kind = c.kind
  LEFT JOIN cross_user_conflicts xuc
    ON xuc.client_id = c.client_id AND xuc.kind = c.kind AND xuc.value = c.value
)
SELECT issue, count(*) AS candidate_rows
FROM annotated a
CROSS JOIN LATERAL unnest(CASE WHEN cardinality(a.issues) = 0 THEN ARRAY['OK'::text] ELSE a.issues END) AS issue
GROUP BY issue
ORDER BY issue;

WITH candidate_rows AS (
  SELECT 'RIDER'::text AS source, r.id::text AS source_id, r."clientId" AS client_id,
    r."userId" AS user_id, identity.kind,
    CASE WHEN identity.kind = 'PAN' THEN upper(btrim(r.metadata->>identity.key)) ELSE btrim(r.metadata->>identity.key) END AS value
  FROM "Rider" r
  CROSS JOIN (VALUES ('AADHAAR', 'aadhaarNumber'), ('PAN', 'panNumber')) AS identity(kind, key)
  WHERE r.metadata IS NOT NULL AND NULLIF(btrim(r.metadata->>identity.key), '') IS NOT NULL
  UNION ALL
  SELECT 'RIDER_ONBOARDING_PROGRESS', p.id::text, p."clientId", p."userId", identity.kind,
    CASE WHEN identity.kind = 'PAN' THEN upper(btrim(p."values"->>identity.key)) ELSE btrim(p."values"->>identity.key) END
  FROM "RiderOnboardingProgress" p
  CROSS JOIN (VALUES ('AADHAAR', 'AADHAAR_NUMBER'), ('PAN', 'PAN_NUMBER')) AS identity(kind, key)
  WHERE p."completedAt" IS NULL AND p."values" IS NOT NULL
    AND NULLIF(btrim(p."values"->>identity.key), '') IS NOT NULL
), owner_conflicts AS (
  SELECT client_id, user_id, kind FROM candidate_rows
  WHERE user_id IS NOT NULL GROUP BY client_id, user_id, kind HAVING count(DISTINCT value) > 1
), cross_user_conflicts AS (
  SELECT client_id, kind, value FROM candidate_rows
  WHERE user_id IS NOT NULL GROUP BY client_id, kind, value HAVING count(DISTINCT user_id) > 1
)
SELECT c.source, c.source_id, c.client_id, c.user_id, c.kind,
  CASE WHEN length(c.value) <= 4 THEN repeat('*', length(c.value))
       ELSE left(c.value, 2) || repeat('*', length(c.value) - 4) || right(c.value, 2)
  END AS masked_value,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN c.user_id IS NULL OR u.id IS NULL THEN 'MISSING_OWNER'::text END,
    CASE WHEN c.user_id IS NOT NULL AND u."clientId" IS DISTINCT FROM c.client_id THEN 'CLIENT_MISMATCH'::text END,
    CASE WHEN oc.user_id IS NOT NULL THEN 'OWNER_CONFLICT'::text END,
    CASE WHEN xuc.value IS NOT NULL THEN 'CROSS_USER_CONFLICT'::text END
  ], NULL) AS issues
FROM candidate_rows c
LEFT JOIN "User" u ON u.id = c.user_id
LEFT JOIN owner_conflicts oc ON oc.client_id = c.client_id AND oc.user_id = c.user_id AND oc.kind = c.kind
LEFT JOIN cross_user_conflicts xuc ON xuc.client_id = c.client_id AND xuc.kind = c.kind AND xuc.value = c.value
WHERE c.user_id IS NULL OR u.id IS NULL OR u."clientId" IS DISTINCT FROM c.client_id
   OR oc.user_id IS NOT NULL OR xuc.value IS NOT NULL
ORDER BY c.client_id, c.kind, c.source, c.source_id;

COMMIT;
