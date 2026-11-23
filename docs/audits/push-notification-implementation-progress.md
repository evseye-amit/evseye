# Push notification implementation progress

The consolidated plan is approved. Implementation proceeds in phases; application code changes do not imply deployment approval.

## Phase 1 — catalog and database foundation

Implemented:
- Additive Prisma models for 12 parent groups, categories and explicit application mappings.
- Approved JSON master with 120 unique stable categories and 480 explicit application mappings.
- Transactional insert-only seed preserving administrator edits on reruns.
- Firebase project configuration and client/app binding models, with environment-consistent and tenant-consistent foreign keys. Only secret references are stored.
- Nullable binding/category links on existing devices/messages; no historical data reassignment.
- Authenticated role-filtered catalog endpoint and initial Flutter handoff.

Pending at the end of Phase 1 (see Phase 2 updates below):
- Runtime project routing, secret resolution/health, removal of PUSH_ENABLED and project dispatch partitioning.
- Anonymous installation lifecycle, preferences/consent, dynamic audience resolver and topic synchronization.
- Category administration UI, composer enhancements, schedules and new event producers.
- Full Flutter contract and device acceptance evidence.

## Migration and deployment sequence

1. Review and apply `20261123120000_notification_foundation` using the normal Prisma migration pipeline.
2. Run the dedicated notification seed (`node --env-file=.env apps/api/prisma/seed-notifications.mjs` from repo root). Do not run the broad demo/client seed against production merely to add this catalog.
3. Deploy the generated Prisma client and API together, then verify the authenticated catalog for each application role.
4. Configure project/app bindings only once runtime routing and its validation are implemented. Phase 1 deliberately does not guess a project's client ownership from existing global credentials.

The migration only adds tables/nullable columns; old API builds continue using the old fields. Roll back the application if needed while retaining additive tables and catalog data. Do not drop tables referenced by future messages.

No live migration, catalog seed, credential changes or notification sends were performed as part of source implementation.

## Verification

- Prisma schema validation and client generation passed.
- Final API TypeScript check passed, including the catalog and migration tests.
- Notification suite: 17 passed; 8 full-schema integration tests skipped (NOTIFICATION_TEST_DATABASE_URL not configured).
- Two of the passing tests executed the actual additive migration against an isolated PostgreSQL database with minimal prerequisite tables. They verified tenant/environment foreign keys, legacy null bindings and catalog check constraints. This does not replace a full PostGIS-backed schema migration rehearsal.
- Changed notification source/test files passed oxlint; diff whitespace checks passed.
- Temporary PostgreSQL instance was stopped after verification. No application database was accessed.

## Phase 2 — runtime Firebase routing and relevance planning

Implemented in source:
- Provider resolves each target's tenant/app/platform binding and isolates project batches and SDK instances. No global Firebase credential fallback.
- PUSH_ENABLED removed. PUSH_ENVIRONMENT is an environment namespace, not a feature entitlement.
- Per-project worker leases, rate limits/backoff and bounded parallel dispatch. Missing/invalid credentials defer delivery without consuming an attempt; inbox and TTL are preserved.
- Existing registrations select an unambiguous active binding; optional applicationId disambiguates flavors. Team Leader device registration supported with TEAM_LEAD authorization. Binding/platform changes increment device version.
- Client-specific credential readiness used in previews/history, rather than a global enabled boolean. This is configuration validation, not an FCM/APNs/OS delivery guarantee.
- Platform-super-admin provisioning endpoint with audit and secret redaction. Project changes on an existing binding are rejected rather than silently moving tokens.
- Additional binding dispatch index migration.

Deployment: apply both notification migrations; inject project-specific service-account JSON under server secret names; explicitly set PUSH_ENVIRONMENT to match binding environment; provision bindings; release API; have apps re-register. Existing rows without a binding remain inbox-only / waiting for configuration until expiry. There is no automatic unsafe global-project migration.

`PUT /api/v1/platform/notifications/firebase-bindings` (SUPER_ADMIN): clientId, appCode, platform, applicationId, projectId, credentialReference. Supply a secret variable name, never credential JSON. Environment is server-selected. Reconfiguring a shared project's credential affects every client bound to that project and increments its credential version when the reference changes; changed secret content also changes the SDK instance identity. Existing project identities must be treated as immutable. Credential content is validated locally; no notification is sent by provisioning. Runtime reference values are read from the process ConfigService; changing deployed environment secrets normally requires process restart.

Inbox relevance is now explicitly part of the next targeting phase. See the dedicated section in the Flutter handoff: preserve personal history, enforce current operational access, and share visibility across listing/count/read operations. Existing GET ownership filters remain unchanged in Phase 2.

### Phase 2 verification

- Notification suite: 32 passed, 8 full-schema tests skipped. Includes three actual PostgreSQL tests for foundation constraints, the new binding index, project-scoped claim SQL and message configuration status.
- No live credentials were used and no notifications sent. Firebase SDK calls were mocked in provider tests.
- Full-schema tests still need a configured disposable PostGIS database.
- Final API TypeScript check, targeted lint and diff checks passed. Environment/payment-environment regression tests: 21 passed.
- Temporary PostgreSQL instance stopped after verification. Neither notification migration has been applied to an application database by this task.

## Phase 3 — recipient targeting and relevant inbox

Implemented in source:
- Shared tenant-safe audience resolver with employee/team-leader groups and role, application, hub, city, fleet, vehicle type, OEM and selected-user filters.
- Fleet-manager sends restricted to assigned hubs; own-send history/details restrictions.
- Immutable targeting snapshots, validated category/application mappings, operational/general visibility, independent visibility expiry and audited one-way withdrawal.
- Shared eligibility SQL for inbox pagination, unread count, read, read-all and queued dispatch. Current operational access is enforced; personal financial history survives assignment changes.
- Optional application scope and nullable category/application response metadata; Flutter handoff updated. No Flutter or web files changed.

Apply migration 20261123140000_notification_targeting after the two preceding notification migrations and deploy the generated Prisma client/API together. Existing messages default to PERSONAL: historical scopes cannot be reconstructed safely. The existing database content guard is extended to permit only one-way withdrawal alongside its original mutable dispatch fields; targeting stays immutable.

Next phases still cover installation lifecycle, preferences/consent, subscription reconciliation, web administration/composer and additional event producers. This phase implements fixed-dimension filtering, not arbitrary nested audience expressions.

Verification: 48 notification tests passed; 8 full-schema tests skipped. API TypeScript, Prisma schema validation, targeted oxlint and diff whitespace checks passed. The temporary PostgreSQL instance was stopped after testing. Tests use isolated PostgreSQL prerequisite tables and real migrations; full-schema PostGIS rehearsal remains necessary. No application database migration, live push send or credential changes were performed.


## Phase 4 — authenticated preferences and marketing consent

Implemented:
- Tenant/user/application-scoped consent and category preferences with composite user foreign keys and catalog referential integrity.
- Authenticated GET/PUT preference endpoints using current database role and active tenant/account checks.
- Default-deny PG11 marketing consent, optional category opt-outs and a server-owned essential-category policy.
- Atomic preference updates with audit records; nested DTO validation rejects null/string booleans and duplicate/unavailable categories before writes.
- Dispatch-time consent/preference checks reuse the existing queue eligibility path. Inbox history remains independent of push preferences.
- Flutter contract, account-switch behavior and migration instructions documented; no Flutter or web code changes.

Deploy migration `20261123150000_notification_preferences` after the prior three notification migrations before releasing this API. No application database migration or live send was performed.

Verification: 57 notification tests passed, 8 full-schema tests skipped. PostgreSQL tests exercised the actual new migration, cross-tenant constraints, consent isolation by user/application, opt-out, essential delivery and preserved unread history. API TypeScript, Prisma generation/validation, targeted lint and whitespace checks passed. Full-schema PostGIS rehearsal remains outstanding.

Scope: authenticated preference/consent foundation only. Anonymous installation lifecycle and topic synchronization remain separate next phases, followed by web administration/composer and event producers. Uncategorized legacy sends retain their previous behavior; all promotional producers must use the PG11 catalog classification. Audience previews are not consent-adjusted delivery estimates.

## Phase 5 — independent installation lifecycle

Implemented:
- Active-binding-scoped enrollment with server-generated installation UUID and random credential stored only as a hash; optional token/Firebase installation ID and permission reporting.
- Credential-protected read/update/revocation endpoints. No anonymous access to user identity, inbox or authenticated preferences.
- Authenticated tokenless claim with tenant/role/session validation; integration with existing device registration for atomic claim/token refresh.
- Registered/logged-out status derived from current session validity; previously registered installations cannot become new-user audiences. Tokenless claim records registration even before Firebase/APNs is ready.
- Permission denial disables dispatch; device version protects queued work across ownership/active-state changes. Account switching disables the prior device registration and never copies consent/history.
- Enrollment revocation disables the device and clears installation secrets/association data. Normal device unregister detaches even permission-disabled installations. Auth refresh moves the installation association to the rotated session.
- New migration and Flutter enrollment/claim/permission/retry contracts. No Flutter or web changes.

Deployment: apply `20261123160000_notification_installations` after all preceding notification migrations; deploy generated Prisma client and API together. Provision public per-flavor binding IDs for Flutter. Existing credential-free registration remains compatible only for non-enrolled IDs. No application database migration, real credentials or live push sends were performed.

Anonymous delivery/consent/history and topic synchronization remain future phases. Enrollment alone does not establish physical app attestation or grant access to authenticated data. Current endpoints use existing rate limiting; device evidence is still required before release.

Verification: 104 tests passed (68 notification tests plus 36 authentication tests); 8 full-schema tests skipped. Tests cover credential rejection, tokenless claim, tenant/app binding isolation, permission denial, expired sessions, revocation, session refresh and actual PostgreSQL migration constraints. Prisma generation/validation, final API TypeScript, targeted oxlint, formatting for new notification code and diff whitespace checks passed. The isolated PostgreSQL instance was stopped. Full-schema PostGIS rehearsal and real Android/iOS acceptance remain outstanding.

## Phase 6 — topic definitions and subscription reconciliation

Implemented:
- Stable, isolated logical/physical topic definitions per tenant/environment/app binding; role groups plus dynamic rider hub, city, vehicle-type and OEM groups.
- Public-category topic planning for PG01/PG11, enforcing active catalog mappings, preferences and explicit marketing consent. Sensitive categories remain token-only.
- Durable token-snapshot desired/applied membership, lease recovery, retry/deferred configuration handling, invalid-token handling and periodic reassertion.
- Cleanup under the original token/project for logout, role/assignment change, consent withdrawal, permission denial, token replacement, inactive configuration and orphaned device registrations.
- Authenticated, session-owned subscription status/sync APIs; version-scoped results prevent an account switch from exposing prior device membership. Tenant-admin paginated topic list and audited activation/deactivation.
- Shared Firebase project/credential app initialization, including cleanup through disabled bindings. No global credential fallback and no feature-toggle dependency.
- Updated Flutter contract. No Flutter/web edits; existing notification sending remains token-targeted. No topic broadcast endpoint was added.

Apply `20261123170000_notification_topics` after the preceding migrations. Deploy generated Prisma client/API together, observe job backlog and verify joins/removals with real devices before relying on these subscriptions. The application database was not migrated and no real Firebase subscription/send calls were made during implementation.

Subscriptions are eventually consistent, never an authorization boundary. Current processing is bounded to 50 scanned devices and 50 single-token operations per worker tick; production-scale batching/backlog tuning and retention/pruning remain follow-up. Cleanup tombstones deliberately retain original token snapshots for retry/reassertion. Do not remove original project secrets before cleanup completes.

Next phases: anonymous delivery/consent/history, web administration/composer and additional event producers. Firebase topic broadcasts must remain limited to public content and explicitly consent-aware targeting; personal/operational inbox authorization stays independent.

Verification: 118 tests passed (82 notification plus 36 authentication); 8 full-schema tests skipped. Tests cover physical namespace isolation, dynamic membership, catalog/consent opt-out, old-token cleanup, version-scoped status, lease recovery, concurrent desired-state change, invalid-token isolation and provider configuration deferral. Three real PostgreSQL topic tests passed again after final migration/index alignment. Prisma generation/validation, final API TypeScript, targeted lint, new-code formatting and diff whitespace checks passed. The temporary PostgreSQL instance was stopped. Full-schema PostGIS rehearsal, production-load validation and Android/iOS acceptance remain outstanding.

## Phase 7 — web composer and notification management

Implemented:
- Sender-authorized composer options endpoint with active category/application mappings, tenant hubs and fleet-derived vehicle/OEM choices. Fleet managers receive only choices within assigned hubs; unassigned managers and other roles are rejected.
- Existing web composer now requires application/category, supports employee/team-leader/filtered audiences, optional hub/city/vehicle-type/OEM filters and visibility expiry. App changes align the default audience and clear incompatible vehicle selections.
- Review captures the complete send payload. Failed-send retries preserve that payload and idempotency key. Counts explicitly describe audience reach rather than consent-adjusted delivery guarantees.
- Details expose category/application/expiry and withdrawn status; explicit, irreversible withdrawal confirmation uses the existing audited endpoint.
- Client-admin-only topic management with readable group names, binding app/platform context, pagination, confirmation and activation/deactivation. Mobile users still do not choose physical topics.
- Native accessible fields and existing dialog/table conventions retained. Optional filters are collapsed by default. No Flutter changes and no new database migration.

Scope: the operational composer and topic controls are implemented. Global catalog editing, scheduled campaigns, test-send workflow, anonymous delivery/consent/history and new event producers remain pending. Manual notices use OPERATIONAL visibility; personal event history remains governed by the existing backend policy. This UI does not introduce topic broadcasts.

Verification: 119 notification/auth tests passed; 8 full-schema tests skipped. Existing web suite: 25 passed. API and web TypeScript checks, targeted API lint/web ESLint and whitespace checks passed. Browser checks used actual React components and existing CSS in a temporary local harness with mocked APIs: filtered preview/send payloads, duplicate-city removal, withdrawal, topic deactivation, manager control visibility, app/audience alignment and unchanged idempotency key/payload after a simulated 503. Desktop layout was visually inspected with no horizontal overflow. These checks do not replace a deployed authenticated-browser/API or real-device acceptance run.

Deployment: release the API options/projection changes before or together with the web app. All prior notification migrations must already be applied. No application database changes, real sends or live topic updates were made during this phase.

## Phase 8 — platform notification catalog administration

Implemented:
- SUPER_ADMIN-only catalog listing, category creation/update and parent-group activation APIs, with the same authorization enforced in the service.
- Platform dashboard Notification Catalog screen: searchable category table, parent filter, category/name/description editing, application mapping and activation controls. Every save requires acknowledgement that it affects all clients.
- Stable category code and parent classification are immutable. Creation requires a matching PG01–PG12 code prefix and explicitly writes all four application mappings. Duplicate codes and case-insensitive names within a parent are rejected.
- Transactional before/after audits and optimistic concurrency using the reviewed updatedAt. The timestamp advances monotonically; a concurrent/stale edit returns 409 without applying mappings. The UI offers discard-and-reload recovery.
- Existing TOKEN delivery/priority metadata is preserved; new categories default to NORMAL/TOKEN. Editing routing/priority policy, deleting referenced categories, and creating additional parent groups are not exposed.
- Mobile catalog adds a content-derived catalogRevision; catalogVersion remains the response-schema version. Composer and topic reconciliation already consume active catalog/mapping state.

Behavior: deactivation affects new categorized sends and desired category-topic subscriptions. Existing inbox history is retained. Previously queued token deliveries keep their existing eligibility/preference rules and may still deliver; use message withdrawal to revoke a specific existing broadcast. Parent reactivation preserves individual category/application settings. App mapping never grants roles or marketing consent.

No new schema migration, Flutter edits, deployment or live catalog updates were performed. Release the API and platform screen together after earlier notification migrations. Anonymous delivery/consent/history, scheduling, test-send workflow and additional event producers remain pending.

Verification: 126 notification/auth tests passed; 8 full-schema tests skipped. Existing web suite: 25 passed. API/web TypeScript, targeted API lint/web ESLint and whitespace checks passed. Browser tests exercised the real component with mocked APIs: required global confirmation, mapping edits, 409 recovery without overwriting, parent deactivation, category creation and confirmation reset after edits. Desktop layout was visually inspected. Full-schema PostGIS and deployed authenticated end-to-end acceptance remain outstanding. Temporary browser harness and isolated PostgreSQL server were stopped after verification.

## Phase 9 — scheduled notifications

Implemented:
- Optional timezone-bearing ISO `scheduledFor` on manual sends, one minute to 90 days ahead. Visibility expiry must follow release time.
- Existing message/recipient queue reused. Recipient membership is captured at creation; newly joining users are not added later. Current relevance, permission, consent and preference checks still apply at delivery.
- Shared inbox/list/count/read/read-all and dispatch eligibility excludes future messages. Worker expansion and delivery claims independently enforce the release time and withdrawal.
- Push TTL starts at release; inbox ordering uses release time. Future messages remain SCHEDULED; withdrawal cancels active work as CANCELLED. Cancellation cannot recall pushes already accepted by Firebase.
- Schedule is immutable and included in the idempotency digest. Identical retries after the release time return the original message. To reschedule, withdraw and create a new notification.
- Web composer supports local send time, expiry validation, reviewed scheduling payload, scheduled confirmation and schedule details. Existing withdrawal cancels unsent scheduled work.

Deployment: apply `20261123180000_notification_scheduling` after prior notification migrations, then release API/worker and web together. No production database changes, deployment, real Firebase sends or Flutter source changes were performed. Scheduled time is earliest eligibility, not a guaranteed delivery instant. No environment flag gates this feature.

Verification: 129 notification/auth tests passed; 8 full-schema PostGIS tests skipped. Tests include actual PostgreSQL migration, future/due inbox authorization, immutable schedule, delivery claim exclusion, scheduled/cancelled worker states, schedule validation, TTL and idempotent replay. Existing web suite: 25 passed. Browser harness used actual components with mocked APIs to verify expiry validation, local-to-UTC serialization and scheduling confirmation. API/web TypeScript, targeted lint and whitespace checks passed. Deployed end-to-end and real-device acceptance remain outstanding.

Remaining phases: anonymous delivery/consent/history, test-send workflow and additional business-event producers.

## Phase 10 — allocation and vehicle-return event producers

Implemented four rider events using the existing transactional notification queue:
- Allocation initiated: PG04_VEHICLE_ALLOCATION.
- Handover activated: PG03_VEHICLE_HANDOVER, from both the allocation API and mobile deployment completion (including its training/PDI paths).
- Return initiated: PG03_VEHICLE_RETURN, only on the initial transition.
- Return completed: PG03_VEHICLE_RETURN, after inspection/submission/OTP safety gates. Copy explicitly avoids implying financial settlement.

A shared required Nest service resolves the allocation's rider and active RIDER user within the tenant. Missing/deleted/unlinked/inactive recipients and inactive/unseeded catalog mappings are skipped without preventing business completion. Unexpected persistence failures propagate to the enclosing business transaction. Firebase is never called in that transaction.

Each event uses a stable allocation-ID/event key and the existing unique client/request-key constraint. System enqueue supports category/application metadata; these events retain PERSONAL history with existing authenticated tenant/user/app visibility. Delivery continues through existing permission, preference, expiry and device-project checks. No topic broadcasts or historical-event backfill were added.

Flutter payload adds schemaVersion='1', action='ALLOCATION_DETAILS', event and allocationId. This is a navigation hint, never authorization. Existing legacy producer payloads remain unchanged. Flutter implementation remains external to this workstream.

Deployment: no new migration; requires the previous notification migrations and seeded PG03/PG04 categories before enabling event production. No deployment, production database changes, Firebase calls or Flutter source edits were performed.

Remaining: additional business-event families (payments/invoices, verification, service/support and other lifecycle workflows), test-send UI/API, anonymous delivery/consent/history, broader action-contract adoption and production hardening/acceptance.

Verification: 267 tests passed across notification/auth, allocation/mobile deployment, vehicle submission and fleet-readiness suites; 77 full-schema integration tests skipped because their dedicated test database fixtures were not configured. The notification foundation/relevance/topic PostgreSQL tests ran against the isolated local database. New tests cover all four event mappings, tenant/user isolation, disabled categories, stable keys, categorized PERSONAL persistence/replay, return-transition suppression, both activation paths and propagation of queue errors. API TypeScript, targeted oxlint and diff whitespace checks passed. No real-device or deployed end-to-end verification was performed.

## Phase 11 — administrator test-send workflow

Implemented:
- CLIENT_ADMIN-only, tenant-scoped device lookup by exact phone/application. Returns up to 50 active registrations with platform, name and registration time; never returns tokens or installation credentials.
- Rate-limited test-send endpoint with mandatory idempotency key, active user/session checks, category/application validation and exactly one selected device/version.
- Test message, recipient, delivery and completed expansion marker are persisted in one transaction. The normal worker cannot expand the test to other devices. Existing Firebase routing, registration-version, permission, consent and preference checks still apply.
- TEST source and [Test] title prefix identify tests in history and the mobile inbox. A test creates one user inbox entry visible on that user's authenticated sessions; only its push delivery is device-specific.
- Identical retries return the original result even after the registration becomes unavailable. Different content/device with the same key is rejected. The web composer preserves the test key across uncertain failures and provides an explicit Start a new test action.
- The composer offers phone lookup and device selection separately from audience review/send. Test sends are immediate; broadcast filters, scheduling and visibility expiry are not copied. Tests use the ordinary push TTL and remain withdrawable through existing message management.

API: GET /api/v1/client/notifications/test-devices?phone=...&application=RIDER (20/minute); POST /api/v1/client/notifications/test (5/minute), body deviceId/application/categoryCode/title/body, Idempotency-Key header. Test title maximum is 143 characters to allow the prefix. Response is the existing message envelope; history/details provide delivery status. Queued or Firebase accepted does not mean the OS displayed the notification.

No migration or Flutter source changes. Release API before or together with web, after earlier notification schema/catalog provisioning. No production changes or real Firebase sends were performed.

Verification: 144 notification/auth/event-helper tests passed, including actual isolated PostgreSQL notification regression tests; eight full-schema tests skipped. Existing web suite: 25 passed. Browser tests with actual components and mocked APIs verified device selection, a simulated 503 retry with identical key/body, explicit new-test keys, clearing the selected device after changing phone, and no broadcast submission. API/web TypeScript, targeted lint and whitespace checks passed.

Remaining: production hardening/retention/load validation, additional business-event families, anonymous delivery/consent/history, broader versioned action adoption, Flutter implementation and deployed/device acceptance.

## Phase 12 — production hardening and release validation tooling

Implemented isolated worker stages, all-settled multi-project batches, bounded expired/withdrawn recipient cleanup, EXPIRED push status, unchanged-status write suppression and one-minute retry deferral for failed topic planning. No feature-toggle dependency or new database migration.

Added test:notifications:release: requires both explicit disposable database fixtures, fails on test failures/skips/todos or missing reports. Added notifications:readiness: explicit database/environment, read-only snapshot and bounded query timeouts, migration/catalog/binding blockers, queue/lease warnings and retained unsubscribe counts. It does not resolve credentials or call Firebase and does not claim end-to-end readiness.

The release runbook is docs/runbooks/push-notification-release.md. It includes deployment ordering, rollback restrictions, workload testing, monitoring, device acceptance and retention safeguards. Automatic historical-data/token pruning is intentionally not implemented: retention windows, archival and preservation of deduplication/cleanup evidence remain required.

Verification: 153 notification/auth/event-helper tests passed; eight full-schema tests remain skipped in the local partial regression run. Actual PostgreSQL tests verify 450 expired recipients are drained in bounded batches without starving live work, future schedules remain untouched, expiration status, readiness SQL and no mutation by readiness reporting. Release runner rejects missing fixture configuration; JSON reporter and read-only failure handling were exercised. This is not a completed production-release gate.

Outstanding release blockers: dedicated full-schema/PostGIS fixture and migration rehearsal, deployed authenticated/API and Android/iOS evidence, credential/project validation and realistic multi-worker load testing. Local PostgreSQL lacks PostGIS. No production changes, deployment or live Firebase calls were performed.

Final static/build checks: API and web TypeScript, targeted API/web lint, diff whitespace and API Nest production compilation passed. Generated worker artifacts include the hardening changes. The temporary PostgreSQL server was stopped after verification. Web production build and the strict no-skip release run remain rollout gates rather than completed local checks.

## Phase 13 — full-schema release gate and web production build

Completed locally on 23 November 2026:
- Started a new disposable localhost-only Docker database using cached postgis/postgis:16-3.5-alpine (PostGIS, topology and tiger geocoder extensions reported version 3.5.7). The existing application/native PostgreSQL databases were not used.
- Applied all 35 repository migrations successfully from an empty full-schema database, including all seven notification migrations.
- Ran only the dedicated notification catalog seed: 12 parent groups and 120 categories.
- Strict test:notifications:release passed: 201 tests in 23 files, zero failed/skipped/todo tests. The eight previously skipped full-schema tests now ran, including 601-device batching, concurrent workers, lease recovery, retries and inbox ownership.
- Web production build using the repository's webpack configuration passed compilation, TypeScript, static generation and route/build tracing.
- Full-schema readiness reporting correctly found zero missing notification migrations and seed categories, and refused readiness because no live Firebase bindings were provisioned in the test environment.

The first full run exposed test-harness timezone assumptions in raw pg fixtures and an outdated expiration assertion. Added a test-only UTC PostgreSQL client helper matching Prisma timestamp conventions. Updated expiration assertions to require no delivery creation for already-expired work, EXPIRED status, completed expansion and preserved inbox history. No production notification behavior was weakened to make tests pass.

This closes the local full-schema/PostGIS and web-build blockers from Phase 12. It is a clean-install migration rehearsal, not a migration rehearsal against a production-data copy. Production-data upgrade validation, actual Firebase/APNs credentials and bindings, deployed browser/API checks, realistic sustained load testing, Flutter/device acceptance and rollout remain outstanding. No live Firebase sends or production changes occurred.

Additional verification: the 15 timestamp-sensitive relevance/topic tests passed again with TZ=America/Los_Angeles against the UTC PostGIS server. API TypeScript and targeted test lint passed. No generated web configuration changes were introduced. The disposable PostGIS container was stopped and removed after verification; Docker Desktop was left running.

## Staging-data and real-device acceptance preparation — awaiting inputs

Inspected the available local dump with a compatible PostgreSQL 16 tool. It was created on 27 September 2026, predates the November baseline, and contains no notification tables. It was not restored. Read-only AWS identity/RDS inventory confirmed the staging instance and 12 available snapshots; the latest listed snapshot was from 8 November 2026. No cloud resources or credentials were changed, and no database secrets were retrieved.

Added notifications:upgrade-check, a localhost-only read-only before/after aggregate data-preservation checker for a restored staging copy. It captures old-column checksums and counts, tolerates additive columns and rejects changed/deleted rows. No user records/tokens are printed. Six new unit/PostgreSQL tests passed, along with API TypeScript, targeted lint and whitespace checks. Tests used synthetic data; a real staging-data upgrade has not been claimed or performed.

Local device discovery found no connected Android device and the physical iPhone offline. PinkRides Rider/Fleet Android/iOS Firebase project metadata matches, but credentials, deployed bindings, APNs and delivery remain unvalidated. No Flutter source changes or live notifications.

Pending user inputs: a current staging backup/source choice and the designated staging client/app/recipient device. An input request was raised in the chat. No migration, reset, restore or seed was run against live staging/production. The temporary local container used for metadata inspection and synthetic tests was removed after preparation.

## Live staging Android push acceptance — 23 November 2026

User explicitly excluded the old local dump and authorized a test for Pink Rides / Rider App / Android, recipient ending 3122. No dump was used.

Verified the live staging rider and tenant were active, and the selected latest Android RIDER_APP registration had an unrevoked, unexpired session. Other Android registrations and the iOS registration were excluded. Staging Firebase environment and injected service-account project both matched pinkridesstage-dc79c; private keys/tokens were neither retrieved nor printed.

The deployed staging revision is evseye-staging-api:239 (image 8fd2c0171eefce9c4a9aaf1169a58e1b413bf269). Its NotificationAppBinding table is absent: this is the earlier notification implementation, not the newly implemented centralized release. A short-lived task reused the deployed NotificationService to atomically queue one TEST message, one inbox recipient and one device/version-specific delivery, marking expansion complete to prevent delivery to other devices. The existing staging worker performed the actual Firebase send. A stable request key prevents accidental duplicate enqueue.

Result:
- Title: [Test] Pink Rides staging push
- Message ID: 16d7058b-2c84-4934-99af-4ec589451f3a
- Delivery ID: 6e68f4f3-6a3c-4f66-9498-ac8d6d591f1b
- Firebase accepted on the first attempt at 2026-11-23 21:55:27 IST (16:25:27 UTC), errorCode=null.
- Exactly one delivery record, for the selected Android device.
- User confirmed in chat: Yes, it appeared.

This validates one live Android device receipt through the existing staging queue/provider. It does not validate deployment of the new migrations/APIs/topics, iOS delivery, foreground/background/terminated coverage, or the full acceptance matrix. No production changes, schema migration, deployment, broad broadcast or local-dump restoration was performed. The test intentionally created one staging notification/inbox/delivery record plus the existing audit entry.

## Phase 14 — fresh staging-data upgrade rehearsal

On 23 November 2026 the user explicitly approved a temporary encrypted AWS snapshot/restore rehearsal. Created a fresh snapshot of evseye-staging-postgres and restored it as private db.t4g.micro instance evseye-staging-notification-rehearsal-20261123 in ap-south-1, in the existing staging database subnet/security groups, with automated backup retention zero. The old local dump was not used. No database dump was exported to S3 or the workstation.

The source-only migration archive SHA-256 was 373fc97b31fdd7883b060c057934ee9bb16895a16a1551377681e2f60d08aae2. It contained the current migrations, schema, notification catalog/seed and verification scripts, excluding local seed datasets and credentials. A one-off ECS task reused staging image 8fd2c0171eefce9c4a9aaf1169a58e1b413bf269, verified the archive digest and generated the Prisma client from the current schema. Only DATABASE_URL was injected; the command replaced its target with the exact clone hostname, discarded query overrides and used verify-full TLS. No API or notification/business workers were started.

Successful task: c03f483a52f042d5925b3b01560065b1, task definition evseye-staging-notification-rehearsal:2, container exit 0. Two earlier runner attempts stopped before database access: insufficient memory for Prisma generation, then an import mismatch. The successful task used 0.5 vCPU / 2 GiB and the corrected pg import.

Results:
- deploy-migrations.mjs and the dedicated notification seed completed successfully against the fresh copy.
- All seven notification migrations were present; zero catalog categories were missing.
- Original-column counts/checksums were unchanged for Client (2), User (31), Rider (18), NotificationMessage (10), UserNotification (10), PushDevice (22) and PushDelivery (14). Newly created NotificationConsent and NotificationPreference remained empty. No tracked tables changed.
- Readiness correctly remained BLOCKED: no active staging Firebase bindings. There were 21 active unbound registrations. Queue/lease/overdue-topic counters were zero in this snapshot.
- This validates tracked-data preservation and migration/seed compatibility, not every business table or an end-to-end deployment.

The local deployable-image build failed because Docker storage became read-only; the host filesystem had approximately 206 MiB available. No new API image was published or deployed. Live staging remains on API revision 239 and its database was not migrated. Next release steps are a successful API/web artifact build, per-client staging Firebase binding provisioning, controlled staging rollout and new-implementation device/API acceptance. Existing registrations need binding resolution/re-registration; do not mass-bind tokens to a project by assumption.

Cleanup verified: RDS returned DBInstanceNotFound and DBSnapshotNotFound for the temporary resources. The successful task is STOPPED with exit 0; both task definitions are INACTIVE. S3 returned zero source-artifact versions and zero delete markers. The task-created local build context and archive were removed. Aggregate task logs are retained as evidence; they contain no device tokens or database credentials.
