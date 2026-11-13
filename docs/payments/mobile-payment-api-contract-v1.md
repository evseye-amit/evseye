# Mobile payment API contract v1

Contract revision: payment-contract-v1.1, 2026-11-13. Implemented in the local backend; deployment identifier and staging URL must be supplied by backend release operations before mobile enables these additions. This is not a claim of production or device certification.

Ownership: backend maintains this contract and its executable tests. The Flutter team implements all mobile changes. No Flutter source changes are included.

## Authentication and compatibility

Paths below are relative to the API base (normally /api/v1). Use the existing Bearer token. All common order routes require RIDER; client and rider are derived from authenticated context. Never send clientId, riderId, amount overrides or a caller success flag. Responses use { "data": ... }; errors retain the existing application envelope.

Existing create, detail and verify paths and Razorpay fields remain compatible. New checkout fields are additive. Treat paymentRequestId as opaque and URL-encode it. Current IDs have deployment: or collection: prefixes.

## Endpoints

- GET /rider-app/payments/orders/capabilities — client policy eligibility.
- POST /rider-app/payments/orders — create or reuse an order.
- GET /rider-app/payments/orders/:paymentRequestId — stored state only.
- POST /rider-app/payments/orders/:paymentRequestId/verify — SDK callback verification.
- POST /rider-app/payments/orders/:paymentRequestId/reconcile — fresh provider recovery without an SDK callback; send {}.

Reconcile verifies ownership before contacting the saved provider. It does not create a replacement order and does not use the current client policy to choose a different provider. A provider outage may fail the call; retain the request and retry recovery later.

## Capabilities

Example:

```json
{"data":{"contractVersion":1,"availabilityBasis":"POLICY","connectivityVerified":false,"purposes":{"INVOICE":{"enabled":true,"provider":"RAZORPAY","platforms":["ANDROID","IOS"]},"TOP_UP":{"enabled":false,"provider":null,"platforms":[],"reason":"PAYMENT_CAPABILITY_UNAVAILABLE"}}}}
```

The response includes DEPLOYMENT, SUBMISSION_PENALTY, INVOICE, OUTSTANDING, SECURITY_DEPOSIT, TOP_UP, UPI_AUTOPAY and ENACH. enabled means the selected policy has a registered capability; it does not certify secrets, gateway connectivity, merchant activation, rider eligibility or installed SDK availability. platforms lists supported native integration targets, not a certification of the current app build. Order creation performs authoritative validation and may still return 503.

Client Razorpay supports deployment, rental invoices, submission penalties and UPI AutoPay. Legacy shared Cashfree supports non-deployment checkout and recurring purposes. Client-specific Cashfree is not enabled. MOCK is not advertised as usable on mobile. Do not enable unsupported purposes simply because a request constructor exists.

## Create requests

| purpose | Required / optional fields |
|---|---|
| DEPLOYMENT | allocationId |
| SUBMISSION_PENALTY | optional amount, optional provider assertion |
| INVOICE | invoiceId; optional useWallet (default true), optional provider assertion |
| OUTSTANDING | optional amount |
| SECURITY_DEPOSIT | depositId |
| TOP_UP | amount |

Amounts are INR decimal strings. TOP_UP is INR 500.00–5000.00. See ../rider-wallet-top-up-contract.md. Server computes/validates the payable amount and ownership. Provider omission uses client policy; a supplied different provider returns PAYMENT_PROVIDER_POLICY_MISMATCH. INVOICE on Razorpay currently means rental invoices.

Send Idempotency-Key (8–120 letters, digits, colon, underscore or hyphen). It is required for invoices and configured-provider checkout. Deployment and Razorpay penalties additionally have server-managed pending-order reuse; their header is not a general replay guarantee. Use one key and identical payload for the same logical payment. Never rotate the key on timeout.

Example: {"purpose":"INVOICE","invoiceId":"<uuid>","useWallet":true}.

## Checkout payloads

Common response fields: paymentRequestId, purpose, provider, status, amount (decimal string), currency, providerOrderId, providerPaymentId, failureCode, checkout, optional nextAction and purpose-specific invoiceId/depositId/allocationId.

Razorpay checkout:

```json
{"type":"RAZORPAY","orderId":"order_example","keyId":"rzp_test_example","amountPaise":50000}
```

Cashfree checkout:

```json
{"type":"CASHFREE","orderId":"EVSEYE_PG_example","paymentSessionId":"session_example","environment":"SANDBOX"}
```

Dispatch by provider and validate checkout.type when present. Razorpay must use the response key, not a flavor key. Cashfree environment is SANDBOX or PRODUCTION, saved before order submission. Legacy collections may return environment:null: do not guess or launch the SDK; retain the request, offer status recovery and escalate to backend support. No automatic backfill from today's environment is safe.

checkout can be null for non-launchable states. Wallet-only invoice success has provider:WALLET, status:SUCCEEDED, paymentRequestId:null, checkout:null; no SDK or verify call is needed. Do not log checkout sessions, signatures, tokens or secrets.

## Verify

Razorpay body:

```json
{"razorpayOrderId":"order_example","razorpayPaymentId":"pay_example","razorpaySignature":"<64 hexadecimal characters>"}
```

Cashfree body: {}. For a lost callback, SDK cancel/error, app restart or failed callback verification, use reconcile rather than manufacturing a signature. Only server status SUCCEEDED permits payment success UI.

## States and recovery

| status | Required behavior |
|---|---|
| CREATING / PENDING / UNKNOWN | Retain request/key, bounded recovery with backoff and a manual check action |
| SUCCEEDED | Refresh invoices, wallet, dues and related deployment state |
| FAILED / CANCELLED / EXPIRED | Retry only when nextAction is RETRY_ONLINE_PAYMENT |
| REVIEW_REQUIRED / REFUND_PENDING | Show support guidance; no replacement charge |
| REFUNDED | Show returned payment and refresh balances; not a declined checkout |

nextAction can be absent. SDK cancellation is not proof of server cancellation. A capture or refund discovered later may change a previously successful displayed state.

Before create, persist the exact request and idempotency key scoped by API environment, client and authenticated user. Persist paymentRequestId before launching checkout. On transport uncertainty before obtaining the ID, replay the same request/key to recover the server-managed request. On receiving an ID, use detail/reconcile. Serialize taps; do not launch a second checkout while an unresolved payment exists. On logout/client switch detach callbacks and never reconcile the old user's request using the new user's session.

Recommended foreground recovery: a small bounded number of attempts with increasing delay, then manual Check status. Background server workers continue independently. Recovery is not permission for a replacement payment.

## Error handling

The existing error envelope may contain a structured code or a message; do not assume every error has a code. This revision intentionally does not promise an exhaustive global error catalogue.

- 400: invalid input; correct request before retry.
- 404: missing/inaccessible request; do not infer another tenant's payment.
- 409: provider-policy, idempotency or financial-state conflict; refresh/recover, do not bypass with another key.
- 503/transport timeout: may represent a remote success with local uncertainty. Preserve request/key.
- PAYMENT_CAPABILITY_UNAVAILABLE / PAYMENT_MERCHANT_UNSUPPORTED / PAYMENT_POLICY_UNAVAILABLE: purpose cannot be started under current policy.
- RAZORPAY_CONFIGURATION_MISMATCH / RAZORPAY_SECRET_VERSION_CHANGED: support must restore originating credentials; no replacement charge.

## AutoPay authorization

AutoPay is separate from common checkout; do not send UPI_AUTOPAY to the orders endpoint. See the existing rider mandate routes described in the handoff checklist. Setup retains its Idempotency-Key across uncertainty. The backend returns mandateId, provider, providerMandateId, status, subscriptionSessionId, environment and, for Razorpay, authorization:{type:"HOSTED",url,keyId} when authorization is pending.

Razorpay uses its hosted authorization URL. Cashfree uses the subscription ID/session and returned environment. Neither browser return nor SDK success establishes an active mandate: verify server status, refresh setup, and distinguish ACTIVE, authorization pending, paused and closed states. Do not create a second mandate after an uncertain setup.

Cashfree mandate environment currently derives from runtime configuration; do not switch shared-account environment while unresolved mandates exist. Client-specific Cashfree and immutable Cashfree merchant recovery remain later work.

## Acceptance and release gates

Executable backend coverage: test/payments/common-payment.spec.ts, payment-gateway-policy.spec.ts and deployment-payment-provider-router.spec.ts, plus existing checkout/idempotency and historical-version recovery suites. Tests cover payload variants, missing legacy environment, wallet success, state mapping, callback mismatch, ownership, callbackless recovery and stored-provider routing.

Backend release operations must supply deployed revision, staging API base, capability fixtures, sandbox merchant setup and migration evidence. Flutter team must validate success/cancel/decline, kill-after-debit, offline callback, duplicate tap, expired session, review/refund, unsupported purpose, logout/client switch and both native platforms. These device and release gates are not satisfied by local backend tests.
