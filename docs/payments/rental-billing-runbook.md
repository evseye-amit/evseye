# Reliable rental billing: implementation and rollout

Implemented locally on `codex/reliable-rental-billing`. No staging migration, deployment, or historical financial recovery has been executed by this task. Flutter changes are documented in `ledger-history-flutter-handoff.md` only.

## Behavior

The existing hourly scheduler selected at most 20 schedules by period start, silently skipped conflicts, and could stop a batch on other errors. Collection already existed but depended on the rider payment profile and did not provide persistent operational failure details. An additional defect used the literal SYSTEM as an audit user ID while applying deployment receipts; automatic allocation could fail its user foreign key and roll back the invoice. System allocations now store a null audit actor.

The replacement runs every minute, claims up to 200 schedules within a 45-second budget, and processes each schedule once per invocation. Claims use PostgreSQL row locking, SKIP LOCKED, and a two-minute expiring lease. Each financial generation transaction locks the schedule and commits invoice/charges/payment allocations/cursor together. Competing requests for the same starting period return its existing invoice. Failed schedules receive a visible reason and exponential retry delay, capped at one hour; other riders continue.

Prepaid periods become due at period start; postpaid periods at period end, capped by termination/completion. Billing preserves the accepted plan interval, original handover anchor, timezone, commercial versions, tax rules, proration, and first-period fee rules. A daily plan generates daily bills; weekly/monthly plans keep their intervals. Date-only overdue evaluation preserves existing grace-day semantics but filters eligibility before limiting its batch.

Invoice generation uses existing deployment receipts and credits before collection. Collection runs independently every minute and after committed balance changes. It uses eligible cash/rewards under existing policy, never the deposit bucket. Insufficient funds leave a payable balance; subsequent funding retries it. Pending external payments prevent competing settlement. Unallocated non-deployment confirmed receipts block new collection until an operator reviews and allocates them using the existing payment workflow.

New payment profiles created at handover opt into ledger collection. Existing profiles are not silently migrated: use the explicit administrator action after reconciliation. This action initializes missing INR ledger accounts and changes collection preferences without enabling a bank mandate. Existing handover profiles retain their previous setting and appear as disabled in health checks if necessary.

## Controls

- `RENTAL_BILLING_ENABLED=false`: pause the new automatic invoice worker.
- `RENTAL_COLLECTION_ENABLED=false`: pause automatic collection and the rent-health retry-collection action. Existing unrelated explicit payment/admin operations retain their behavior.
- `RENTAL_BILLING_CLIENT_IDS=<comma-separated-client-ids>`: restrict automatic generation/collection to a pilot tenant list; empty means all tenants.

Defaults preserve automatic operation (`true`, all tenants). Set pauses and a pilot list explicitly for rollout. Manual recovery approval is an explicit financial action and is not disabled by the automatic-generation switch. A pause takes effect on the next worker/collection invocation, not by undoing in-flight committed work.

Migration: `apps/api/prisma/migrations/20261123090000_reliable_rental_billing/migration.sql`. Apply before starting the new application version; generate the Prisma client as part of the normal build. The migration timestamps existing schedules' automatic-processing boundary. Periods already due before this boundary are review-only. New handovers set the boundary to the exact handover timestamp.

## Operations UI and API

Client administrators have a **Payments → Rent billing** page. It shows rider name/mobile, agreement/plan, next billing due, last successful generation, outstanding invoices, available funds, deployment credit, and blockers. Fetch all batches for a complete tenant audit. Available funds are an indicative balance; category/reward limits may reduce the amount actually eligible for a particular bill.

Authenticated CLIENT_ADMIN endpoints under `/api/v1/client/rental-billing`:

- `GET ?page=1`: 50 agreements per batch, `hasMore`, automatic-switch states, latest global worker status. Global status exposes only status/timestamps, not other tenants' details.
- `GET /schedules/:id/preview`: exact next-period generation simulated inside an always-rolled-back transaction. This briefly takes locks but leaves no invoices, charges, allocations, audit rows, sequence increments, or cursor change.
- `POST /schedules/:id/approve-recovery`: body `{periodStart, fingerprint}` from preview. Recomputes and checks the financial preview, commits one period, and audits the actor and invoice. Changed pricing, taxes, credit/payment allocation, or cursor invalidates approval. Repeating the same approved request returns the original invoice.
- `POST /schedules/:id/retry`: queue a fresh attempt; does not bypass historical review.
- `POST /agreements/:id/repair-schedule`: restore a missing schedule from activated handover and frozen commercial terms. Does not invent a handover date or bill historical periods automatically. Invalid/missing commercial information requires correction first.
- `POST /riders/:id/enable-collection`: explicitly opt an existing profile into ledger settlement; pending external collection must be reconciled first.
- `POST /riders/:id/collect`: retry settlement under current policy and pause switches; records the administrator action.

All IDs are tenant-scoped. Missing configuration is reported rather than guessed. Existing direct billing/final-settlement administrative routes remain available with their existing authorization; the recovery workflow above is the recommended path for historical arrears.

## Historical recovery and rollout sequence

1. Deploy migration/API/web with automatic generation and collection paused and a pilot tenant allowlist. Stop old application instances before enabling workers; old hourly instances do not know the new recovery boundary.
2. Audit every batch. Reconcile pending provider payments, unallocated receipts, accepted commercial versions, tax coverage, missing profiles/schedules, and expected deployment credits. The read-only staging log check in this task found no old billing-error messages; that is not a rider-level data reconciliation.
3. Restore missing schedules only from saved activated handover records. Correct inconsistent source data via its established workflow. No synthetic balance credit should be added for already-paid deployment money.
4. Preview each historical period, review charges/credits/payment allocation with operations, then approve it. Approval posts one period only; later missed periods remain gated. Keep collection paused while reviewing arrears if automatic settlement would be premature.
5. Explicitly enable reconciled legacy rider profiles. Enable generation and collection for the pilot, verify one daily cycle, payment history, statements, and deposit invariants. Expand the allowlist after reconciliation.
6. Monitor per-rider errors, last success/next due, overdue backlog, and `RentalBillingWorkerRun`. Alert through existing monitoring on missing worker completion, increasing failures, and due schedules without successful processing. Worker run rows retain 30 days; crash-abandoned RUNNING rows are visible through stale start time. No cloud alarms were provisioned in this implementation.
7. For rollback, pause generation/collection, inspect any in-flight work, and retain financial history. Do not delete invoices or reset billing cursors. Use existing auditable reversal/credit workflows for corrections. Reverting to the old application requires keeping its billing job stopped, since it lacks the recovery gate.

## Verification

Use a disposable PostgreSQL database whose name includes `_test_`. Set `RENTAL_BILLING_TEST_DATABASE_URL` and run `test/rider-billing/rental-billing.integration.spec.ts`. Focused tests cover policy timing, worker concurrency, >20 riders, per-rider failure isolation, review gating, rollback previews, stale/idempotent approval, invoice visibility, and independent collection after funding. Existing wallet settlement tests cover reward limits and deposit isolation. Type-check both API and web and run the deployment-commercial integration regression suite before rollout.


Local verification completed on 2026-11-23:

- API and web TypeScript checks passed; the new Rent billing component passed ESLint.
- API broad run: 1,543 tests passed; four HTTP/TLS tests were blocked by sandbox socket permissions and all four passed when rerun with local socket access. 282 opt-in tests were skipped by that run.
- Dedicated disposable-PostgreSQL runs: six rental billing tests and all 34 deployment-commercial regression tests passed. Rental coverage includes the automatic deployment-receipt audit actor fix and no duplicate debit.
- Existing web test command: 25 tests passed.
- Local PostgreSQL used the repository schema with the unrelated PostGIS geography field represented as text because PostGIS is unavailable locally. Billing tables and the new migration were exercised against PostgreSQL. This is not a staging data audit or visual browser QA.
