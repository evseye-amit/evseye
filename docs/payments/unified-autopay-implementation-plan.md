# Unified AutoPay: implementation, migration and rollout plan

Prepared 21 November 2026. Status: backend implementation and authorized API cleanup completed locally on `codex/unified-autopay`; staging and production rollout pending. No live migration or deployment performed.

## Cleanup override — 21 November 2026

The user confirmed the Flutter implementation is updated and explicitly authorized removing legacy routes. This supersedes the compatibility/deprecation stages in the original plan below. Legacy rider mandate/wallet-preference routes, legacy client policy/recharge routes, capabilities v1 and the separate onboarding settings component are removed. The unified policy is the only availability preference. Webhooks, submitted-payment reconciliation, legacy financial records and migration tooling remain. No destructive database cleanup or production migration is part of this change.

Cleanup validation: 528 payment tests across 54 files passed, including explicit 404 coverage for all 20 retired route/method combinations. API/web TypeScript checks and 5 web payment tests passed. The actual application OpenAPI export confirms the retired controllers are unmounted.

Current contracts are documented in [the Flutter handoff](unified-autopay-flutter-handoff.md). New admin operations use `/client/autopay/recharges`; capabilities defaults to v2. Retired routes return 404 and explicit capability version 1 returns 400. This cleanup requires the updated app; no compatibility aliases are retained.

## Evidence and scope

Remote refs verified with `git ls-remote`: production branch `main` is `136a4fae920d6b95294999a74dcf7c1f9797bbe7`; staging branch `dev` is `3051bb401a540b99a78dafaa6d6253afb3624a8c`. Both have source tree `f788c1f82201b3bb07e71342ac2cd74851f4ef0e`. The reviewed checkout therefore matches production-branch source. This does not establish the SHA currently running in ECS, production configuration, rider counts, consent scope or provider state. Verify those read-only before executing migration. Flutter review used `/Users/amitgoyal/Documents/ChatGPT/rider_app` at `90039c1`; the other mobile workspace contains shared/fleet code and must be checked for consumers before retirement.

Source paths below are relative to this repository unless specified otherwise. Existing repository payment documentation is useful context, but its historical deployment/test status is not evidence of today's runtime.

## Findings in current code

1. `apps/api/src/payments/wallet-auto-recharge.service.ts` already implements ₹550/₹750 policy, explicit consent revisions, wallet locking, one unresolved request, verified capture credit, delayed submission and recovery. Its eligibility additionally requires `RiderPaymentProfile.autoPayEnabled`, `PaymentMandate.autoDebitEnabled`, an active mandate, active allocation, enabled client policy and enabled wallet preference. A wallet toggle alone is not authoritative today.
2. `apps/api/src/rider-billing/rider-billing-engine.service.ts` only settles generated invoices from the wallet when `autoSettleInvoiceFromWallet` is true. That flag defaults false in `apps/api/prisma/schema.prisma`. AutoPay funding does not itself establish ledger-based rent settlement.
3. `apps/api/src/payments/payment-orchestrator.service.ts` blocks direct RENTAL collection while wallet preference is enabled or a recharge is unresolved. This is useful protection, but durable collection mode is needed: turning AutoPay off must not restore direct rent collection. Other charge categories require the same migration review.
4. `apps/api/src/payments/deployment-autopay.service.ts` creates a mandate from onboarding payment evidence. This is not equivalent to accepting wallet threshold/recharge terms. The onboarding flow needs the same consent and activation service as standalone setup.
5. Billing receivables (`RiderLedgerEntry`, charges, invoices) and wallet accounting (`WalletLedgerEntry`, transactions, allocations) are separate. `wallet-billing.service.ts` allocates available cash/rewards and may only partly settle an invoice. Do not debit the same charge again just to make one screen look unified. Reconcile billing-ledger payment representation, wallet allocations and invoice balances explicitly; current wallet settlement has category-specific billing-ledger writes.
6. `riders/dto/rider-earnings.dto.ts` currently identifies earnings as REWARD, REFERRAL_REWARD and SELF_SUBMISSION_REWARD. These must not automatically become unrestricted cash. The wallet statement already separates CASH, REWARD and SECURITY_DEPOSIT.
7. Flutter `apps/rider_app/lib/features/payments/data/payments_repository_impl.dart` maps mandate status and `autoDebitEnabled`; `payments_page.dart` can show AutoPay turned on after mandate verification. Unified status must also account for funding consent and eligibility.
8. `.github/workflows/deploy-staging.yml` runs the candidate payment-readiness gate before service update. Production's workflow currently does not. Both migrate before updating ECS and build images for their own branch SHA; current workflows do not promote the same immutable staging image to production.
9. `payment-gateway-policy.service.ts` capabilities currently returns contractVersion 1, POLICY availability, connectivityVerified false and eight payment purposes, including UPI_AUTOPAY/ENACH; deployment gets a separate autoPaySetup boolean. This mixes payment purposes and mandate methods and does not represent wallet-funding readiness.

## Target behavior and accounting boundary

One rider-facing AutoPay switch and one client AutoPay policy. Existing-rider setup and onboarding are entry points into the same feature. Retain internal provider readiness, mandate lifecycle and operational kill switches; these are not competing rider preferences.

Use a durable per-rider collection mode: LEGACY_INVOICE during migration and LEDGER_WALLET after cutover. AutoPay on/off is independent of that mode. In LEDGER_WALLET mode, turning AutoPay off stops new bank funding; rent and other charges continue to be recorded and wallet settlement continues under the agreed billing rules. Never fall back to direct bank rent debit.

The default trigger remains available CASH strictly below ₹550, fixed ₹750 funding, one unresolved request and the existing 24-hour post-success cooldown. Retain the implementation's 25-hour notice plus submission buffer pending provider validation; do not promise immediate recharge or treat these implementation values as independently verified regulatory requirements. A successful recharge may still leave the account low: do not chain immediate debits. Show remaining dues and allow manual payment.

Keep receivables and wallet subledgers, with a unified rider statement linking each economic event to its allocations. Charges are visible even when funds are insufficient. Preserve existing negative-cash limits; do not silently enable unlimited credit. Show available cash, restricted rewards, deposits and unpaid dues separately. If a single net position is displayed, label its calculation and never use a total containing deposits/rewards as the cash trigger. A full replacement of both financial subledgers is outside this migration.

Implement an idempotent settlement coordinator: charge finalization -> persist receivable -> apply permitted wallet funds -> commit -> evaluate funding. On verified recharge or eligible earning credit, resume settlement of outstanding eligible invoices in deterministic order (due date then ID). Use a unique allocation/operation identity per settlement increment, not a forever-reused invoice key that prevents later partial payments. Retain charge source identity, original effective dates and reversal links. No provider calls inside accounting transactions.

## Implementation work packages

### 1. Inventory and contract freeze

Produce a read-only environment report: deployed image SHA/digest and task definition, migration history, client policy revisions, packages, gateway environment/version references, worker health and counts by rider migration cohort. Do not export secrets or rider PII. Enumerate all callers from rider, fleet manager, web, OpenAPI inventory and access telemetry. Capture current API fixtures before adapting routes.

Freeze the unified AutoPay DTO, consent text/version, stable reason codes and capabilities v2 with Flutter. Define eligible charge categories (rent, approved penalties and other deductions) and earnings settlement/reversal rules. Deposits remain a separate restricted liability.

### 2. Additive schema and unified service

Add durable collection mode and migration audit/checkpoint records. Reuse wallet preference/policy and mandate records; do not introduce another independently writable enabled flag. Add an immutable consent receipt or extend existing consent audit with policy revision, accepted text/version, actor, entry point, timestamp and mandate association. Preserve financial consent revision when only master availability changes.

Introduce one domain service to calculate effective status and perform enable/disable/cutover transitions. Existing flags become compatibility projections for migrated riders. Backfill without provider requests or money movements. Use consistent rider/wallet lock order across old and new workers. Validate pending legacy collection under that same lock immediately before cutover; offline cohort classification alone is insufficient.

### 3. Accounting and collection changes

Implement the settlement coordinator and durable retry/outbox work for all eligible balance changes, extending beyond the current rental-specific durable evaluation marker. Add reconciliation assertions for every category, including existing unpaid invoices and reversal paths. Enforce collection mode in scheduler, manual admin collection endpoints, retries and old API adapters. Preserve reconciliation of already-submitted legacy transactions after cutover; never stop webhook processing.

### 4. API, admin and capabilities cleanup

Proposed canonical rider resource (new contract, not yet implemented):

- `GET /api/v1/rider-app/autopay`: authoritative preference, effective status, policy terms/revision, mandate summary, blocking reasons, permitted actions and pending recharge summary.
- `PUT /api/v1/rider-app/autopay`: explicit enable/disable; enable accepts the reviewed policy revision and mandate association. Use optimistic preference revision to protect against stale devices; return a conflict rather than overwriting newer consent.
- `POST /api/v1/rider-app/autopay/mandates` for setup; `POST /api/v1/rider-app/autopay/mandates/:mandateId/verify` for verification; `POST /api/v1/rider-app/autopay/mandates/:mandateId/cancel` for bank mandate cancellation. Setup/cancel use stable idempotency keys.
- `GET /api/v1/rider-app/autopay/recharges` with bounded pagination for attempts/history. Detail/verification by operations remains role-scoped.

Keep bank mandate cancellation distinct from AutoPay off. Offer pause/resume only when the provider supports the operation; Razorpay bank pause/resume guidance remains UPI-app-managed. Do not invent backend support to simplify the screen.

Retirement inventory:

- Adapt existing `GET/POST /rider-app/payments/autopay` to the shared service, preserving response shapes during compatibility. Replace rider reads/setup with the canonical resource in new Flutter.
- Deprecate `/rider-app/payments/autopay/enable` and `/disable`, and `GET/PUT /rider-app/wallet/autopay`. Old disable must safely stop funding; old enable must not invent consent or reactivate direct collection. Return actionable conflict/upgrade-required behavior where the old request cannot express required consent.
- Replace separate client wallet/deployment policy screens with one `/client/autopay/policy` resource and audit history. Onboarding visibility follows unified availability; retain old controllers as adapters until consumers migrate. Do not OR existing switches to infer consent or silently change legacy onboarding behavior.
- Move legacy `upcoming`/`debits` UI to unified recharge history while keeping historical invoice debit records identifiable. Do not relabel invoice collections as wallet recharges.
- Retain client mandate/debit/dunning investigation, signed provider webhooks, refunds, settlement verification, manual top-up and generic checkout. They are not redundant because the rider has one switch. Retire old provider handlers only after historical references and late-event retention obligations are addressed.
- After adoption, remove duplicate controller DTOs, settings widgets, feature checks, tests for retired behavior and documentation examples. Update `docs/openapi-operation-inventory.json` and API contract snapshots. Remove obsolete database columns only in a later contract migration after rollback compatibility is no longer needed.

Capabilities v2: keep generic checkout purposes and add one small AutoPay capability, such as `{ supported, enrollmentEntryPoints, reasonCode }`. Remove UPI_AUTOPAY and ENACH from the v2 checkout-purpose list; supported mandate methods belong to AutoPay setup. Remove duplicate `DEPLOYMENT.autoPaySetup` from v2. Preserve checkout provider/platform information if the payment launcher uses it. Keep a single explicit policy-based availability indicator so capability does not imply live gateway connectivity. Do not add thresholds, balance, mandate IDs, consent state, histories, merchant credential versions, internal flags or verbose diagnostics to capabilities. Those belong in the AutoPay resource or privileged readiness tooling. Use a versioned endpoint/explicit version negotiation; do not replace the v1 payload in place. Fetch merchant/package configuration once per request and derive capabilities consistently without provider network calls.

Route removal gate: all supported clients migrated, telemetry shows no supported consumers over an agreed observation window (proposed 30 days), minimum app version policy is enforced where needed, operational consumers migrated, and rollback rehearsed. Zero traffic alone is insufficient for rarely opened old apps.

## Migration cohorts and execution

Migration script must support dry-run, client/rider allowlist, bounded batches, durable cursor, repeatable run ID, before/after snapshots and invariant reports. It must not create mandates, collect money or modify historical ledger entries.

- Existing wallet consent valid + adequate active mandate: preserve terms and consent; migrate collection mode after locked pending-collection checks and reconciliation. Do not make old inconsistent flags silently collectible; quarantine inconsistencies for explicit resolution.
- Direct-rent-only mandate: keep LEGACY_INVOICE until explicit wallet-funding consent and migration eligibility. The mandate may be reused only if provider scope/amount/expiry permits. Bank mandate existence alone is not consent.
- Both settings or inconsistent profile flags: review consent and pending financial state; do not resolve using boolean OR.
- Submitted/unknown legacy collection: defer cutover until authoritative resolution. Flag review cases without issuing a replacement debit.
- Disabled, revoked, expired or no consent: remain disabled; onboarding/standalone setup can obtain new consent later.
- No active allocation: permit saved consent/setup as designed, but show waiting-for-allocation and do not submit funding.
- Non-Razorpay or unsupported merchant: exclude from wallet-funding pilot; do not advertise the new feature based on generic mandate capability.

For migrated riders, explicitly set the billing policy required for wallet settlement with an audit trail; this is independent of enabling AutoPay. Do not sweep historical balances into cash. Report and repair proven discrepancies with separately reviewed compensating entries, never destructive rewrites.

## Staging first

1. Deploy additive schema and compatible backend through `dev`, with new enrollment/collection mode rollout disabled. Record build SHA, image digest and migration result. Existing workers must tolerate the expanded schema.
2. Run migration dry-run on staging; exercise each cohort with representative synthetic records. Re-run and confirm zero additional changes or financial effects.
3. Ship Flutter QA build and admin UI. Enable one staging client and explicit rider allowlist. Obtain fresh test consent through both entry points.
4. Test ₹549.99 triggers, ₹550 does not; insufficient funds/partial rent; earning credits; reversal; manual top-up while pending; insufficient mandate limit; changed terms; mandate revocation; return initiation; old app enable/disable; worker races/restart; duplicate/out-of-order webhooks; ambiguous provider responses; late capture; duplicate capture/refund review; cross-client isolation; migration during collection.
5. Run API/web typechecks and `pnpm --filter @evs-eye/api test:payments:release` against disposable migrated PostgreSQL; add targeted tests to existing billing, wallet and payment suites. Run Flutter analysis/unit/widget/integration tests in the owning repo. Test upgrade and mixed-version rollback, not only a clean database.
6. Observe at least two rental/recharge opportunities across configured notice and cooldown windows; propose a 72-hour minimum pilot, extend if no full cycles occur. Simulator/time-controlled tests supplement real elapsed provider tests. Sandbox evidence does not prove live bank behavior.
7. Exit only with zero duplicate collections/credits, no unexplained reconciliation differences, every unresolved request owned and explained, confirmed notification/resume behavior, unchanged manual payments, and successful rollback rehearsal. Store sanitized evidence with exact source/app versions.

## Production rollout after staging acceptance

Add production parity for the candidate payment-deployment gate before ECS update. First verify its read-only provider checks and environment credentials against production's intended clients. Record actual production baseline, backup/PITR readiness, recovery procedure and previous compatible image digest.

Merge only the accepted release to `main` after staging signoff; a successful main push may automatically deploy. Existing workflows rebuild for main SHA, so validate its source-tree equivalence to the accepted staging build and run CI again. If immutable artifact promotion is chosen, implement and test that workflow explicitly rather than claiming it already exists.

Deploy additive schema/backend with feature disabled; verify health, workers, webhooks and readiness. Run production migration dry-run, review cohort counts, then migrate a small approved client/rider cohort. Enable new funding only for consented eligible riders. Observe full live collection and reconciliation before expanding in controlled batches. Do not migrate all clients at once. Flutter minimum-version enforcement must precede endpoint retirement.

Monitor new direct-invoice submissions for migrated riders (must be zero), open request age, unknown/review counts, capture-to-credit lag, invoice/ledger/allocation discrepancies, worker leases, API conflicts, legacy route usage and notification failures. Any duplicate collection/credit, wrong-tenant posting, unexplained accounting mismatch or loss of submitted-payment tracking stops expansion immediately.

Rollback: disable new enrollment and new funding submissions for affected cohorts, retain financial tables, consent receipts, durable collection mode, webhooks and reconciliation. Redeploy only a backward-compatible image that understands migrated collection mode. Never revert a rider automatically to direct rental collection or restore a database snapshot over live payment history. Correct accounting through idempotent compensating records. Re-enable only after pending outcomes are reconciled and the cause is understood.

## Delivery sequence and ownership

1. Backend: inventory, unified contract and additive schema/service.
2. Backend: settlement coordinator, compatibility adapters and onboarding integration.
3. Web + Flutter: one setting, state-aware consent/setup and capabilities v2 consumers.
4. Backend + QA: migration tooling, concurrency/reconciliation tests and staging pilot.
5. Release owner: staging evidence signoff, production gate parity and controlled production rollout.
6. Backend + Flutter + operations: telemetry-backed endpoint retirement, then delayed schema cleanup.

No production enablement is implied by this planning document. Outstanding preflight evidence: deployed ECS SHA, live cohort counts, consent/provider scope, actual supported app versions, runtime configuration and staging/live collection evidence.

## Implementation delivery notes

Implemented additive collection-mode and preference-revision schema; unified rider and client-policy APIs; version-negotiated capabilities v2; retired legacy routes; explicit consent and stale-write checks; onboarding consent snapshot/recovery; permanent prevention of direct invoice bank collections for migrated riders; deterministic partial-invoice settlement recovery; billing-ledger settlement/reversal links; client-allowlisted rollout; migration dry-run/apply tooling; unified admin settings for pilot clients; and the production candidate payment-readiness gate.

Flutter source is not changed: this repository delivers the backend and the implementation handoff for the Flutter team. Legacy AutoPay API removal is now authorized after the user confirmed Flutter was updated. Historical database records and financial columns are retained. Provider webhooks, historical records and reconciliation are retained.

Migration command from `apps/api`, with DATABASE_URL supplied securely for the selected environment:

```sh
node scripts/migrate-unified-autopay.mjs --client=CLIENT_UUID --run=RUN_ID --limit=100
```

Default is dry-run. Review cohort counts, then add `--apply` for the same allowlisted cohort. Resume using `--after=NEXT_CURSOR`; preserve each JSON result with the release evidence. The script uses rider/wallet locks, preserves consent, writes a migration audit per changed rider and never makes provider requests or ledger postings. A repeated apply classifies changed riders as ALREADY_MIGRATED. Only eligible existing wallet-consented riders migrate automatically; others need consent or review.

The migration changes settlement behavior for eligible riders, so apply only after baseline reconciliation and staging acceptance. The schema migration alone changes no rider mode and opts nobody in. Because settlement continues when funding is disabled, rollback must use compatible code and must not reverse collection mode.

Validation: 515 payment release tests across 55 files passed; 59 focused wallet/payment tests, 35 final contract/policy checks and 5 web payment tests passed. API and web TypeScript checks passed. OpenAPI route inventory includes the nine new operations. The disposable PostgreSQL environment applies repository financial migrations, with only unrelated PostGIS extension/location triggers/indexes omitted because PostGIS is unavailable locally. This is simulated-provider testing, not live bank validation.
