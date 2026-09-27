# Phase 8 Implementation Report — Collections and Dunning

## Scope and reused components

Phase 8 consumes finalized Phase 6 `RiderInvoice.outstandingAmount`, `dueDate`, the Phase 6 payment allocation and reconciliation services, Phase 7 `PaymentOrchestratorService` and payment collection policy, Nest scheduling, client identity, role guards, and the existing audit log. It does not recompute rental, tax, deposit, or invoice prices. The existing OTP SMS adapter is for authentication templates and is not used to send collection messages.

## Files and migration

New files:

- `apps/api/src/collections/collection-math.ts` and tests
- `apps/api/src/collections/collections.service.ts`, controller, module, unit tests, and disposable PostgreSQL integration test
- `apps/api/prisma/migrations/20260927050000_collections_phase8/migration.sql`

Modified files:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/api/src/rider-billing/rider-billing.service.ts`
- `apps/api/src/allocations/allocations.service.ts` and tests
- `apps/api/src/vehicle-exchanges/vehicle-exchange.service.ts` and tests
- `apps/api/src/rider-rate-cards/commercial-lifecycle.service.ts` and tests

New Prisma models: `CollectionPolicy`, `CollectionPolicyVersion`, `CollectionPolicyStage`, `RiderCollectionCase`, `CollectionCaseInvoice`, `CollectionAction`, `PromiseToPay`, `CollectionCaseNote`, `CollectionTask`, `CollectionWaiver`, `LateFeePolicy`, `CollectionDispute`, `CommercialRestriction`, `CollectionEvent`, and `CollectionEvaluationQueue`. Existing Prisma models were not structurally changed.

The migration adds active-case uniqueness, unique action keys, one active promise per case, a partial unique index for one active policy per client, indexes for case and action work queues, composite foreign keys for client isolation, and positive promise amount checks. Invoice insert/update triggers enqueue reevaluation in the billing transaction. Collection events are mirrored to `AuditLog` by a database trigger. The migration applied successfully to a disposable PostgreSQL database, which was removed after verification. It was not applied to the application database; that database has pending earlier migrations and its current PostgreSQL image lacks PostGIS, which an earlier nearest-hub migration requires.

## Policy and delinquency

Collection policies are client scoped and versioned. A case keeps its governing policy version. A policy defines grace days, dunning enablement, AutoPay retry, promise hold, restriction and late fee enablement, message limits, hours and timezone. Stages are ordered by configured days from due date and contain configured actions. Days past due are calculated from calendar dates in the policy timezone. Grace never changes the invoice due date. Case balances are refreshed from issued invoice outstanding amounts, and deposit balances remain separate.

## Cases, actions, and communications

One active case per rider is enforced with a unique active rider key and a rider row lock in serializable evaluation transactions. A case links every due invoice. UUID based case numbers avoid count-based sequence races. Stage action keys deduplicate reminders per local day and human tasks per stage. Actions recheck case state, current invoice balance, promise/dispute hold, communication hours, and frequency limits before processing. Stale processing leases are recovered.

Reminder actions become `READY` with a template code and minimal payment facts for the rider summary API. `READY` means visible in-app, not delivered by SMS, WhatsApp, email, or native push. No collection-approved provider/template is configured for those transports. The existing OTP provider cannot safely be reused for financial messages. The API records the requested channel and an `IN_APP_ONLY` delivery result so that operators cannot mistake queueing for external delivery.

AutoPay retry actions call the Phase 7 orchestrator after checking the Phase 7 payment policy, rider AutoPay setting, attempt status, retryability, interval, and promise/dispute hold. The orchestrator performs mandate and outstanding revalidation. Human action types create idempotent operations tasks.

## Promises, waivers, disputes, restrictions

Promises validate amount against due outstanding, the configured maximum date, and one active promise per case. Evaluation derives fulfilled, partial, or broken state from confirmed, unreversed payment allocations on case invoices after the promise was made. Promises never reduce invoice outstanding. Notes are append-only; cases support assignment, tasks, waiver request/approval/application, and disputes with holds. Financial waiver application posts a Phase 6 credit for subsequent billing; it does not edit the issued invoice. Restriction waivers remove case-owned active restrictions.

Late fee policy supports `NONE`, `FIXED`, `PER_DAY`, `PERCENTAGE`, and `TIERED` configuration. Actual posting is an explicit client-admin action for fixed, per-day, and percentage policies. It uses Phase 6 `postCharge`, stable source keys, and a second outstanding check inside the billing transaction. `TIERED` remains configuration-only until tier rules are defined. No automatic late-fee charge is performed by the scheduler. The billing handoff compares the exact overdue balance again inside its serializable transaction.

Commercial restrictions are case sourced and require a client-admin apply action. A current due balance is rechecked. New vehicle allocation, commercial vehicle exchange, and new rental offers consult active restrictions. Safety exchange reason codes bypass a commercial exchange restriction. No vehicle immobilization, automatic agreement termination, or account blocking is performed. Cases resolve when due obligations clear; only restrictions belonging to that case are removed. Resolution distinguishes payment from invoice reversal.

## APIs and access control

Operations endpoints under `/api/v1/collections` provide policy versions, dashboard and ageing, case list/detail, rider summary, evaluation, assignment, notes, promises, tasks, waivers, disputes, manual actions, late fee policy/posting, and restriction review/apply/removal. Rider endpoints under `/api/v1/rider-app/collections` expose a sanitized payment-due summary and a policy-validated promise request. All client IDs come from authenticated context; rider access is bound to the authenticated rider. Client admins approve/apply waivers and apply restrictions or late fees. Operations managers can view and manage cases. The case detail includes linked invoices, agreement/vehicle, payment attempts, mandate, promises, tasks, restrictions, and event timeline.

## Scheduler, idempotency, audit, observability

An hourly scan is a safety net for overdue invoices and active cases. A minute queue processes invoice changes written by the database trigger; action processing has a conditional claim and stale lease recovery. The database enforces active-case, active-promise, action, task, and charge/credit source uniqueness. Collection event records and audit trigger preserve a timeline of key decisions. Scheduler and action failures log case/action IDs without logging credentials.

## Verification

- Prisma schema validation: PASS.
- Phase 8 migration SQL in disposable PostgreSQL: PASS.
- Phase 8 unit tests: PASS (8 tests).
- Disposable PostgreSQL integration scenario: PASS (concurrent case creation, case reuse, client isolation, audit, in-app reminder readiness, task scheduling, promise hold, late-fee idempotency, maker-checker waiver approval, unchanged issued invoice, partial and full payment, partial and full promise fulfillment, restriction removal, and Phase 6 reconciliation).
- API unit suite: PASS (304 tests; the database integration test is skipped unless `PHASE8_TEST_DATABASE_URL` is supplied).
- API e2e suite: PASS (8 tests, run with local socket permission).
- Lint: PASS with existing warnings outside Phase 8; no Phase 8 warnings.
- Typecheck: PASS.
- Build: PASS.

## Known limitations

Collection SMS, WhatsApp, email, and native push delivery require approved provider templates and transport configuration. No collection capability code exists yet in the package catalog, so entitlement integration requires a package catalog decision; Phase 8 policy enablement currently governs collection actions. Current reminders are in-app records. Credit application to an already issued invoice is not implemented by the Phase 6 engine; a waiver posts a billing credit without mutating that invoice. `TIERED` late fees are configuration-only. A production database migration is pending its earlier PostGIS prerequisite. The disposable integration test does not exercise a live Cashfree account.
