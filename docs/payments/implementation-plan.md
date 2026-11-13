# Payment integration implementation tracker

## Current checkpoint — 2026-11-13 (supersedes historical status below)

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
| 5 | Web configuration and operations UI | Admin workflow tests | Initial operations panel implemented; broader configuration workflows pending |
| 6 | Refunds, settlement matching, worker coordination | Concurrent recovery/refund integration tests | Saved-provider refunds and provider-aware matching implemented; general Razorpay refunds/distributed workers pending |
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
