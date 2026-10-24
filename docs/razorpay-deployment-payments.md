# Razorpay deployment payments

Razorpay is an independent, opt-in gateway for allocation/handover payments. Existing Cashfree mandates, invoices, collections and manual cash/UPI submissions are unchanged. Flutter integration is a separate task.

## Configuration

Apply migration `20261024150000_razorpay_deployment_payments`, regenerate Prisma, and configure:

```dotenv
RAZORPAY_ENABLED=true
RAZORPAY_CLIENT_IDS=<comma-separated client UUIDs sharing this merchant>
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<secret>
RAZORPAY_WEBHOOK_SECRET=<different secret>
```

Disabled by default. These keys represent one merchant account; only explicitly listed clients can use it. Clients requiring different merchant accounts need separate credential resolution before enabling this integration for them. The order stores its original public key ID; changing merchant/test/live keys does not silently migrate existing orders. Reconcile outstanding orders/refunds before changing keys. Staging should use test credentials. Secrets remain server-side.

Enable automatic capture in Razorpay. The backend waits for `captured`; an `authorized` payment does not settle the allocation. Configure the public HTTPS webhook `/api/v1/webhooks/payments/razorpay` for `payment.captured`, `order.paid`, `payment.failed`. Public staging is recommended; localhost itself cannot receive Razorpay events.

## Rider APIs

Use the [common payment API](common-payment-api.md). Create with `POST /api/v1/rider-app/payments/orders` and `{"purpose":"DEPLOYMENT","allocationId":"<uuid>"}`. No caller-supplied amount is accepted. Verify through `POST /api/v1/rider-app/payments/orders/:paymentRequestId/verify` with Razorpay order/payment IDs and signature.

The common response identifies purpose/provider, returns a decimal `amount`, and puts SDK data in `checkout` with `amountPaise`. Keep the returned opaque paymentRequestId for verification/read calls. Detailed deployment state remains available from the existing allocation payment GET.

The current accepted commercial/deposit quote must match the saved deployment payment. Payment must be PENDING/REJECTED and workflow PAYMENT_PENDING. Paid, manually submitted and cancelled allocations cannot start another checkout. Amount must be at least INR 1; zero payments use the existing no-payment-required flow.

Orders are persisted before contacting Razorpay and OPEN orders are reused. Concurrent or ambiguous creation is recovered by receipt without blindly sending a second create request. Captured payments settle automatically; authorized payments remain pending. Callback identity, signature, amount and currency are verified. Existing manual submit/approve/reject/receipt APIs remain available.

## Settlement and records

Verified captured payments use the same transaction-based deposit collection, rental/onboarding receipt and ledger code as manual approval. Allocation row locks and unique payment IDs prevent duplicate credits when app verification, webhook delivery and reconciliation overlap. Payment approval audit is attributed to System; the financial payer identity remains the Rider. PDI, training, Team Lead and handover validations remain unchanged.

The Client Operations Payment Transactions list already includes deployment payments. Their detail history now includes system Razorpay reconciliation/refund events. Gateway order/capture details can be fetched through the Client Admin APIs below; no new panel UI is introduced.

## Webhook and reconciliation

`POST /api/v1/webhooks/payments/razorpay` requires the raw body, `x-razorpay-signature` and `x-razorpay-event-id`. It has no user login. Verify the separate webhook HMAC before persisting any event. The response is HTTP 200 after durable storage; processing runs on the one-minute reconciliation worker. Invalid signatures/payloads return 400. A duplicate event ID with different bytes is rejected.

The worker retries RECEIVED/FAILED events, recovers orders by receipt after create timeouts, and fetches provider payments before settling. An event for another application/order on the merchant account is ignored. Delayed failed events cannot downgrade a captured payment. Orders are revisited in least-recently-checked order, including superseded and paid orders, to detect late/duplicate captures. Failed attempts are excluded. Processing across multiple API instances remains safe through database settlement locks and refund claims.

Client Admin endpoints:

- `GET /api/v1/client/payments/razorpay/deployments/:allocationId` — order/capture/refund history, including review reasons. Paise values are serialized as strings to avoid BigInt JSON errors.
- `POST /api/v1/client/payments/razorpay/deployments/:allocationId/reconcile` — fetch provider state and reconcile this allocation's orders/refunds immediately.

## Refund and exception handling

Duplicate captures (including captures arriving after manual approval) and captures arriving for an already cancelled/completed allocation are recorded separately and queued for a full refund. They never create a second deposit or rental credit. The worker tracks refund IDs and completion/failure state. Before retrying an ambiguous refund call it searches by its receipt; it does not send another refund POST. Failed or unresolved refund requests remain visible for operational reconciliation.

Captured payments with stale commercial quotes, changed amounts/currency, pre-existing external refunds or conflicting references are REVIEW_REQUIRED and do not advance allocation. Never conceal captured money as an unpaid failure or start another checkout to resolve it.

Cancellation **after a payment has already been settled into deposits/ledger** is flagged `SETTLED_CANCELLATION_REQUIRES_REVERSAL`. It is not automatically refunded by this module: Client Admin must reconcile/reverse the existing accounting through the appropriate deposit/payment refund process before arranging the provider refund. Automatically refunding an already accounted deposit could otherwise leave spendable balances behind. This is distinct from cancellation before settlement, which is automatically queued above.

## Verification

Focused tests cover HMAC/raw-body integrity, client/key isolation, integer money conversion, safe provider errors and existing Cashfree/manual flows. Disposable PostgreSQL integration tests cover concurrent callback/webhook settlement, deposit/ledger idempotency, order reuse, ownership, amount mismatch, authorized payments, manual/online races, cancellation, stale amounts, ambiguous order/refund responses and durable webhook deduplication. Real Razorpay Checkout and webhook delivery require configured test credentials and a public staging URL.
