# Rider Aadhaar and PAN uniqueness rollout

## Scope

`RiderIdentityClaim` stores one row per client/user with nullable Aadhaar and
PAN columns. Named per-client unique constraints reserve each non-empty value.
The reservation is owned by the linked Rider user, so unfinished onboarding and
all Rider statuses, including soft-deleted Riders, remain reserved. A valid
correction replaces the owner's old claim in the same transaction as the JSON
profile/progress write.

Mobile-number uniqueness is unchanged.

## Preflight

1. Run `apps/api/prisma/rider-identity-audit.sql` with a read-only database
   account. The report masks values and includes source IDs for reconciliation.
2. Resolve every `MISSING_OWNER`, `CLIENT_MISMATCH`, `OWNER_CONFLICT`, and
   `CROSS_USER_CONFLICT` from the report without choosing an owner or deleting
   a record. The migration also fails closed with these counts if any remain.

The migration locks `Rider`, `RiderOnboardingProgress`, and `User` while it
audits and backfills. This is the writer boundary; do not add a manual drain.
Before the triggers are enabled, completed-progress identity keys are aligned
only when a current linked Rider provides the authoritative replacement. Rows
without a current Rider remain historical data. Completed snapshots never
choose an owner or compete in the preflight.

## Cutover and rollback

Apply migration `20261020040000_rider_identity_claims`, then deploy the API.
The migration installs canonicalizing, bidirectional database triggers before
commit, so old and new Rider/progress JSON writers use the same claim writer.
Verify duplicate create/edit/bulk and unfinished mobile saves return
field-specific HTTP 409 responses without returning the identity number.

Do not release claims when a Rider is soft-deleted or changes status. If a
rollback is required, stop writers and use a data-aware review before reverting
the application or migration; never auto-delete identity claims.

Do not remove the triggers or bypass the named claim constraints. They are the
compatibility boundary for every supported writer during rolling deployment.

The opt-in local proof is `apps/api/prisma/rider-identity-trigger-proof.sh`.
It creates disposable schemas only; set the `RIDER_IDENTITY_PG*` variables or
`RIDER_IDENTITY_DATABASE_URL` when the local PostgreSQL service differs.
