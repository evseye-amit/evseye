# Cashfree Phase 2A: provider adapter

Phase 2A adds a server-only `PaymentProvider` port, Cashfree Subscriptions adapter, deterministic mock, disabled provider, configuration validation, HTTP transport, normalized statuses, and raw-body signature verification. No payment endpoint or provider-initiated financial state transition is exposed yet. Rider billing and ledger remain the source of amounts; no schema or migration changes are needed for this phase.

## Configuration

Set `PAYMENT_PROVIDER=cashfree` to activate the adapter, or `mock` only in non-production automated/local testing. The default is `disabled`. Set `CASHFREE_ENVIRONMENT=SANDBOX` or `PRODUCTION`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_WEBHOOK_SECRET`, `CASHFREE_API_VERSION`, `CASHFREE_SUBSCRIPTION_RETURN_URL`, and `CASHFREE_WEBHOOK_URL`. Store credentials in deployment secrets, never in Git or Flutter. Production requires `CASHFREE_ENVIRONMENT=PRODUCTION` and HTTPS return/webhook URLs. The adapter uses only Cashfree's fixed HTTPS sandbox/production hosts. Requests time out after 10 seconds; mutating calls require a stable idempotency key and are never automatically retried. A network timeout means **unknown provider outcome**, not a failed debit; the later orchestrator must reconcile before attempting again.

The default `x-api-version` is `2026-01-01`, matching Cashfree's current [Subscription API reference](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/overview). Validate the enabled merchant account and checkout in the Cashfree sandbox before production use.

## API boundary

The adapter maps EVsEye on-demand and periodic mandates to Cashfree Subscriptions, AUTH and CHARGE to Subscription Payments, manage/retry actions to their dedicated endpoints, and full/partial refund amounts to Subscription Refunds. EVsEye amounts are decimal strings at the port. Conversion to JSON numbers occurs only at the Cashfree boundary after two-decimal and safe-range validation. Unknown provider statuses remain `UNKNOWN`; they never become active or successful by default. Cashfree errors returned to callers are categorized and sanitized; secrets and raw provider responses are not logged.

Webhook verification is available as an adapter method, using the timestamp plus **original raw body** HMAC-SHA256 signature. No webhook route, event persistence, deduplication, or state processing is part of 2A. The route and payment event schema belong to Phase 2B/2C. `CASHFREE_WEBHOOK_URL` is reserved for that route and should not be registered in Cashfree Dashboard until it exists.

## Testing and next phase

Unit tests cover request/response mapping, status/error mapping, HTTP headers/idempotency/timeout behavior, and webhook verification. A Nest module integration test uses a stub HTTP transport, so CI needs no sandbox credentials. Real Cashfree sandbox tests still require an enabled Cashfree merchant account and official sandbox instruments. Phase 2B must add mandate persistence, active-package entitlement checks, idempotent create/authorization APIs, verified webhook handling, client isolation, and Rider App integration. Phase 2C then adds invoice-linked collection, reconciliation, and ledger posting. No Flutter source is present in this repository.

For rollback, leave `PAYMENT_PROVIDER=disabled` and revert the Phase 2A application files. There is no database migration to roll back. For operations, check sanitized request IDs and provider status categories; reconcile ambiguous POST outcomes against Cashfree before any repeat operation.
