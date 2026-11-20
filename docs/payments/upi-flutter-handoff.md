# UPI backend delivery and Flutter handoff

Date: 2026-11-14. Contract: payment-contract-v1.3. Implementation branch: `codex/upi-backend-contract`.

## Ownership and scope

Backend owns order validation, merchant selection, verification, webhook processing, reconciliation, accounting, API contract and staging evidence. Flutter owns SDK dependencies, Android/iOS setup, payment screens, local recovery persistence, lifecycle handling and device acceptance. No Flutter source or dependency changes are part of this delivery.

Initial integration target: one-time Razorpay UPI using Standard Checkout, starting with Add Money and invoices. Existing deployment, submission penalty, outstanding and deposit purposes retain their contracts. AutoPay uses separate mandate endpoints; do not send UPI_AUTOPAY to the common order endpoint. Cashfree remains optional and must not be enabled merely because the client has an SDK.

Canonical reference: [API contract](mobile-payment-api-contract-v1.md). Copyable authenticated requests: [HTTP examples](upi-payment-examples.http). Sanitized response examples: [JSON fixtures](upi-response-examples.json). Existing mobile tickets: [Flutter backlog](flutter-bugs-and-improvements.md). Existing Phase 1 and Phase 2 handoffs still govern recovery, balances and wallet history.

## Verified staging baseline

- API base: `https://api.staging.evseye.com/api/v1`.
- Before this change, remote dev and staging images: `e4676d02fc6061b7243fb3f5aee119bf46f0d37a`.
- AWS ECS read-only inspection: API task definition `evseye-staging-api:204`; web `evseye-staging-web:186`. Both services had one desired/running task and a completed primary deployment.
- Public API health returned `status: ok` during the preceding review.
- These observations verify deployment identity/availability only. Active client merchant readiness, staging database inventory, signed gateway callbacks and device acceptance remain separate gates.
- v1.3 changes in this branch are not deployed by this delivery. Do not assume staging returns `paymentMethod` until the release owner records the new image SHA and migration evidence.

## API additions and checkout decision

The existing create/detail/verify/reconcile endpoints are reused. `paymentMethod` is an additive, nullable response field for Razorpay capture evidence. It is not an input or a success indicator. Valid non-UPI captures remain accounted for and are labelled with their actual method. Missing/unrecognized method evidence is UNKNOWN; pre-capture/legacy evidence can be null. Already-posted historical receipts are not rewritten.

Standard Checkout remains gateway-controlled; this release does not enforce UPI-only acceptance. Flutter should present gateway-supported UPI Intent prominently, use the returned merchant key/order/amount, and display the actual verified method when available. Do not build a direct VPA payment or screenshot-verification shortcut. Do not interpret capability enabled=true as merchant UPI activation.

No raw payer VPA, card detail, UPI PIN or gateway secret is added to the response. The existing three-field Razorpay callback request is unchanged.

## Checkout and recovery sequence

```mermaid
sequenceDiagram
  participant F as Flutter
  participant B as Backend
  participant G as Gateway / UPI app
  F->>B: GET capabilities
  Note over F: Persist exact request + stable idempotency key
  F->>B: POST orders + Idempotency-Key
  B-->>F: paymentRequestId + checkout, or wallet-only success
  Note over F: Persist ID before launching checkout
  F->>G: SDK checkout using returned key/order/amount
  alt Genuine SDK success callback
    G-->>F: order ID, payment ID, signature
    F->>B: POST verify
  else Cancel/error, missing callback, restart, timeout
    F->>B: POST reconcile with {}
  end
  B->>G: Fetch payment with originating merchant
  G-->>B: Verified order/amount/currency/capture/method
  Note over B: Settle once; retain review/refund states
  B-->>F: Authoritative status + paymentMethod
  Note over F: Refresh balances only from backend
  G->>B: Signed webhook independently recovers payment
```

Persist recovery state by API environment, client and user. If create times out before an ID arrives, repeat the identical request/key. Once an ID is known, use reconcile for fresh gateway evidence; detail is stored state only. Pending inventory excludes deployment attempts, so it cannot replace local persistence. Deployment/penalty creation has server-managed pending reuse rather than a universal header replay guarantee.

Disable repeated taps while unresolved. Ignore callbacks from a prior identity after logout/client switch. Bound automatic recovery and provide Check payment status. Never automatically generate another key or switch providers after a 409, 503, SDK cancel or timeout.

## Status-to-UI behavior

- CREATING/PENDING/UNKNOWN: confirmation pending, retain recovery state; launch only a valid pending checkout.
- SUCCEEDED: show success and refresh authoritative wallet/invoice/deposit/deployment data. Wallet-only success needs no SDK.
- FAILED/CANCELLED/EXPIRED: retry only if the server returns RETRY_ONLINE_PAYMENT.
- REVIEW_REQUIRED: support guidance, suppress a replacement payment.
- REFUND_PENDING: refund processing, no new checkout for this request.
- REFUNDED: returned payment, refresh balances. Partial refunds can retain SUCCEEDED with refundedAmount.
- SDK cancellation alone: check backend status; it is not a terminal backend state.

The method field never overrides these rules. An authorized but uncaptured payment remains pending. Abandonment is an explicit user action for eligible unpaid Razorpay collections, not a refund or guaranteed gateway cancellation; a late capture can still require reconciliation/review.

## Backend release procedure

1. Apply additive migration `20261114150000_checkout_payment_method` before the API update. Do not backfill methods from legacy UPI labels.
2. Deploy the tested API revision. Retain the nullable columns if rolling back the API.
3. Run `payment:readiness` with an explicit read-only staging database connection and `PAYMENT_READINESS_ENVIRONMENT=TEST`. Record the sanitized report, migration status and deployed SHA. The checker does not verify gateway connectivity.
4. Confirm pilot clients have exactly one active intended TEST merchant. Validate retained credentials, capture configuration and the tenant webhook route `/api/v1/webhooks/payments/razorpay/clients/:clientId` using the correct webhook secret.
5. Securely supply Flutter with two-client rider accounts, owned payable invoice/deposit/allocation IDs, capability results and server-side balance expectations. Do not commit passwords, tokens or real rider data here.
6. Exercise a simulated checkout and signed webhook, then compare gateway reference, internal payment, receipt and wallet/invoice effects. Record duplicate replay and refund evidence.
7. Complete device acceptance with the Flutter team. Use a controlled live merchant exercise for actual Intent/QR behavior; do not convert a shared TEST merchant to live while unresolved requests exist.

## Acceptance ownership

Backend: invalid signature/order/amount/currency, cross-client access, duplicate/out-of-order webhooks, creation uncertainty, late captures, credential rotation, exactly-once receipt/ledger effects and refunds. Include card and missing-method evidence to prove they are never reported as UPI.

Flutter: Android/iOS success, cancellation, declined payment, no UPI app, app switching, duplicate taps, kill-after-debit, offline verification, restart, logout/client switch, expired sessions, and review/refund UI. Test ₹500 and ₹5,000 top-ups and boundary rejection. Invoice tests include wallet-only success and external remainder. Backend team supplies accounting evidence for each scenario.

Release owner: record deployed revision, migration/readiness report, client merchant activation, device builds and results, controlled live Intent/QR results, and pilot sign-off. Disable new checkout through existing policy if rollout needs pausing; retain reconciliation/refund processing for prior requests.

## External references

- [Razorpay payment fetch](https://razorpay.com/docs/api/payments/fetch-with-id/): method is gateway evidence; sensitive payer details are excluded from this API addition.
- [Flutter integration and testing](https://github.com/razorpay/markdown-docs/blob/master/payments/payment-gateway/flutter-integration/standard/integration-steps.md): TEST-mode simulation and live Intent/QR acceptance are distinct.
- [UPI Collect migration](https://github.com/razorpay/markdown-docs/blob/master/announcements/upi-collect-migration/s2s-integration.md): use Intent/QR for the new flow; exemptions are not the implementation baseline.

## Validation evidence

- Full payment release gate: **411 tests passed across 44 files, no skips**, against a disposable local PostgreSQL 16/PostGIS database with all five release-test database variables set.
- Additional explicit UPI top-up/deployment persistence assertions: **54 integration tests passed** across the two affected suites.
- Final method-recovery change (a sparse provider response cannot erase a known method): **39 integration tests passed** across rental-invoice and checkout suites after that change.
- API TypeScript check passed after final changes. Targeted lint and whitespace checks passed. Handoff relative links and JSON examples validated.
- All **19 migrations**, including `20261114150000_checkout_payment_method`, applied successfully to the disposable database. Gateway calls in automated tests are simulated.
- No staging migration, merchant mutation, live charge or refund was performed. Staging database readiness, merchant connectivity, live Intent/QR and Flutter device acceptance remain unverified release gates.
