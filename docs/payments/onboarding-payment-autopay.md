# Onboarding payment and AutoPay — provider authorization

Updated 21 November 2026. See [Flutter handoff](unified-autopay-flutter-handoff.md) for the current contract.

Onboarding has one combined payment-and-mandate authorization experience. There is no separate in-app consent checkbox and no onboarding call to `PUT /rider-app/autopay`. Ordinary one-time payments do not enroll AutoPay.

Create `POST /api/v1/rider-app/payments/orders` with `purpose: DEPLOYMENT`, `allocationId`, `setupAutoPay: true`, `email`, and a stable `Idempotency-Key`. The backend snapshots configured mandate maximum/expiry and wallet threshold/recharge/policy revision. New clients omit `autoPayConsent`; the optional legacy field remains validated for compatibility with in-flight app rollout.

The response exposes saved wallet terms in `data.autoPay.terms`, mandate maximum/expiry in `data.autoPay`, and recurring checkout parameters in `data.checkout`. Display the actual returned terms before launching checkout. Do not send `accepted: true` automatically or manufacture evidence of approval.

Payment capture and confirmed provider mandate authorization are separate outcomes. After a verified ACTIVE mandate, backend reconciliation attempts wallet activation immediately. A one-minute recovery job retries missed activation. Activation requires a paid combined checkout, matching rider, provider authorization payment/token, an active uncancelled mandate and unchanged funding terms. Existing preferences and disable actions since checkout creation prevent silent re-enabling. Funding activation failure never changes a successful payment into a failed one.

The internal historical `autoPayConsent` JSON column now also stores server checkout terms with `authorizationSource: PROVIDER_CHECKOUT` and `termsCreatedAt`; new snapshots do not claim `accepted` or `acceptedAt`. Provider mandate `authorizedAt`, token/payment/order references and status-transition audit records are the authorization evidence. Historical snapshots remain recoverable. No schema migration is required.

Standalone enrollment and later preference changes retain the unified mandate and PUT endpoints. Changing funding terms after checkout does not automatically extend the rider's authorization. Client rollout/merchant readiness gates, pre-debit notices and ledger accounting remain in force.

Stage first: verify SDK recurring support on real test devices, signed callbacks, server reconciliation after app termination, pending/rejected token states, policy changes, duplicate delivery, cancellation and later disable. Production promotion follows successful staging acceptance; do not seed demo data or change database schema for this update.

## Backend validation

- Payment release suite: 542 tests across 55 files passed against disposable local PostgreSQL with simulated provider responses.
- Seven additional database activation scenarios passed in the wallet suite (32 tests total), including concurrent activation, pending/failed authorization, unpaid checkout, changed policy, later disable and an existing disabled preference.
- Common payment contract suite: 49 tests passed, including the additional no-consent request and safe snapshot-response case.
- API typecheck, build, changed-file oxlint and whitespace checks passed. Full application initialization/OpenAPI export succeeded with 868 operations.
- No real bank/provider charge, staging deployment or production deployment was performed. Flutter checkout was not edited.
