# Phase 3: client gateway policy and merchant versions

Implemented locally. This phase consolidates gateway selection and connects the existing additive versioning migration to payment operations. It does not deploy the application or configure gateway dashboards.

## New-payment policy

`PaymentGatewayPolicyService` selects the client configuration for the runtime environment. Exactly one active, currently valid merchant configuration is required when client configuration exists. Disabled, expired, future and ambiguous configurations fail closed; caller-supplied providers cannot override the selection.

Supported capabilities are explicit:

- Client Razorpay: deployment, rental invoice, submission penalty and UPI AutoPay.
- Legacy shared Cashfree: invoice, penalty, outstanding, deposit, top-up, UPI AutoPay and eNACH.
- Mock: non-deployment capabilities for the existing development/test configuration.

Razorpay top-up, outstanding, deposit and eNACH requests are rejected until those adapters exist. A client-specific Cashfree configuration is rejected rather than using the shared Cashfree account. Full client-specific Cashfree implementation remains the later Cashfree phase. These restrictions deliberately expose existing capability gaps instead of sending a client's money to a different merchant.

The common API, direct Razorpay creation services, deployment router, general checkout creation and new AutoPay selection use this policy. Checkout recovery selects the saved provider rather than the current global default. AutoPay operations use the saved mandate provider.

## Originating merchant identity

New Razorpay deployment and collection orders save a configuration version alongside the checkout key. Mandate registration claims save the version before submitting the provider request. Scheduled debits inherit the mandate version and key; gateway debit claims retain that identity.

Provider requests, checkout signature verification, reconciliation, cancellation and existing deployment refunds use the saved version. New credentials govern new payments; an existing mandate continues using its originating merchant. Open deployment/penalty orders are reused after rotation instead of being replaced solely because the active key changed.

Webhook signatures are checked against retained versions for the client and runtime environment. The verified version is persisted in the inbox and supplied to unknown-order recovery. Existing local payment records retain their own version. Historical secrets may be retained after a configuration is disabled so that callbacks and recovery can finish. A missing historical secret cannot silently select the current account.

Credential references point to JSON environment secrets containing `keySecret` and `webhookSecret`. Every rotation must use a new immutable reference and retain the old reference. Fingerprints detect changes to retained secret contents. Database triggers prevent rewriting version identity or changing an already-bound payment version. The first migration snapshot is sealed on first resolution.

## Migration and rollout

1. Apply `20261113180000_payment_configuration_versions` before the new application code. The migration creates initial configuration snapshots and conservatively backfills records whose client, provider and saved key identify exactly one version.
2. Review records left without a version. Unknown, mismatched and ambiguous historical keys are not guessed onto the current merchant. Legacy environment-only credentials still require explicit migration to client configurations for historical-version guarantees.
3. Resolve/seal the initial client snapshots before rotating secrets. Retain their original environment-secret values.
4. Configure the existing client-specific Razorpay webhook URLs and retain old webhook secrets during rotation. The current verification lookup is bounded to 100 retained versions per client/environment; review retention before reaching that bound.
5. Validate sandbox creation, old-order callbacks, unknown-order recovery, old-mandate debit and deployment refund after rotation. Device checkout validation remains part of the mobile/release phases.

Do not drop version history as a rollback mechanism. If rolling back application code, stop credential rotation and preserve the additive schema and retained secrets; old application code does not understand historical bindings.

## Validation

216 payment tests passed across 27 files with no skipped payment tests, including PostgreSQL invoice, penalty, AutoPay, rotation and migration tests. Suites were run sequentially against one disposable database; their internal concurrency tests remained enabled. TypeScript, Prisma schema validation and payment lint passed.

The database migration test executes the migration SQL directly against baseline tables, verifies conservative backfill, tenant ownership, immutable bindings/fingerprints, and rolls back its complete fixture transaction. Rotation tests exercise the configuration service against PostgreSQL. A real database run also exposed raw SQL serialization errors in AutoPay settlement; its bounded retry handling now recognizes PostgreSQL serialization/deadlock codes as well as Prisma's transaction-conflict code.

Local PostgreSQL lacked PostGIS. Payment integration tests used a temporary schema copy with only the unrelated geographic location field represented as text. The repository schema was unchanged. The first schema initialization was incomplete; Prisma refused an overwrite, so testing proceeded in a second fresh database without accepting data loss. No production database, secret or gateway dashboard was changed.

The separate deployment-commercial integration suite is not green: 7 tests passed and 27 failed in concurrent commercial-offer acceptance before payment assertions. Its temporary database needed the offer/agreement number sequences, which were supplied before rerunning. This remains a deployment validation gap; payment-suite success is not a claim that the complete allocation/handover workflow is certified.
