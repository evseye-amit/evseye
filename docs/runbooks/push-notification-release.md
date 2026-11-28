# Push notification release validation

Status: source hardening, local release gates and the approved fresh staging-copy migration rehearsal are complete. The earlier staging Android push was received through the old implementation. The new implementation is not deployed; production remains untouched. See the evidence sections below for scope and remaining gates.

## Required automated gates

1. Prepare disposable PostgreSQL databases whose names contain _test_. The full-schema database must have the repository schema, required PostgreSQL extensions including PostGIS, and all notification migrations. The foundation database is used by tests that create/drop isolated minimal schemas. Never point either variable at application data.
2. Explicitly set NOTIFICATION_TEST_DATABASE_URL and NOTIFICATION_FOUNDATION_TEST_DATABASE_URL in the test runner's secret environment.
3. From the monorepo root run:
   - pnpm --filter @evs-eye/api test:notifications:release
   - pnpm --filter @evs-eye/api typecheck
   - pnpm --filter @evs-eye/api build
   - pnpm --filter @evs-eye/web build
4. The release runner rejects absent/non-test database URLs, failed tests, skipped/todo tests, missing JSON reports and empty test runs. It does not migrate databases or seed catalog/configuration. Firebase is mocked.
5. Rehearse all seven notification migrations against a full-schema staging copy. Verify constraints/indexes and seed the approved notification catalog using the dedicated notification seed. Do not run the demo/client seed.

## Read-only database readiness

Set NOTIFICATION_READINESS_DATABASE_URL explicitly to the intended database, with a read-only database role, and set PUSH_ENVIRONMENT to the deployment namespace. Then run:

pnpm --filter @evs-eye/api notifications:readiness

The tool uses a repeatable-read, read-only transaction, 10-second per-statement timeout, 2-second lock timeout and rollback. It never uses DATABASE_URL as a fallback. Output contains aggregate counts, no users, tokens, secret references or credentials. Query errors are reported using sanitized codes.

Blockers: missing migration records/catalog categories, no active bindings in the selected environment, or active bindings referencing inactive/mismatched projects. Warnings: unbound/disabled-binding registrations, configuration waits, overdue work and expired leases. Review all nonzero warning counts against recent traffic and worker logs. Fifteen-minute backlog warnings are initial operational thresholds, not promised delivery SLAs.

Messages/deliveries do not store an environment dimension; their counts are explicitly labeled all_environments. Unbound devices also cannot be assigned to an environment. Topic/binding checks are environment-scoped. This report does not prove every tenant is provisioned, credentials are valid, APNs is configured, workers are running, category mappings are correct, or phones actually display notifications. A database-check success retains REQUIRES_ACCEPTANCE status.

## Worker behavior and monitoring

- Expansion/dispatch/finalization stages log isolated errors; one failed stage no longer suppresses the others. Concurrent tick protection remains.
- Project dispatch waits for every in-flight project in each four-project batch. A rejected project does not prevent later project batches.
- Expired/withdrawn unexpanded recipients are finalized in batches of 200, without device lookup or new push deliveries. Live expansion independently handles up to 200 recipients. Future scheduled messages remain untouched.
- Expired active messages with no Firebase-accepted delivery become EXPIRED (web label: Push expired). This concerns push delivery, not inbox retention. Partial/previously accepted deliveries retain their normal outcome aggregation. Terminal messages are not rewritten.
- Status aggregation writes only when the status changes, avoiding repeated writes to unchanged scheduled/in-progress messages.
- Failed topic planning delays its due subscription work by one minute and advances its scan timestamp so it cannot monopolize the oldest-first window. Desired/applied state is preserved. Database failure still leaves durable work available for retry.

Monitor notification_worker_failed (stage), notification_project_dispatch_failed, notification_topic_worker_failed (stage) and notification_topic_plan_failed. Sustained backlog, stale leases or configuration waits require investigation, not blindly increasing retries. Load-test realistic user/device/topic distributions, two workers and multiple Firebase projects before increasing the current bounded batch sizes. The local 450-expired-recipient test validates bounded cleanup/fairness, not production throughput.

## Retention and cleanup

No automatic deletion of inbox, audit, delivery or topic cleanup records is enabled. In particular, do not delete old topic token snapshots merely because desired=false: an unsubscribe may be uncertain or a delayed provider call may reapply membership. Original Firebase credentials must remain available until cleanup is confirmed.

The readiness report counts old acknowledged unsubscribe records for retention review; this is not a deletion eligibility list. Define approved retention windows and archive requirements before implementing bounded pruning. Preserve idempotency keys (or compact tombstones), delivery-history aggregates and personal finance history. Validate concurrent worker/provider activity and restored backups before pruning credentials/tokens. Existing token snapshots remain sensitive and must have database access restricted.

## Staging and device acceptance

Record evidence for:
- Two tenants sharing a Firebase project and two independent projects; correct Android/iOS package/bundle and APNs provisioning.
- Selected-device test sends reach exactly one registration; inbox visibility remains account-scoped.
- Token rotation, logout, expired sessions, account switching, denied permissions and offline retry.
- Dynamic role/hub/city/vehicle/OEM subscription joins AND removals.
- Preference opt-out, marketing consent withdrawal and disabled catalog mappings.
- Scheduled messages remain invisible before release; withdrawal/expiry stop unsent work.
- Allocation initiation, both handover workflows, return initiation/completion and duplicate retries.
- Provider timeout, configuration outage, invalid token, worker restart, lease expiry and one-project failure while other projects progress.

Firebase acceptance is not proof of device display. Flutter-team Android/iOS evidence and deployed authenticated browser/API checks are required.

## Rollout and rollback

Apply additive migrations and dedicated catalog seed first, provision/check each client's binding credentials, deploy compatible API/workers before or with web, and release the Flutter integration separately. Start with explicitly selected staging devices/tenants and inspect queue drain and subscription cleanup.

Roll back application artifacts only to a notification-compatible revision. Retain additive tables, recipient history, deduplication keys, cleanup snapshots and project secrets. An older worker predating scheduling must not run against scheduled messages. Use withdrawal for incorrect broadcasts; it cannot recall pushes already accepted by Firebase.

## Verified local rehearsal — 23 November 2026

The strict notification release gate passed 201 tests with zero skips against disposable PostGIS databases. All 35 migrations and the dedicated catalog seed succeeded; the web production build also passed. This evidence supersedes the earlier local PostGIS/fixture and web-build blockers. It does not replace staging-data upgrade or real-device acceptance.

A reproducible disposable setup (run from the monorepo root, with Docker available):

```sh
docker run --rm -d --name evseye-notification-release-check \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=notification_test_release \
  -p 127.0.0.1:58472:5432 postgis/postgis:16-3.5-alpine
docker exec evseye-notification-release-check pg_isready -U postgres
docker exec evseye-notification-release-check createdb -U postgres notification_test_foundation
```

Wait until pg_isready succeeds before the remaining commands. From apps/api:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:58472/notification_test_release ./node_modules/.bin/prisma migrate deploy
DATABASE_URL=postgresql://postgres@127.0.0.1:58472/notification_test_release node prisma/seed-notifications.mjs
NOTIFICATION_FOUNDATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:58472/notification_test_foundation \
NOTIFICATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:58472/notification_test_release \
node scripts/test-notification-release.mjs
```

From apps/web run the repository build command: pnpm build (next build --webpack). The raw SQL test fixtures explicitly use UTC for pg timestamp serialization/parsing and session time; application code is unchanged.

After collecting results, remove the disposable database container:

```sh
docker stop evseye-notification-release-check
```

The container uses an anonymous disposable data volume and --rm; no application-data mount is used. These test URLs must never be replaced with an application database for test execution. The readiness report on this fixture intentionally reports no active Firebase bindings; do not add production credentials just to make a local report green.

## Staging-data preservation rehearsal

Use a current, identified staging logical backup restored into an isolated local PostGIS database. Record the backup timestamp/source and application migration baseline. The available workspace dump Extra Files/evseye-before-migrations.dump was created on 27 September 2026 and predates the November consolidated baseline; it must not be treated as current staging acceptance evidence.

A read-only checker is available from apps/api:

```sh
NOTIFICATION_REHEARSAL_DATABASE_URL=postgresql://postgres@127.0.0.1:58473/notification_test_staging_rehearsal \
node scripts/notification-upgrade-check.mjs before /tmp/notification-upgrade-baseline.json
```

Then apply the intended migrations ONLY to that restored copy using an explicitly overridden DATABASE_URL. Do not reset/baseline the live staging database to make migration tooling proceed. Resolve any historical migration-lineage mismatch as a separate upgrade issue.

After migration:

```sh
NOTIFICATION_REHEARSAL_DATABASE_URL=postgresql://postgres@127.0.0.1:58473/notification_test_staging_rehearsal \
node scripts/notification-upgrade-check.mjs after /tmp/notification-upgrade-baseline.json
```

The checker rejects non-local targets, implicit ports, non-test database names and URL query overrides. It runs read-only with lock/statement timeouts and rollback. The baseline file is created exclusively with mode 0600; existing files are not overwritten.

Tracked tables: Client, User, Rider, NotificationMessage, UserNotification, PushDevice, PushDelivery, NotificationConsent and NotificationPreference. Counts and commutative aggregate row checksums detect accidental data changes; raw records, device tokens and credentials are never printed. After migration, only pre-migration columns are compared, so additive columns do not cause false positives. A previously absent tracked table must remain empty for an unchanged-data result. Catalog seeding should be checked separately. This is not a cryptographic backup verification or a check of every business table, index, constraint or new-column value; complement it with migration status, readiness and full-schema tests.

## Staging/device discovery — 23 November 2026

Read-only AWS inspection confirmed evseye-staging-postgres in the repository's staging account/region. Twelve available snapshots were returned; the newest was evseye-staging-before-reseed-20261108-0909, created on 8 November 2026. No snapshot was created/restored and no AWS resources or credentials were changed/read.

Local checks found no attached Android device and the physical iPhone offline. PinkRides Rider/Fleet Android and iOS flavor files consistently reference the same Firebase project; that is only static configuration consistency, not proof of server binding, credential validity, APNs setup or actual delivery. No Flutter files were edited.

Required before live acceptance: identify a current staging logical backup or approved current-copy procedure; select the staging client/application and dedicated recipient/device; make the test device reachable and provide staging console access through the existing authenticated session. Do not paste service-account private keys or bearer tokens into chat. Record notification ID, selected registration, platform, app state, backend outcome and device-observed result for each test. Never infer display from Firebase acceptance.

## Live Android receipt evidence — 23 November 2026

Pink Rides Rider App on Android: a single test push to the user-designated rider's latest eligible Android registration was accepted by Firebase on attempt 1 at 21:55:27 IST. Message ID: 16d7058b-2c84-4934-99af-4ec589451f3a. The user confirmed the phone displayed [Test] Pink Rides staging push. No iOS or other device was targeted.

Important scope: staging API revision 239 still uses the previous notification implementation and has no NotificationAppBinding table. This successful test establishes the existing staging Firebase/device path, not acceptance of the newly implemented centralized rollout. Re-run the acceptance matrix after the new migrations, per-client bindings and API/workers are deployed. The old local dump remains excluded at the user's request.

## Fresh AWS snapshot rehearsal procedure

The user approved a fresh encrypted snapshot and temporary private db.t4g.micro restore in the staging account, followed by deletion of both temporary resources. This supersedes the earlier request for a backup source; it does not authorize exporting database contents to S3 or the workstation.

Run only migration/catalog/check commands against the explicitly verified temporary RDS hostname. Do not start the API, scheduled business jobs, notification workers or Firebase clients against copied data. Inject only DATABASE_URL into the one-off task, replace its hostname before connecting, discard connection query overrides, and retain certificate verification. Never point the truncating integration test suites at the staging copy.

For an existing-image rehearsal, a private source-only archive may carry the repository migrations, schema, catalog, Prisma helper and validation scripts. Exclude seed datasets, local dumps and credentials. Verify the archive SHA-256 before extraction; generate the Prisma client from that schema in the disposable task. This validates the migration source on real staging data, not a newly built deployable API image.

Capture the tracked-table baseline in task memory, apply deploy-migrations.mjs, run only seed-notifications.mjs, compare original-column counts/checksums, and run notification readiness. Report migration and data-preservation results separately from missing binding/device-acceptance blockers. Retain only aggregate evidence. Delete the temporary restore without a final snapshot, delete the approved temporary source snapshot, remove the source artifact, and deregister the one-off task definition after the task stops.

Executed successfully on 23 November 2026: all seven notification migrations and catalog categories present; no changes to tracked pre-existing data. Readiness remained blocked by missing staging bindings, with 21 active unbound registrations. Successful task c03f483a52f042d5925b3b01560065b1 stopped with exit 0. Temporary RDS instance/snapshot absence and removal of all S3 artifact versions were verified. See Phase 14 in docs/audits/push-notification-implementation-progress.md for counts and source checksum. The new deployable-image build remains blocked by the full local disk/Docker read-only storage error; no staging deployment occurred.
