# Pre-production cleanup and readiness audit

**Scope:** implementation and cleanup changes are limited to `apps/api` (NestJS/Prisma) and `apps/web` (Next.js). `apps/site` (static marketing site) is included only to confirm it has no API dependency. The separate Flutter workspace at `../rider_app` is **read-only reference material** used only to identify API calls and the request/response data sent by the mobile clients. No Flutter files will be changed as part of the cleanup.

**Purpose:** reduce avoidable production risk before first launch and make early incidents easier to diagnose and fix. This is a static source audit, not a runtime, load, security-penetration, or live-data audit. A small, source-proven legacy API cleanup has been applied; no migrations or data were changed.

**Action status (2026-10-25):** behavior-neutral backend lint cleanup removed unused imports/locals and a redundant object spread. Two legacy branding routes/controller and the unused branding service method were removed; active branding endpoints remain. The client dashboard's unreachable manual allocation form, unused fleet/component photo handlers, and redundant fleet detail reads were removed. Their now-unreferenced `GET /fleets/:id/onboarding-status` HTTP route was removed; the service method remains because fleet activation uses it internally. Three unused Super Admin dashboard state/local variables were also removed. API lint, API typecheck, and web typecheck pass. A source-derived endpoint inventory is available in `docs/api-route-usage-inventory.csv`. No Flutter files, schema models, or migrations have been removed.

## Executive summary

- There are **81 active backend controller files** after removing the two-handler legacy branding controller. A source-built Nest OpenAPI export reports **836 unique method/path operations**. Every API removal decision should be made at handler level; a controller can contain a mixture of active and future functionality.
- Frontend and Flutter clients call many different API areas. No entire backend module looked safely removable based on source reachability.
- The marketing Site is static and has no API dependency; it is separate from the Next.js client/Super Admin application.
- **One database cleanup candidate:** `FleetDocument` has a Prisma model and initial-migration DDL, but no application/client/seed references were found beyond its `Fleet.documents` relation. Remove only if that relation is also intentionally unused. This model can be removed cleanly before first production release, provided there is no required migration history baseline.
- Many other models without a direct `prisma.<model>` search hit are used through relation includes, transaction clients (`tx`), raw SQL, generic helpers, seeds, or tests. They are not classified as unused.
- The database dump `evseye-before-migrations.dump` and local SQL seed snapshot are useful for comparison, but they do not establish which migrations have been deployed or what data should be retained. Treat the dump as potentially sensitive and do not put its contents in source control or reports.

## Deletion candidates

### API handlers

Three handlers are removed from the candidate inventory: `GET /client-branding/public` and authenticated `GET /client-branding` (legacy replacement routes), plus `GET /fleets/:id/onboarding-status` (its only callers were an unreachable legacy web fleet-photo flow; its service method remains internally used by fleet activation). Other handlers remain review-only because source absence does not prove they are dead: webhooks, operational runbooks, bootstrap flows, future launch scope, and internal callers may not appear as ordinary client references. Before launch, generate an exact `method + path + controller` inventory from Nest route metadata/OpenAPI and annotate each handler as:

`docs/openapi-operation-inventory.json` is the exact runtime method/path inventory generated from the current API build with `pnpm --filter @evs-eye/api openapi:routes`. Each of its 836 operations maps to a source controller class and file. The CSV remains a separate, heuristic triage aid for web and Flutter source matches. Its matcher found candidate source files for 590 declarations in web and 460 in Flutter, but this is not proof of usage. Comparing the inventories exposed a coverage gap: the CSV contains 838 rows and 774 unique method/path pairs, while 198 runtime operations have no exact CSV pair; this indicates that the static extractor does not consistently resolve decorator/class paths. The 136 CSV-only pairs also include stale/incorrect candidates, including the three removed routes. Do not use CSV no-match rows as evidence for deletion. Reconcile each runtime operation using its `operationId` and source file, then verify web/Flutter client wrappers, provider/worker/manual callers, and release scope. No operation currently lacks a controller source mapping. Treat unreviewed client matches as review queues, never automatic deletion candidates.

### First-pass client no-match review

This is a manual triage of source areas surfaced by the CSV, not a full operation-by-operation sign-off. No additional handler is safe to delete from this evidence alone.

| Area | Source review | Disposition |
|---|---|---|
| Mobile deployment localization, IoT health, device pairing, and pairing bypass | No matching call was found in the web source or Flutter Dart files. The handlers are rider/fleet-manager actions in `MobileDeploymentController`. | Confirm whether pairing and device-health workflows are in the launch surface. If deferred, disable/gate them; do not remove until the fleet workflow owner confirms. |
| Training-content management | Platform CRUD handlers have no direct web/Flutter wrapper match. The separate rider training flow is wired through `/mobile-deployments/:id/training`, `/training/viewed`, and `/training/complete`. | Keep the rider-facing flow. Confirm whether platform content management is intentionally manual or deferred before considering the CRUD handlers. |
| Rider rate cards and commercial terms | No direct UI wrapper match was found for the management routes. Flutter's `CommercialApi` does call the separate `/mobile-deployments/:id/plans`, `/commercial-offer`, and `/rider-app/commercial-offers/:id/accept` routes. | Preserve the pricing/offer flow and shared services. Confirm the supported admin workflow for managing rate cards and terms; absence of an in-repo UI does not establish that management endpoints are dead. |
| Collections and rider deposits | Collections has minute/hour scheduled workers, a database invoice-change trigger that enqueues evaluations, idempotent action records, and a payment retry path. `RiderDepositService` is injected by checkout collections, deployment commercial flows, vehicle exchanges, commercial lifecycle, and final settlement; the schema has immutable ledger triggers and cross-table payment/refund constraints. | These services, workers, and tables are demonstrably in use. Do not remove them. Only the management HTTP routes remain subject to launch-surface review. |
| Payment reconciliation, provider settlement, and wallet reversal | No direct web/Flutter wrapper match was found. The routes are client-admin or super-admin finance/operations functions, including retries and ledger reversal. | Treat as manual/operational APIs; retain until the incident/reconciliation runbook and release owners say otherwise. |
| Push-device registration | No matching registration/unregistration call was found in the checked web and Flutter sources. The API exposes token registration and removal separately from notification read APIs. | Confirm whether a different app runtime registers tokens or push is deferred; do not remove based only on these workspaces. |
| Vehicle-exchange policy | No direct UI wrapper match was found for policy read/update. Flutter does contain the rider vehicle-exchange request flow. | Keep exchange functionality; verify whether policy configuration is performed manually or belongs in a launch admin UI. |

The web and Flutter source checks above are read-only. Flutter remains reference-only and no Flutter code was changed.

1. called by web;
2. called by Flutter rider (reference only);
3. called by Flutter fleet manager (reference only);
4. webhook/provider callback;
5. scheduled/worker/internal;
6. operational/admin/manual;
7. intentionally deferred; or
8. unaccounted.

Resolve all `unaccounted` entries with the feature owner. Mark deferred functionality explicitly (feature flag or release-scope note); do not leave accidental endpoints exposed. Then remove genuinely out-of-scope handlers and their services/tests/DTOs together.

### Database table

| Candidate | Evidence | Recommendation |
|---|---|---|
| `FleetDocument` | Model at `apps/api/prisma/schema.prisma`; created in `20261016000000_init`; relation `Fleet.documents`; no other references found in API, web, Flutter, seeds, or later migrations. | Likely obsolete. Confirm that fleet documents are represented by another mechanism (e.g. `FleetRegistration`, `FleetInsurance`, `FleetFitness`, or `Photo`) and that `Fleet.documents` has no planned use. If confirmed, remove the relation/model/enum if exclusive, then create a new migration before launch. Inspect the target database for row count before applying. |

Do not delete Prisma migration directories that have been applied or used to build a database. If production has not yet been initialized, establish a clean baseline deliberately; otherwise use a forward migration. Review the actual dump and target schema separately before deciding whether to squash/reset migrations.

## Findings and improvements

### P0 — must settle before production traffic

1. **Define a launch surface.** The repository includes broad business domains (KYC routing/workflows, collections, wallet, rewards, referral, settlement, spares, fleet readiness, multiple payment flows). Confirm which are launch-critical and protect deferred routes with explicit configuration/access policy. Having code in the repo is not a launch decision.
2. **Reconcile API contracts.** Create a generated OpenAPI operation inventory and compare it with every Flutter API wrapper and web call. Catch path/method/body/response drift, duplicate handlers, and unaccounted routes. Keep this as a release artifact.
3. **Prove tenant isolation.** For every client-scoped list/detail/mutation, verify that `clientId` comes from authenticated context and is applied to the database predicate, including nested writes, media access, exports, and reporting. Exercise cross-client negative cases before launch.
4. **Payment and webhook readiness.** Verify signature validation, idempotency on create/capture/refund/settlement, duplicate/out-of-order provider events, reconciliation of unknown events, and safe retry behavior. Confirm no endpoint can mark a payment settled solely from untrusted client input.
5. **Operational recovery.** Document database backup/restore, migration rollback/forward-fix, payment reconciliation, credential rotation, and feature-disable procedures. Add a launch runbook with owners and commands.

### P1 — correctness and reliability

1. **Validate all inputs consistently.** DTO use is mixed with `unknown` and inline object bodies in controllers (e.g. some fleet component and platform-catalog routes). Use explicit DTO validation, length/range limits, UUID parsing, and strict enum validation for all writes.
2. **Review error and retry boundaries.** Ensure provider calls and background jobs have bounded retries, timeouts, idempotency keys, dead-letter/failed-state visibility, and no secrets/PII in logs.
3. **Check scheduled job concurrency.** `ScheduleModule` is enabled. `CollectionsService.runQueue` runs each minute and `runEvaluation` each hour on every API replica. Action processing has a conditional `PENDING` → `PROCESSING` claim, but invoice/case evaluation is scanned independently per replica. Review leader/lease behavior, provider timeouts versus the 15-minute stale-action reclaim, transaction duration, and restart safety before scaling beyond one API replica.
4. **Keep database and app contracts aligned.** Validate migration deploy against a production-like copy of the dump, confirm enum changes and nullable/default transitions, and verify seed scripts are safe to re-run and not required on production startup.
5. **Add release-level integration coverage.** Existing API test suites are extensive, but confirm critical end-to-end flows span auth, tenant scoping, state transitions, provider callbacks, and data persistence—not only isolated service mocks.

### P2 — performance and scale

1. **Measure hot paths first.** Add request IDs, route latency histograms, database query timing, error rates, and provider latency. Set dashboards/alerts for p95/p99, DB pool saturation, job lag, and payment callback failures. Do not optimize based on source size alone. The hourly collection scan pages all overdue invoices and active collection cases, holds distinct client/rider pairs in memory, then evaluates them serially; measure its runtime and memory as data grows, and consider a bounded claimable queue instead of a full scan.
2. **Bound all collection reads.** Audit list/export handlers for mandatory maximum page size, stable ordering, and cursor pagination on large/changing datasets. Ensure expensive exports stream or run asynchronously rather than loading unbounded data in memory.
3. **Reduce over-fetching.** The API has roughly 812 `include`/`select` occurrences, which is not inherently bad but merits checking response-heavy paths for nested over-fetch and N+1 behavior. Prefer explicit `select`, aggregate in SQL where practical, and batch relation lookups.
4. **Tune indexes from query plans.** Use production-like data and `EXPLAIN (ANALYZE, BUFFERS)` for highest-volume filters/joins. Prioritize tenant + status + timestamp patterns, foreign keys used in joins, and uniqueness required for idempotency. Avoid speculative indexes.
5. **Set database connection budgets.** Calculate total Prisma connections across API replicas, workers, and admin jobs against the database limit. Configure pool limits/timeouts and monitor saturation before scaling replicas.
6. **Cache only stable reference data.** Consider bounded caching for platform catalogs, vehicle categories, localization/configuration, and public client branding; invalidate on mutations and never cache tenant-sensitive or financial data without a clear key/TTL model.
7. **Flutter request behavior.** Inspect repeated provider invalidations/polling, large list pagination, image resizing/caching, and retry behavior on poor networks. Avoid automatic retries for non-idempotent mutations.

### Verified tooling issue

- `pnpm lint` currently aborts in the web ESLint process with Node heap exhaustion at roughly 4 GB. Raising the heap to 8 GB did not produce diagnostics promptly in this environment, so that run was stopped. API lint and both typechecks pass. Before relying on the monorepo lint script in CI/release, scope ESLint to intended web source files, check ignored/generated directories, and/or configure a suitable CI heap; do not treat this as a clean web lint result.
- Isolating the web lint issue showed `apps/web/src/app/client/page.tsx` (3,558 lines) also exhausts the same heap when linted alone. The 6,141-line Super Admin dashboard lints on its own; after removing three unused locals it reports only two `<img>` warnings for a blob preview and externally configured/signed logo URLs. Replacing those with optimized images would require safely constraining configurable storage hosts, so they remain intentional pending an image-host configuration decision. Decomposing the largest pages is a concrete maintainability/tooling priority.
- The old fleet detail loader made 7 fixed API requests plus one photo-list request per battery/controller. The retained flow now loads only fleet detail and current state (2 requests); a separate active `FleetEvidenceDialog` owns evidence browsing and uploads. This removes redundant network work from fleet detail while preserving the current evidence workflow.

### Maintainability and launch hygiene

- Replace the NestJS starter README in `apps/api/README.md` with project-specific setup, environment variables, routes, migration/deploy process, seed policy, and incident procedures.
- Keep API documentation generated from decorators and verify it against clients at release time.
- Split very large UI entrypoints such as `apps/web/src/app/client/page.tsx` and `apps/web/src/app/platform/dashboard/page.tsx` into feature modules to reduce change coupling and make production fixes safer.
- Establish ownership for each domain, migration, scheduled job, provider integration, and alert.
- Ensure generated output (`apps/site/dist`) and local database dumps are handled intentionally in version control and deployment packaging.

## Suggested pre-production sequence

1. Freeze intended launch features and produce the handler inventory.
2. Reconcile every route with web usage, Flutter reference calls and payloads, provider callbacks, and internal usage; remove confirmed deferred/dead backend handlers and their dependent backend code. Update web code only where its calls/contracts need cleanup.
3. Resolve `FleetDocument` ownership and decide whether to remove it before the database baseline is frozen.
4. Run migration deploy against a copy of the target schema/data; check table/column changes and rollback or forward-fix plan.
5. Run the project's `pnpm verify` and critical backend/web integration/e2e flows. Flutter remains unchanged; use its API wrappers and payloads as compatibility references. (Not run during this static audit.)
6. Run tenant-isolation, webhook/idempotency, backup-restore, and production-like performance checks.
7. Ship with dashboards, alerts, a route/domain owner map, and a concise incident runbook.

## Limits of this audit

This pass did not execute the app tests, Flutter analyzer, database queries, load tests, or security scans. It did not inspect cloud access logs or validate the dump against a running database. “No reference found” is repository evidence, not proof of zero runtime use. The report intentionally distinguishes a probable orphan (`FleetDocument`) from models whose usage is indirect.
