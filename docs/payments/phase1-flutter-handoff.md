# Phase 1 payment reliability — Flutter handoff

Date: 2026-11-14. Backend branch: `codex/payment-integration-staging`, based on `dev` at `5b2649e93f07fcdf4e0e085f41c359ba450ad7ee`.

This delivery changes only the monorepo. Flutter source and dependencies are untouched. These changes are local until backend release operations supplies a deployed staging commit. Device acceptance remains with the Flutter team.

## Why Add Money returned 503

The reported response was `PAYMENT_CAPABILITY_UNAVAILABLE` for `POST /api/v1/rider-app/payments/orders`, request `req-fbh`. The gateway policy rejected the purpose before gateway checkout. The earlier Razorpay capability list excluded `TOP_UP`, `OUTSTANDING`, and `SECURITY_DEPOSIT`; simply removing that guard would not have implemented their checkout or settlement.

This change implements those Razorpay collection flows and enables their capabilities. It also routes non-rental invoices through shared checkout settlement. The staging log did not identify the selected merchant, so backend operations must confirm the affected client's active gateway configuration during release. Capability eligibility still does not prove valid credentials or gateway connectivity.

## Required mobile changes

1. Fetch `GET /rider-app/payments/orders/capabilities`. Combine server capability eligibility with native SDK availability. Do not hard-code top-up as Cashfree-only or use a build-time Razorpay key as the availability gate.
2. Before creating an order, persist the exact request body and a stable `Idempotency-Key`. Use one key per intentional payment; repeat the same body/key after transport failure. Serialize repeated taps.
3. Persist the returned `paymentRequestId` before opening checkout. Scope stored state to authenticated user, client, and API environment. Use the returned `checkout.type` to dispatch the SDK.
4. After an SDK callback, verify with the backend. After cancel, timeout, app restart, or a missing callback, reconcile with the backend. Only backend `SUCCEEDED` means success. Refresh wallet balances and invoice/deposit data afterward.
5. Add pending-payment recovery and explicit abandonment for eligible Razorpay collection orders as described below. An SDK cancellation alone does not cancel the payment financially.

All paths below are relative to `/api/v1`, use existing RIDER Bearer authentication, and return `{ "data": ... }`. Client/rider ownership is derived from the token. URL-encode `paymentRequestId`; treat it as opaque.

## Add Money contract

```http
POST /rider-app/payments/orders
Idempotency-Key: <persisted UUID>
Content-Type: application/json

{"purpose":"TOP_UP","amount":"500.00"}
```

Amounts are decimal strings in INR, with two decimal places, from `500.00` through `5000.00`. Top-up credits wallet cash only after verified provider capture. It is not a security-deposit collection.

Example Razorpay response (illustrative IDs):

```json
{
  "data": {
    "paymentRequestId": "collection:<uuid>",
    "purpose": "TOP_UP",
    "provider": "RAZORPAY",
    "status": "PENDING",
    "amount": "500.00",
    "currency": "INR",
    "checkout": {
      "type": "RAZORPAY",
      "orderId": "order_example",
      "keyId": "rzp_test_example",
      "amountPaise": 50000
    }
  }
}
```

Use the returned key, order, currency, and `amountPaise` without recalculating from a cached balance. Cashfree continues to return `checkout.type`, `orderId`, `paymentSessionId`, and its saved `environment`. Do not launch its SDK if environment/session is absent; recover status instead. Never switch gateway locally after an error.

Razorpay callback verification:

```http
POST /rider-app/payments/orders/:paymentRequestId/verify

{"razorpayOrderId":"order_example","razorpayPaymentId":"pay_example","razorpaySignature":"<SDK signature>"}
```

Cashfree verification uses the same route with `{}`. Never send caller-selected amount, purpose, or success status to verification.

## Recovery and abandoned orders

| Route | Behavior |
|---|---|
| `GET /rider-app/payments/orders/:paymentRequestId` | Stored state only; no fresh gateway check. |
| `POST /rider-app/payments/orders/:paymentRequestId/reconcile` with `{}` | Fetches gateway evidence and recovers the saved request, including interrupted checkout creation where safe. No SDK callback is required. |
| **New:** `GET /rider-app/payments/orders/pending` | Returns an array of up to 50 newest owned collection requests in `CREATING`, `PENDING`, or `UNKNOWN`, using the normal order response shape. It does not include deployment attempts and does not itself reconcile. Persisted IDs remain the primary recovery mechanism. |
| **New:** `POST /rider-app/payments/orders/:paymentRequestId/abandon` with `{}` | Reconciles and checks Razorpay evidence before releasing an unpaid collection order locally. Returns the updated normal order response. Unsupported providers/deployment attempts are rejected. |

Offer “Check payment status” first. Reuse an existing pending checkout when possible. When the rider explicitly chooses to discard an unpaid Razorpay checkout, call `abandon` and wait for backend `CANCELLED` before creating a replacement with a new key. A captured, authorized, uncertain, or review-required payment can prevent abandonment; retain the request and show its current state.

Abandonment is **not gateway cancellation or a refund**. Stop using the old checkout. A payment already moving through the gateway may still capture afterward; the backend continues reconciling it. A late surplus invoice capture is retained for review rather than allocating the same invoice twice. Do not promise the rider that abandonment prevents all later charges.

On network errors, keep the original key/request and offer bounded polling plus manual recovery. Do not continuously POST new orders. A legacy uncertain create that cannot be safely recovered may still require support; never manufacture a new payment automatically.

## Other purposes and UI states

- `INVOICE`: send `invoiceId`, optional `useWallet`, and a stable key. Razorpay now supports eligible non-rental invoices as well as existing rental invoices. Wallet-only settlement may return `SUCCEEDED` with no checkout.
- `SECURITY_DEPOSIT`: send the **legacy rider deposit ID** as `depositId`. Wallet security-deposit invoices use `INVOICE` with their invoice ID; these identifiers are not interchangeable.
- `OUTSTANDING`: optional decimal-string amount; allocation is fixed to the invoices selected at creation. If the server returns `PAY_SECURITY_DEPOSIT_INVOICE_SEPARATELY`, direct the rider to pay the security-deposit invoice through `INVOICE` first, then retry outstanding payment. This prevents deposit funding from going through the ordinary invoice ledger.
- `ENACH` remains unavailable on Razorpay. Honor returned capabilities.
- `CREATING` / `UNKNOWN`: show processing or confirmation pending; retain recovery state.
- `PENDING`: launch/resume only when a valid checkout payload is present.
- `SUCCEEDED`: refresh server balances and show success.
- `FAILED` / `EXPIRED` / `CANCELLED`: use server `nextAction`; do not turn an SDK error into one of these states yourself.
- `REVIEW_REQUIRED` / `REFUND_PENDING`: show a support/status path and suppress automatic repayment.
- `PAYMENT_ALREADY_IN_PROGRESS`: fetch pending requests and recover the relevant request instead of repeatedly generating keys.

## Flutter acceptance tests

Run on Android and iOS against each configured TEST merchant after backend deployment:

- Add INR 500 and INR 5000; verify backend success and exactly one wallet cash credit. Reject out-of-range input.
- Double tap, lose the create response, and retry with the same key: obtain the same logical request/order.
- Kill/restart the app before and after SDK return; reconcile the persisted ID and recover the authoritative state.
- Exercise Razorpay and Cashfree dispatch using returned merchant/session fields, including merchant/client switching and logout. Ignore callbacks from an old identity/environment.
- Cancel checkout, check status, abandon an eligible Razorpay collection, and create a deliberate replacement. An authorized or captured payment must prevent unsafe abandonment.
- Have backend QA inject a late capture after abandonment and confirm the mobile UI follows the resulting success/review state without inventing a refund.
- Pay a non-rental invoice and a wallet security-deposit invoice when cash is below its configured reserve. External payment should settle; wallet spending beyond the available amount should remain blocked.
- Pay outstanding invoices; test a deposit invoice requiring its separate flow and a late capture after the original invoices were already paid.
- Reconcile a Cashfree create timeout: recover the session or safely retry the same saved provider request, never a different merchant/order.
- Handle disabled capabilities, invalid merchant configuration, provider outages, and ownership failures without claiming payment success.

## Backend release and deferred work

Local verification completed: API TypeScript check passed; all 17 repository migrations applied to fresh PostgreSQL 16/PostGIS; `test:payments:release` passed **374 tests across 42 files with no skips**. Sequence-repair checks also confirmed that existing values are preserved and missing sequences resume above issued numbers. Gateway calls in automated tests use test doubles; actual merchant sandbox and mobile device acceptance are still required after deployment.

CI now provisions a disposable PostGIS database, applies migrations, and runs `test:payments:release` with all five required database URLs. Readiness now includes the wallet AutoPay tables and `20261114120000_wallet_auto_recharge`. Apply the new `20261114133000_restore_commercial_number_sequences` migration as well: the fresh-database release tests exposed missing offer/agreement numbering sequences in the consolidated baseline. It preserves existing sequences and initializes missing ones above issued numbers. Release operations must still run readiness against staging, verify the deployed commit and active merchant, and collect sandbox payment/webhook/accounting evidence.

The five deferred Phase 2 items are now implemented locally; see the [Phase 2 handoff](phase2-flutter-handoff.md) for retry, wallet history, reconciliation, settlement, and home-screen changes. Flutter should use server financial balances and common payment status rather than treating statement row count as credited money.

Related: [common payment contract](mobile-payment-api-contract-v1.md), [existing Flutter handoff](flutter-team-handoff.md), [wallet AutoPay handoff](wallet-autopay-flutter-handoff.md).
