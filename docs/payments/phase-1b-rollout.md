# Phase 1b — merchant credentials and webhook routing

## Implemented

- AutoPay registration and debit claims save the resolved client key, not the global key.
- Saved keys are checked asynchronously against client credentials before financial provider operations. All callers await this check.
- Explicit disabled, expired, future or malformed merchant configurations fail closed; they do not silently select legacy global credentials.
- Webhook lookup covers deployment orders/captures, penalty/invoice collections, AutoPay debit/authorization orders and payments, and token-only mandate events.
- The raw-body signature is verified with the resolved client webhook secret before inbox persistence. Conflicting reference ownership or a different routed client is rejected.
- The verified client is saved in the inbox and retained during worker lookups and unknown-order recovery, including receipt lookup. No global account is used for unknown-order recovery.
- An existing event ID cannot be rebound to a different client; duplicate content validation is retained.

## Gateway dashboard configuration required at rollout

Use this backend endpoint for each client's Razorpay merchant account:

`POST /api/v1/webhooks/payments/razorpay/clients/<client-uuid>`

The URL client is a routing hint, not authentication. The raw body must still pass HMAC verification with that client's configured webhook secret. No bearer token is required. Configure the URL in the gateway dashboard; no Flutter change is required.

The existing `/api/v1/webhooks/payments/razorpay` endpoint remains available for references already bound locally. Unknown orders and early token events cannot be attributed safely there and return `RAZORPAY_WEBHOOK_MERCHANT_REQUIRED`. Configure the client-specific URL before enabling merchant traffic that relies on early-event recovery. No dashboard changes have been made by this implementation.

## Existing records and current versioning boundary

- Existing pending inbox rows without clientId require signature-verified redelivery. Workers fail them rather than guessing a merchant. A repeated authenticated delivery with identical bytes can bind the client. Independent payment/mandate reconciliation remains available.
- Existing records containing an incorrect global key will now report `RAZORPAY_CONFIGURATION_MISMATCH`. Do not mass-rewrite them: verify each originating merchant before any repair.
- Historical merchant versioning is now implemented by conversation Phase 3. Bound orders/mandates resolve their originating version; see [phase-3-gateway-policy-and-versions.md](phase-3-gateway-policy-and-versions.md). Legacy records without a provable version still require individual review.
- Initial migration snapshots must be sealed before rotation. New rotations use a new immutable secret reference; retain older references for unresolved payments and active mandates.
- No database migration, production deployment or real gateway transaction was performed.

## Validation and release gate

Unit/regression coverage includes two merchant keys, registration/debit key persistence, stale-key rejection, disabled/broken configuration fallback, signature isolation, authorization/token events, cross-client reference conflicts, unknown-order receipt recovery and duplicate event ownership.

Before production rollout: run the dedicated database integration suites on disposable databases, configure two sandbox merchants, validate client-scoped webhook delivery and recovery, and inventory legacy mismatched-key/unscoped inbox records. Confirm global Razorpay/AutoPay enable flags required by existing scheduled workers.

Provider reference: https://github.com/razorpay/markdown-docs/blob/master/payments/payment-gateway/s2s-integration/recurring-payments/webhooks.md

Historical Phase 1b validation was 156 passed / 72 skipped. It is superseded by the current database-backed validation and closure evidence in [implementation-plan.md](implementation-plan.md). Sandbox/provider dashboard and deployment acceptance are tracked separately; no local test result certifies a live merchant.
