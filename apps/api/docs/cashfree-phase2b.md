# Cashfree Phase 2B: Rider UPI AutoPay authorization

This phase persists client-scoped Rider mandates, creates an on-demand UPI AutoPay subscription through the configured payment provider, verifies its status against Cashfree, and receives signed subscription webhooks. A mandate is never marked active from a redirect or webhook payload alone. The backend fetches Cashfree's current subscription status first.

## Configuration

Set `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENVIRONMENT=SANDBOX`, Cashfree client credentials, `CASHFREE_WEBHOOK_SECRET`, an actual Rider App return URL in `CASHFREE_SUBSCRIPTION_RETURN_URL`, and `CASHFREE_WEBHOOK_URL=https://<api-host>/api/v1/webhooks/payments/cashfree`. The default API version is `2026-01-01`. The webhook secret is distinct from the Cashfree client secret. Register the webhook endpoint in Cashfree for `SUBSCRIPTION_STATUS_CHANGED` and `SUBSCRIPTION_AUTH_STATUS`. The example return URL in `.env.example` is a placeholder; no return page is included in this repository.

The feature catalog seed includes `RIDER_AUTO_PAY` as a package entitlement. The active client package must include that feature. Its `PackageFeature.configuration` supplies the mandate values, for example:

```json
{
  "mandateMaxAmount": "2500.00",
  "validityDays": 365,
  "paymentMethods": ["UPI_AUTOPAY"],
  "authorizationAmount": "1.00"
}
```

These numbers are illustrative configuration syntax, **not seeded commercial values**. Configure actual limits and validity in the Super Admin package feature before enabling the flow. `authorizationAmount` is optional; when omitted, the provider decides the applicable authorization amount. The amount and expiry are snapshotted on each mandate. The Rider cannot submit a package ID or amount. If the client has no active package, or the feature/configuration is missing, the API returns a business error.

## Rider App contract

All endpoints require a Rider access token and derive client and rider from that token.

1. `GET /api/v1/rider-app/payments/autopay` returns the effective package AutoPay configuration and current mandate.
2. `POST /api/v1/rider-app/payments/autopay` with a stable `Idempotency-Key` header creates the mandate and returns `mandateId`, `providerMandateId`, `subscriptionSessionId`, status, max amount, currency, and expiry. Reuse the same key after a network timeout. Pass the session ID to Cashfree's subscription checkout in the Rider App.
3. After Cashfree checkout returns, `POST /api/v1/rider-app/payments/autopay/{mandateId}/verify` fetches authoritative status. Show AutoPay as enabled only when the response status is `ACTIVE`. A pending, paused, unknown, or failed response must stay non-active.

Example create response:

```json
{
  "data": {
    "mandateId": "uuid",
    "providerMandateId": "EVSEYE_...",
    "status": "CREATED",
    "providerStatus": "INITIALIZED",
    "subscriptionSessionId": "session_from_cashfree",
    "maxAmount": "2500.00",
    "currency": "INR",
    "expiresAt": "2027-09-25T00:00:00.000Z",
    "authorizedAt": null,
    "environment": "SANDBOX"
  }
}
```

This repository contains the API and web dashboard, but no Flutter Rider App source. The Flutter checkout and authorization screen must consume this contract in that separate app.

## Webhook and data behavior

`POST /api/v1/webhooks/payments/cashfree` accepts Cashfree's original raw JSON body. The adapter validates the `x-webhook-signature` HMAC against `x-webhook-timestamp` plus raw body using `CASHFREE_WEBHOOK_SECRET`. The event is identified by the SHA-256 of the raw payload, persisted, and deduplicated. Supported mandate events fetch Cashfree's subscription before updating state. Failed reconciliations return an error for provider retry. Unknown subscription IDs are rejected. Other event types are recorded as ignored for now; payment settlement is a later phase.

`PaymentMandate`, `PaymentMandateEvent`, and `PaymentProviderEvent` are added in `20260925200000_cashfree_mandate_foundation`. The partial database index permits only one open mandate per client/rider. Provider uncertainty is stored as `UNKNOWN` and reconciled with a provider GET before another authorization attempt. `RiderPaymentProfile.autoPayEnabled` is true only for a provider-verified `ACTIVE` mandate.

Apply migrations with `pnpm --filter @evs-eye/api exec prisma migrate deploy` after deploying Phase 1 migrations. Run the catalog seed or create the `RIDER_AUTO_PAY` feature through Super Admin, then include and configure it on the intended package. Keep `PAYMENT_PROVIDER=disabled` until the Cashfree sandbox configuration and package feature are ready.
