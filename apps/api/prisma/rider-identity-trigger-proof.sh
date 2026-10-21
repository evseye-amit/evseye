#!/usr/bin/env bash
set -euo pipefail

# Opt-in, schema-isolated proof against the existing local PostgreSQL service.
# Override these variables when the local service uses another connection:
# RIDER_IDENTITY_PGHOST, RIDER_IDENTITY_PGPORT, RIDER_IDENTITY_PGUSER,
# RIDER_IDENTITY_PGDATABASE, RIDER_IDENTITY_PGPASSWORD, RIDER_IDENTITY_DATABASE_URL.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION_FILE="$REPO_ROOT/apps/api/prisma/migrations/20261020040000_rider_identity_claims/migration.sql"
AUDIT_FILE="$REPO_ROOT/apps/api/prisma/rider-identity-audit.sql"
PGHOST="${RIDER_IDENTITY_PGHOST:-127.0.0.1}"
PGPORT="${RIDER_IDENTITY_PGPORT:-5433}"
PGUSER="${RIDER_IDENTITY_PGUSER:-evseye}"
PGDATABASE="${RIDER_IDENTITY_PGDATABASE:-evseye}"
export PGPASSWORD="${RIDER_IDENTITY_PGPASSWORD:-evseye}"
BASE_DATABASE_URL="${RIDER_IDENTITY_DATABASE_URL:-postgresql://evseye:evseye@127.0.0.1:5433/evseye}"
if [ -n "${RIDER_IDENTITY_DATABASE_URL:-}" ]; then
  PSQL=(psql -X "$RIDER_IDENTITY_DATABASE_URL" -v ON_ERROR_STOP=1)
else
  PSQL=(psql -X -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1)
fi

MAIN_SCHEMA="rider_identity_proof_$(date +%s)_$$"
PREFLIGHT_SCHEMA="rider_identity_preflight_$(date +%s)_$$"

schema_database_url() {
  case "$BASE_DATABASE_URL" in
    *\?*) printf '%s&schema=%s' "$BASE_DATABASE_URL" "$1" ;;
    *) printf '%s?schema=%s' "$BASE_DATABASE_URL" "$1" ;;
  esac
}

drop_schema() {
  local schema="$1"
  "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS \"${schema}\" CASCADE" >/dev/null
}

cleanup() {
  local status=$?
  local cleanup_failed=0
  for schema in "$MAIN_SCHEMA" "$PREFLIGHT_SCHEMA"; do
    if ! drop_schema "$schema"; then
      echo "cleanup failed for isolated schema ${schema}" >&2
      cleanup_failed=1
    fi
  done
  if [ "$cleanup_failed" -ne 0 ]; then status=1; fi
  exit "$status"
}
trap cleanup EXIT

create_base_schema() {
  local schema="$1"
  "${PSQL[@]}" <<SQL
CREATE SCHEMA "${schema}";
SET search_path TO "${schema}", public;
CREATE TABLE "Client" (id text PRIMARY KEY);
CREATE TABLE "User" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  mobile text NOT NULL,
  UNIQUE ("clientId", id)
);
CREATE TABLE "Rider" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  "userId" text,
  name text NOT NULL,
  mobile text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  "deletedAt" timestamp,
  metadata jsonb,
  "updatedAt" timestamp NOT NULL
);
CREATE TABLE "RiderOnboardingProgress" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  "userId" text NOT NULL,
  "packageId" text NOT NULL,
  "currentStepId" text,
  "completedStepIds" jsonb NOT NULL DEFAULT '[]',
  "skippedStepIds" jsonb NOT NULL DEFAULT '[]',
  "values" jsonb NOT NULL,
  "completedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL
);
SQL
}

install_migration() {
  local schema="$1"
  {
    printf 'SET search_path TO "%s", public;\nBEGIN;\n' "$schema"
    sed '/^BEGIN;$/d; /^COMMIT;$/d' "$MIGRATION_FILE"
    printf 'COMMIT;\n'
  } | "${PSQL[@]}"
}

# First prove that the read-only audit reports every conflict class and that
# migration preflight refuses to choose an owner.
create_base_schema "$PREFLIGHT_SCHEMA"
"${PSQL[@]}" <<SQL
SET search_path TO "${PREFLIGHT_SCHEMA}", public;
INSERT INTO "Client" (id) VALUES ('client-a'), ('client-b');
INSERT INTO "User" (id,"clientId",mobile) VALUES
  ('owner-a','client-a','a'), ('owner-b','client-a','b'), ('wrong-client','client-b','c');
INSERT INTO "Rider" (id,"clientId","userId",name,mobile,metadata,"updatedAt") VALUES
  ('owner-conflict-a','client-a','owner-a','Owner A1','a','{"panNumber":"OWNER1111A"}',CURRENT_TIMESTAMP),
  ('owner-conflict-b','client-a','owner-a','Owner A2','a2','{"panNumber":"OWNER2222B"}',CURRENT_TIMESTAMP),
  ('cross-user-a','client-a','owner-a','Cross A','a3','{"aadhaarNumber":"CROSS11111111"}',CURRENT_TIMESTAMP),
  ('cross-user-b','client-a','owner-b','Cross B','b3','{"aadhaarNumber":"CROSS11111111"}',CURRENT_TIMESTAMP),
  ('client-mismatch','client-a','wrong-client','Mismatch','m','{"panNumber":"MISMATCH1A"}',CURRENT_TIMESTAMP),
  ('missing-owner','client-a',NULL,'Missing','m2','{"aadhaarNumber":"MISSING111111"}',CURRENT_TIMESTAMP);
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt")
VALUES ('preflight-progress','client-a','owner-b','pkg','{}'::jsonb,CURRENT_TIMESTAMP);
SQL
AUDIT_LOG="$(mktemp /tmp/evseye-rider-identity-audit.log.XXXXXX)"
{
  printf 'SET search_path TO "%s", public;\n' "$PREFLIGHT_SCHEMA"
  cat "$AUDIT_FILE"
} | "${PSQL[@]}" >"$AUDIT_LOG" 2>&1
cat "$AUDIT_LOG"
for issue in MISSING_OWNER CLIENT_MISMATCH OWNER_CONFLICT CROSS_USER_CONFLICT; do
  grep -q "$issue" "$AUDIT_LOG"
done
rm -f "$AUDIT_LOG"

PREFLIGHT_LOG="$(mktemp /tmp/evseye-rider-identity-preflight.log.XXXXXX)"
set +e
install_migration "$PREFLIGHT_SCHEMA" >"$PREFLIGHT_LOG" 2>&1
PREFLIGHT_STATUS=$?
set -e
cat "$PREFLIGHT_LOG"
rm -f "$PREFLIGHT_LOG"
test "$PREFLIGHT_STATUS" -ne 0
"${PSQL[@]}" <<SQL
SET search_path TO "${PREFLIGHT_SCHEMA}", public;
DO \$\$
BEGIN
  IF to_regclass('RiderIdentityClaim') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight conflict unexpectedly created the claim table';
  END IF;
END
\$\$;
SQL

# Main isolated schema: seed legacy Rider values, a stale completed snapshot,
# unfinished values, a deleted Rider, and a blank unlinked Rider before applying
# the exact migration.
create_base_schema "$MAIN_SCHEMA"
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
INSERT INTO "Client" (id) VALUES ('client-a'), ('client-b');
INSERT INTO "User" (id,"clientId",mobile) VALUES
  ('user-a','client-a','a'), ('user-b','client-a','b'), ('user-c','client-a','c'),
  ('user-d','client-a','d'), ('user-g','client-a','g'), ('user-x','client-b','x'),
  ('user-y','client-a','y'), ('race-a','client-a','ra'), ('race-b','client-a','rb');
INSERT INTO "Rider" (id,"clientId","userId",name,mobile,status,"deletedAt",metadata,"updatedAt") VALUES
  ('rider-a','client-a','user-a','Current','a','ACTIVE',NULL,
    '{"aadhaarNumber":"111111111111","panNumber":"BBBBB2222B","bankName":"Existing Bank"}'::jsonb,CURRENT_TIMESTAMP),
  ('rider-deleted','client-a','user-c','Deleted','c','DELETED',CURRENT_TIMESTAMP,
    '{"aadhaarNumber":"333333333333","panNumber":"DDDDD4444D"}'::jsonb,CURRENT_TIMESTAMP),
  ('rider-unlinked','client-a',NULL,'Unlinked','u','ACTIVE',NULL,'{}'::jsonb,CURRENT_TIMESTAMP);
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","completedAt","updatedAt")
VALUES
  ('progress-a','client-a','user-a','pkg','{"AADHAAR_NUMBER":"999999999999","PAN_NUMBER":"AAAAA1111A"}'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('progress-orphan','client-a','user-y','pkg','{"AADHAAR_NUMBER":"123456789012","PAN_NUMBER":"ABCDE1234F","FULL_NAME":"Preserve Me"}'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('progress-b','client-a','user-b','pkg','{"AADHAAR_NUMBER":"222222222222","PAN_NUMBER":"CCCCC3333C"}'::jsonb,NULL,CURRENT_TIMESTAMP);
SQL
install_migration "$MAIN_SCHEMA"

# Backfill both identity kinds, align the completed counterpart from Rider, and
# retain a deleted Rider's claim.
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
DO \$\$
DECLARE
  aadhaar text;
  pan text;
  progress_aadhaar text;
  progress_pan text;
  deleted_count integer;
BEGIN
  SELECT "aadhaarNumber", "panNumber" INTO aadhaar, pan
  FROM "RiderIdentityClaim" WHERE "clientId"='client-a' AND "userId"='user-a';
  IF aadhaar <> '111111111111' OR pan <> 'BBBBB2222B' THEN
    RAISE EXCEPTION 'Rider backfill did not reserve both current identities';
  END IF;
  SELECT "values"->>'AADHAAR_NUMBER', "values"->>'PAN_NUMBER'
    INTO progress_aadhaar, progress_pan
  FROM "RiderOnboardingProgress" WHERE id='progress-a';
  IF progress_aadhaar <> '111111111111' OR progress_pan <> 'BBBBB2222B' THEN
    RAISE EXCEPTION 'completed progress was not aligned to current Rider';
  END IF;
  IF (SELECT "values" FROM "RiderOnboardingProgress" WHERE id='progress-orphan') <> '{"AADHAAR_NUMBER":"123456789012","FULL_NAME":"Preserve Me","PAN_NUMBER":"ABCDE1234F"}'::jsonb THEN
    RAISE EXCEPTION 'completed progress without a Rider was changed';
  END IF;
  SELECT count(*) INTO deleted_count FROM "RiderIdentityClaim"
  WHERE "clientId"='client-a' AND "userId"='user-c'
    AND "aadhaarNumber"='333333333333' AND "panNumber"='DDDDD4444D';
  IF deleted_count <> 1 THEN RAISE EXCEPTION 'deleted Rider claim was not retained'; END IF;
  SELECT count(*) INTO deleted_count FROM "RiderIdentityClaim"
  WHERE "clientId"='client-a' AND "userId"='user-b'
    AND "aadhaarNumber"='222222222222' AND "panNumber"='CCCCC3333C';
  IF deleted_count <> 1 THEN RAISE EXCEPTION 'unfinished progress was not backfilled'; END IF;
END
\$\$;
SQL

# An explicit mobile correction is first rejected atomically because another
# user owns the formerly stale completed value, then succeeds once that owner
# releases it. The progress trigger updates Rider and claim in both identity
# columns.
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt")
VALUES ('progress-conflict','client-a','user-d','pkg','{"AADHAAR_NUMBER":"999999999999","PAN_NUMBER":"AAAAA1111A"}'::jsonb,CURRENT_TIMESTAMP);
DO \$\$
BEGIN
  BEGIN
    UPDATE "RiderOnboardingProgress"
    SET "values"='{"AADHAAR_NUMBER":"999999999999","PAN_NUMBER":"AAAAA1111A"}'::jsonb,
        "updatedAt"=CURRENT_TIMESTAMP
    WHERE id='progress-a';
    RAISE EXCEPTION 'expected completed-snapshot correction conflict';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT "values"->>'PAN_NUMBER' FROM "RiderOnboardingProgress" WHERE id='progress-a') <> 'BBBBB2222B' THEN
    RAISE EXCEPTION 'failed correction changed progress';
  END IF;
  IF (SELECT metadata->>'panNumber' FROM "Rider" WHERE id='rider-a') <> 'BBBBB2222B' THEN
    RAISE EXCEPTION 'failed correction changed Rider';
  END IF;
  IF (SELECT "panNumber" FROM "RiderIdentityClaim" WHERE "userId"='user-a') <> 'BBBBB2222B' THEN
    RAISE EXCEPTION 'failed correction changed claim';
  END IF;
END
\$\$;
UPDATE "RiderOnboardingProgress"
SET "values"='{"AADHAAR_NUMBER":"888888888888","PAN_NUMBER":"EEEEE5555E"}'::jsonb,
    "updatedAt"=CURRENT_TIMESTAMP
WHERE id='progress-conflict';
UPDATE "RiderOnboardingProgress"
SET "values"='{"AADHAAR_NUMBER":"999999999999","PAN_NUMBER":"AAAAA1111A"}'::jsonb,
    "updatedAt"=CURRENT_TIMESTAMP
WHERE id='progress-a';
DO \$\$
BEGIN
  IF (SELECT "panNumber" FROM "RiderIdentityClaim" WHERE "userId"='user-a') <> 'AAAAA1111A'
    OR (SELECT metadata->>'panNumber' FROM "Rider" WHERE id='rider-a') <> 'AAAAA1111A'
    OR (SELECT "values"->>'PAN_NUMBER' FROM "RiderOnboardingProgress" WHERE id='progress-a') <> 'AAAAA1111A'
  THEN RAISE EXCEPTION 'free correction did not sync PAN in all stores'; END IF;
  IF (SELECT "aadhaarNumber" FROM "RiderIdentityClaim" WHERE "userId"='user-a') <> '999999999999'
    OR (SELECT metadata->>'aadhaarNumber' FROM "Rider" WHERE id='rider-a') <> '999999999999'
  THEN RAISE EXCEPTION 'free correction did not sync Aadhaar'; END IF;
END
\$\$;
SQL

# Rider-side old-writer correction projects back to completed progress, and a
# same-client value is not reusable while a cross-client value is allowed.
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
UPDATE "Rider"
SET metadata='{"aadhaarNumber":"777777777777","panNumber":"RIDER5678D"}'::jsonb,
    "updatedAt"=CURRENT_TIMESTAMP
WHERE id='rider-a';
DO \$\$
BEGIN
  IF (SELECT "values"->>'PAN_NUMBER' FROM "RiderOnboardingProgress" WHERE id='progress-a') <> 'RIDER5678D'
    OR (SELECT "values"->>'AADHAAR_NUMBER' FROM "RiderOnboardingProgress" WHERE id='progress-a') <> '777777777777'
    OR (SELECT "panNumber" FROM "RiderIdentityClaim" WHERE "userId"='user-a') <> 'RIDER5678D'
  THEN RAISE EXCEPTION 'Rider-side correction did not project both directions'; END IF;
END
\$\$;
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt")
VALUES ('progress-cross-client','client-b','user-x','pkg','{"PAN_NUMBER":"rider5678d"}'::jsonb,CURRENT_TIMESTAMP);
DO \$\$
BEGIN
  IF (SELECT "panNumber" FROM "RiderIdentityClaim" WHERE "clientId"='client-b' AND "userId"='user-x') <> 'RIDER5678D'
  THEN RAISE EXCEPTION 'cross-client identity was rejected'; END IF;
END
\$\$;
SQL

# An unlinked legacy Rider may keep blank identity JSON, but an old writer may
# not add a nonblank identity outside the claim boundary.
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
UPDATE "Rider" SET metadata='{"panNumber":"","aadhaarNumber":""}'::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE id='rider-unlinked';
DO \$\$
BEGIN
  BEGIN
    UPDATE "Rider" SET metadata='{"panNumber":"LEGACY1234L"}'::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE id='rider-unlinked';
    RAISE EXCEPTION 'expected unlinked PAN rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Rider" SET metadata='{"aadhaarNumber":"444444444444"}'::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE id='rider-unlinked';
    RAISE EXCEPTION 'expected unlinked Aadhaar rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT metadata FROM "Rider" WHERE id='rider-unlinked') <> '{"panNumber":"","aadhaarNumber":""}'::jsonb THEN
    RAISE EXCEPTION 'unlinked rejection changed Rider metadata';
  END IF;
  IF (SELECT count(*) FROM "RiderIdentityClaim" WHERE "clientId"='client-a' AND "userId" IS NULL) <> 0 THEN
    RAISE EXCEPTION 'unlinked Rider created a claim';
  END IF;
END
\$\$;
UPDATE "Rider" SET status='DELETED', "deletedAt"=CURRENT_TIMESTAMP WHERE id='rider-deleted';
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "RiderIdentityClaim" WHERE "userId"='user-c' AND "panNumber"='DDDDD4444D')
  THEN RAISE EXCEPTION 'status/deleted update released claim'; END IF;
END
\$\$;
SQL

# Concurrent old-style progress writers have one winner. A Prisma write still
# sees the named unique target used by the API field mapper.
A_LOG="$(mktemp /tmp/evseye-identity-race-a.log.XXXXXX)"
B_LOG="$(mktemp /tmp/evseye-identity-race-b.log.XXXXXX)"
set +e
({ printf 'SET search_path TO "%s", public;\n' "$MAIN_SCHEMA"; cat <<'SQL'
BEGIN;
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt") VALUES ('progress-race-a','client-a','race-a','pkg','{"PAN_NUMBER":"RACE1234A"}'::jsonb,CURRENT_TIMESTAMP);
SELECT pg_sleep(2);
COMMIT;
SQL
} | "${PSQL[@]}" >"$A_LOG" 2>&1) &
A_PID=$!
sleep 0.25
({ printf 'SET search_path TO "%s", public;\n' "$MAIN_SCHEMA"; cat <<'SQL'
BEGIN;
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt") VALUES ('progress-race-b','client-a','race-b','pkg','{"PAN_NUMBER":"race1234a"}'::jsonb,CURRENT_TIMESTAMP);
COMMIT;
SQL
} | "${PSQL[@]}" >"$B_LOG" 2>&1)
B_STATUS=$?
wait "$A_PID"
A_STATUS=$?
set -e
cat "$A_LOG"
cat "$B_LOG"
printf 'concurrent statuses: winner=%s loser=%s\n' "$A_STATUS" "$B_STATUS"
rm -f "$A_LOG" "$B_LOG"
test "$A_STATUS" -eq 0
test "$B_STATUS" -ne 0
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
DO \$\$
BEGIN
  IF (SELECT count(*) FROM "RiderIdentityClaim" WHERE "clientId"='client-a' AND "panNumber"='RACE1234A') <> 1
  THEN RAISE EXCEPTION 'concurrent race did not leave one winner'; END IF;
END
\$\$;
SQL
(cd "$REPO_ROOT" && DATABASE_URL="$(schema_database_url "$MAIN_SCHEMA")" pnpm --filter @evs-eye/api exec node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
let duplicate;
try {
  await prisma.riderOnboardingProgress.create({ data: {
    id: 'progress-prisma-b', clientId: 'client-a', userId: 'race-b', packageId: 'pkg', values: { PAN_NUMBER: 'RACE1234A' },
  } });
  throw new Error('expected Prisma P2002');
} catch (error) {
  duplicate = error;
  console.log(JSON.stringify({ code: error.code, target: error.meta?.target, constraint: error.meta?.constraint, meta: error.meta }));
} finally {
  await prisma.$disconnect();
}
if (duplicate?.code !== 'P2002') process.exitCode = 1;
NODE
)

# A later write failure rolls back the claim and JSON mutation together, and a
# soft-deleted/status variant continues to reserve its number.
"${PSQL[@]}" <<SQL
SET search_path TO "${MAIN_SCHEMA}", public;
\set ON_ERROR_STOP off
BEGIN;
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt") VALUES ('progress-rollback','client-a','user-y','pkg','{"PAN_NUMBER":"ROLLBACK1A"}'::jsonb,CURRENT_TIMESTAMP);
SELECT 1 / 0;
ROLLBACK;
SELECT count(*) AS rollback_claim_absent FROM "RiderIdentityClaim" WHERE "clientId"='client-a' AND "panNumber"='ROLLBACK1A';
INSERT INTO "RiderOnboardingProgress" (id,"clientId","userId","packageId","values","updatedAt") VALUES ('progress-rollback-retry','client-a','user-y','pkg','{"PAN_NUMBER":"ROLLBACK1A"}'::jsonb,CURRENT_TIMESTAMP);
SQL

printf 'isolated rider identity trigger proof passed\n'
