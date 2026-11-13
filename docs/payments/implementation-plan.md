# Payment integration implementation tracker

## Phase 7 and operations follow-up — 2026-11-14

Implemented locally: optional client-specific Cashfree configuration and saved credential binding across checkout, mandates, debits, refunds and webhooks; direct Razorpay/Cashfree settlement ingestion for balanced supported reports; audited bank-evidence confirmation; verified Razorpay external-refund adoption; durable in-app client-admin alerts with assignment and acknowledgement. Existing Razorpay deployments do not require any Cashfree configuration. See [scope, API contracts and acceptance](phase-7-cashfree-and-operations.md).

Validation: 338 payment/deployment tests passed across 41 files with database suites enabled, plus 15 environment tests and 24 web tests; API/web TypeScript, Prisma validation and targeted lint passed.

This supersedes the older open-work notes below. Bank confirmation is an operator attestation, alert routing is in-app, and external-refund adoption currently covers Razorpay invoice/penalty/AutoPay sources. Unsupported settlement event types require review. Staging rollout and live merchant/mobile acceptance are still release gates.

## Worker coordination follow-up — 2026-11-14

The hourly collection job and minute-based Razorpay AutoPay/deployment recovery jobs now claim shared PostgreSQL leases before running. A shared module supplies the lease service without introducing an allocations/payments module cycle. Workers fail closed if lease infrastructure is absent; the automation migration must be applied before deployment. Successful scheduled batches use a 30-second cooldown so completion time does not suppress the next hourly or minute tick; failed batches retain exponential backoff. Existing provider idempotency and accounting protections remain necessary because crash recovery is at-least-once.

Validation for this follow-up: 316 payment/deployment tests passed across 38 files with all database suites enabled; API TypeScript and whitespace checks passed. The disposable database was stopped after validation. No staging deployment was performed.

Phase 7 (client-specific Cashfree rollout) is not implemented: new and historical checkout, mandate, debit, refund and webhook paths still need immutable merchant binding before policy routing can be enabled. Phase 6 also retains the open ingestion, bank evidence, external-refund adoption and alert-routing items below. Flutter source remains unchanged.

## Phase 6 automation implementation — 2026-11-14

Implemented locally: version-bound Razorpay invoice/penalty/AutoPay refund submission and recovery; signed refund inbox handling; idempotent rider/wallet reversals; tenant-scoped manual and scheduled settlement rematching; database leases/backoff for the new refund/settlement recovery workers; aged-refund log events. A new additive migration creates recovery jobs and repairs the missing refund-number sequence. Collection detail exposes refund totals/status without Flutter source changes. See [Phase 6 operations and boundaries](web-payment-operations.md#phase-6-refund-and-settlement-recovery--2026-11-14).

This does not claim complete production acceptance or direct gateway statement ingestion. Normalized report imports remain the settlement input; bank confirmation, external-refund adoption and alert subscription setup remain open. Flutter owns final mobile acceptance. Changes are not committed/deployed by this implementation turn.


## Phase 5 implementation — 2026-11-14

Implemented the remaining Razorpay web configuration workflow: merchant account preservation/editing, retained-version history, change review, explicit reload and protection against stale admin edits. Added combined gateway/state/reference filters to payment operations. Existing reconciliation, supported refunds, mandate lists and normalized settlement import remain integrated. See [web operations scope](web-payment-operations.md). These additions are local and not yet deployed. Phase 5 history pagination, full-history CSV export and rider labels are now implemented locally. Additional gateway adapters, advanced refund/settlement workflows and worker coordination remain Phase 6/later scope. Operational history is live, not a point-in-time audit snapshot; see the documented export limitations. Mobile acceptance stays with the Flutter team and remains a release gate.

## Staging verification — 2026-11-14

Ownership update: final two-merchant payment execution and Android/iOS acceptance belong to the Flutter team on mobile. The detailed checkout, duplicate delivery, lost-callback reconciliation and tenant-isolation scenarios are in [Flutter acceptance criteria](flutter-team-handoff.md#two-merchant-sandbox-acceptance-android-and-ios). Backend support retains responsibility for fixture preparation, webhook configuration, historical credential recovery and financial-posting evidence. These tests remain pending, not implicitly passed by handoff. The next development scope is the remaining Phase 5 web configuration and operations work; mobile acceptance remains a release gate.

Authenticated follow-up: the user completed staging RIDER_APP OTP login separately for the selected Pinkrides and Yogmaya riders. Both authenticated calls to `/api/v1/rider-app/payments/orders/capabilities` returned contractVersion 1, availabilityBasis POLICY and connectivityVerified false. Both enable Razorpay DEPLOYMENT, SUBMISSION_PENALTY, INVOICE and UPI_AUTOPAY for Android/iOS; OUTSTANDING, SECURITY_DEPOSIT, TOP_UP and ENACH explicitly return PAYMENT_CAPABILITY_UNAVAILABLE. This verifies two authenticated capability responses, not cross-tenant resource isolation or completed payment flows. The temporary loopback test page supports login and capabilities only; checkout, webhook delivery and callbackless recovery have not been exercised through it.

Supersedes the missing-migration/deployment findings from November 13. Staging API revision `evseye-staging-api:201`, image commit `42558bc7510a61ddf1b00758f96261b4ecd73bed`, has completed rollout (1 desired / 1 running). Read-only inspection confirmed the configuration-version table and successful migration record for `20261113180000_payment_configuration_versions`. The deployed common service includes capabilities and callbackless reconciliation. Public `GET /api/v1/rider-app/payments/orders/capabilities` and `POST /api/v1/rider-app/payments/orders/probe-missing/reconcile` both returned 401 with `Missing access token.`; authenticated response behavior is not certified by this check.

Yogmaya and Pinkrides both resolve distinct ACTIVE Razorpay TEST keys and returned HTTP 200 from read-only gateway order queries. Production credentials were not exercised. Inspected counts: 0 unsealed TEST configuration snapshots, 0 unbound pending Razorpay collection orders, and 0 unbound active/pending Razorpay mandates. This was a partial read-only inventory, not the full readiness command or an end-to-end payment test. The probe's initial HTTP paths omitted `/orders` and returned 404; the corrected public routes above were checked separately.

Remaining: test invoice/allocation details; Flutter-owned two-merchant checkout, callback/webhook/recovery and isolation tests; backend-supported historical credential recovery; Flutter-team review and Android/iOS acceptance. Both selected riders have completed staging authentication. No payment mutations or Flutter edits were made during this verification.

## Historical checkpoint — 2026-11-13 (superseded by staging verification above)

Phase 1–4 closure takes priority; further Phase 5 implementation is on hold. Existing later-phase changes remain in the working tree and must not be bundled accidentally into a Phase 1–4 staging release.

Latest closure validation: **287 tests passed across 33 files, no skips**, including all 34 deployment-commercial tests and seven new HTTP-boundary/readiness checks. Concurrent penalty and rental callbacks now retry uniqueness races in a fresh bounded transaction, preserving the existing identity and single-posting checks. HTTP tests use synthetic authentication with the real role guard; they do not certify deployed JWT configuration. PostgreSQL validation used the disposable local database with the previously documented unrelated geography substitution, not a production-equivalent migration deployment.

Staging inspection (2026-11-13): Yogmaya and Pinkrides each have an ACTIVE Razorpay TEST merchant, distinct test keys, available key/webhook secrets, and successful HTTP 200 responses from the read-only Razorpay orders API. Runtime environment is TEST. Pinkrides also has a production configuration; it was not exercised. No gateway mutations or database writes were performed. The one-off ECS inspection task exited successfully.

Staging API task definition `evseye-staging-api:200` runs image revision `99f01d4ca5e5b7cfd164f95b76d440fa2c491dee`. The configuration-version table and migration `20261113180000_payment_configuration_versions` are absent. The deployed common service lacks capabilities and callbackless reconciliation. These findings block deployed acceptance, despite valid sandbox credentials. Credential presence does not establish webhook delivery, payment completion, rotation, or tenant isolation end to end.

Remaining release sequence:

1. Prepare a reviewed Phase 1–4 release from the mixed working tree, apply its additive migrations, and deploy that API revision to staging.
2. Run the read-only inventory below against staging; resolve ambiguous legacy bindings explicitly and seal initial credential snapshots before rotation.
3. Exercise Yogmaya and Pinkrides TEST orders, callback/webhook duplicates, wrong-tenant access, lost-callback reconciliation, and historical credential recovery. Record deployed revision and results. Verify merchant dashboard webhook routing and delivery separately.
4. Obtain Flutter-team contract review and device acceptance against that revision. Flutter implementation belongs exclusively to that team.

Repeatable local gate: from `apps/api`, run `pnpm test:payments:release` with all five disposable database variables set: `RENTAL_PAYMENT_TEST_DATABASE_URL`, `AUTOPAY_TEST_DATABASE_URL`, `PENALTY_PAYMENT_TEST_DATABASE_URL`, `PAYMENT_CONFIGURATION_TEST_DATABASE_URL`, and `DEPLOYMENT_PLAN_TEST_DATABASE_URL`. Database names must contain `_test_`; absent variables fail immediately instead of skipping integration tests.

Read-only release inventory: run `pnpm payment:readiness` with `PAYMENT_READINESS_DATABASE_URL` supplied securely and `PAYMENT_READINESS_ENVIRONMENT=TEST` (or explicitly `PRODUCTION`). It uses a read-only transaction and emits counts only. Exit 0 means local inventory checks clear, 2 means review required, and 1 means the check failed. Configuration counts are environment-scoped; pending-record counts cover the entire database. This tool neither backfills records nor proves gateway readiness.

Conversation Phase 4 backend implementation and Flutter handoff are implemented locally. The capabilities endpoint explicitly describes policy eligibility rather than gateway connectivity. The common API adds typed checkout payloads, saved Cashfree environment and ownership-checked callbackless reconciliation. Legacy Cashfree environment is never guessed. Contract tests cover both providers, wallet-only success, state mapping, ownership and saved-provider recovery. See [contract v1.1](mobile-payment-api-contract-v1.md) and [Flutter-team handoff](flutter-team-handoff.md).

Flutter code is unchanged. Flutter implementation, team review, sandbox/device certification, deployed build identifier and rollout remain pending; local completion does not mean these external acceptance gates passed.

Web/operations work has begun: the client payment page now has reconciliation, deployment capture visibility, supported refund requests/verification, AutoPay mandate visibility, and normalized Cashfree/Razorpay settlement import/detail screens. Configuration labels distinguish resolved credentials from verified connectivity and show current version. Refund operations resolve the saved provider rather than the global checkout default. PostgreSQL adapter serialization/deadlock codes are handled in bounded transaction retries.

Still pending in later phases: automatic Razorpay invoice/penalty/AutoPay refunds and their accounting/webhook lifecycle; distributed worker leases/backoff/aging alerts; provider-specific Cashfree configuration and deployment; richer merchant rotation/configuration workflows; direct gateway settlement-report ingestion and exception resolution/rematching. Manual normalized report matching is not proof of bank receipt. The earlier deployment-commercial failures have been resolved locally: offer acceptance now handles adapter serialization errors, and assertions inspect the current provider-neutral attempt/capture models.

Numbering: conversation Phase 2 maps to stages 1a/1b; conversation Phase 3 maps to stages 2/3; conversation Phase 4 maps to stage 4. Stage 5 is web operations, stage 6 refunds/settlements/coordination, stage 7 client-specific Cashfree.

Checkpoint validation: **246 payment tests passed across 30 files, with no skipped tests**, including PostgreSQL migration/rotation, financial concurrency and settlement import/tenant isolation. API and web TypeScript checks passed; targeted payment/backend and changed-component web lint passed; all 22 configured web tests passed; diff whitespace checks passed. Browser smoke tests with mocked APIs verified panel navigation, provider checks and identical refund body/key replay after 503. The first database run exposed Prisma adapter retry metadata handling; the added settlement integration test exposed invalid nested tenant-key input. Both were corrected and the final full suite passed. Testing reused the disposable Phase 3 database described below (including its unrelated geographic-field substitution); no production migration or live provider test occurred. Local test servers were stopped afterward.

Operations scope and normalized import format: [web-payment-operations.md](web-payment-operations.md).

## Conversation Phase 3 — client policy and merchant versions

Implemented locally for the currently supported capabilities. New Razorpay payments and mandates retain merchant version identity; verification, reconciliation, cancellation and existing deployment refunds resolve historical credentials. One client/environment policy governs new payment selection and rejects caller overrides or unsupported capabilities. Legacy shared Cashfree remains supported only where no client merchant configuration exists; client-specific Cashfree and missing Razorpay purposes remain later-phase adapter work.

Validation: 216 payment tests passed across 27 files, including database suites, with no skipped payment tests; TypeScript, Prisma schema validation and payment lint passed. The separate deployment-commercial suite has 27 failures during commercial-offer acceptance before payment assertions (7 passed). See [Phase 3 rollout and boundaries](phase-3-gateway-policy-and-versions.md). Production migration, deployment and live sandbox/device validation remain pending.

## Conversation Phase 2 — credential and webhook fixes

The conversation's Phase 2 corresponds to stages 1a/1b below (the numbered stage 2 below is historical configuration versioning).

Credential and webhook fixes are implemented locally: invoice and AutoPay checkout keys resolve per client, saved keys are enforced, client-scoped webhook ingress resolves recurring and one-time payment ownership, and recovery retains the verified client. Configuration snapshot resolution also rejects merchant-account mismatches. Existing versioning work has been preserved; full historical-payment version binding remains a separate stage.

Latest local payment/provider-settlement regression run: 155 passed, 38 database-dependent tests skipped. Razorpay lint and diff whitespace checks passed. Database migration, sandbox merchant validation and production deployment remain outstanding. See the rollout guide for required client webhook URLs and legacy-event handling.

Scope: EvsEye backend, Prisma, web, tests and documentation. Flutter changes belong to the mobile team. No live gateway or database changes are part of the baseline.

## Baseline

| Purpose | Current selection | Gap |
|---|---|---|
| Deployment | ClientPaymentProvider, Razorpay-only router | Other adapters absent |
| Penalties | Razorpay default, optional Cashfree | Caller choice not unified with client policy |
| Invoice | Explicit Razorpay or global configured checkout | Credential/routing inconsistency |
| Outstanding / deposit / top-up | Global PAYMENT_PROVIDER | No per-client selection |
| AutoPay | Global AUTOPAY_PROVIDER / PAYMENT_PROVIDER | Per-client selection pending |
| General refund | Cashfree; Razorpay rejected for support review | Razorpay invoice/penalty/AutoPay refund support |
| Deployment refund | Separate Razorpay capture path | Unified operations pending |
| Settlement import | Cashfree | Razorpay matching pending |

## Controlled stages

| Stage | Deliverable | Gate | Status |
|---|---|---|---|
| 0 | Baseline, mobile issue register, draft contract | Current and proposed behaviour distinguished | Complete |
| 1a | Resolve invoice checkout key from client configuration | Tenant-key regression tests and payment suite | Implemented; validation below |
| 1b | AutoPay key consistency, saved-key enforcement, merchant webhook resolution | Two-merchant callbacks, token events, unknown-order recovery | Implemented locally; rollout gate below |
| 2 | Immutable configuration versions; attempts/mandates reference origin | Rotation, legacy backfill and rollback integration tests | Implemented locally; PostgreSQL checks passed |
| 3 | Client policy resolver and capability-based adapters | All purposes obey client policy | Implemented for existing capabilities; unsupported purposes fail explicitly |
| 4 | Final mobile contract and executable contract tests | Flutter review; compatibility tests | Implemented locally; team/device/deployment acceptance pending |
| 5 | Web configuration and operations UI | Admin workflow tests | Implemented locally, including version review, stale-edit protection, history pagination and CSV export; staging admin acceptance pending |
| 6 | Refunds, settlement matching, worker coordination | Concurrent recovery/refund integration tests | Razorpay refunds and settlement rematching implemented locally; new recovery workers have leases/backoff. Direct ingestion, external-refund adoption, existing charging-worker coordination and release acceptance remain open |
| 7 | Client-specific Cashfree rollout | Sandbox flows and gateway-switch validation | Pending |

Each stage is a separate review checkpoint. Use additive schema migrations first. Preserve current mobile endpoints during transition. A gateway switch affects new payments; existing attempts retain their original merchant configuration. Never automatically fail over an uncertain charge to another gateway.

## Acceptance matrix

- Two clients with different merchant keys: order, callback, webhook, reconciliation and refund remain scoped correctly.
- Credential rotation: old orders/mandates remain recoverable; new requests use the new version.
- Duplicate taps, duplicate/out-of-order webhooks, remote success followed by local crash: one financial posting.
- Provider timeout: uncertain state remains visible; no blind new charge.
- Mismatched order, amount, currency, tenant or signature: no settlement.
- Late/duplicate capture, partial/full refund, external refund: visible and reconciled.
- Multi-instance workers: claims prevent duplicate mutations and bound retry load.
- Old Flutter client: existing deployment/penalty flow remains compatible.

## Validation baseline

Review run: 158 passing tests in 22 files; 38 skipped tests in three database suites. Database suites require RENTAL_PAYMENT_TEST_DATABASE_URL, AUTOPAY_TEST_DATABASE_URL and PENALTY_PAYMENT_TEST_DATABASE_URL. These must target disposable test databases. No live gateway/device certification has been performed.

## Checkpoint 1a validation

Rental invoice checkout now resolves the client key before wallet mutation and persists it on the gateway order. Three new regression cases cover two distinct client keys and unavailable credentials. Payment/provider settlement suite: 132 passed, 38 database-dependent tests skipped. No schema migration or deployment performed. AutoPay and webhook fixes remain pending in stage 1b; this checkpoint does not establish full merchant isolation.

Backend TypeScript check (`tsc --noEmit --incremental false`) passed. `git diff --check` passed.

## Checkpoint 1b

AutoPay registration/debit keys now resolve per client. Saved-key checks are asynchronous and awaited across Razorpay operations. Explicit unusable merchant configuration no longer falls back to the global account. Webhook ingress resolves deployment, collection, AutoPay authorization/debit and token references, verifies the client signature, and persists the merchant in the inbox. Workers use that client for unknown-order recovery and reject ownership conflicts.

Added client-specific webhook route: `/api/v1/webhooks/payments/razorpay/clients/<client-uuid>`. The generic route remains for locally known references. See [Phase 1b rollout](phase-1b-rollout.md) for dashboard configuration, legacy-event redelivery and historical-key limitations. No Flutter changes are required. No migration or deployment performed. Immutable configuration versions and atomic configuration snapshots remain Phase 2 work.

Phase 1b local validation: 156 tests passed in 21 files; 72 tests skipped in four database-dependent suites (including deployment commercial integration). Backend TypeScript (`tsc --noEmit --incremental false`), targeted Razorpay lint, and `git diff --check` passed. Sandbox/provider dashboard and database integration release gates remain outstanding.
