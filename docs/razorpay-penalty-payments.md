# Razorpay submission penalty payments

Rider authentication and client scoping apply to both endpoints. Existing Cashfree invoice/AutoPay and Razorpay handover routes remain available. Flutter integration is separate.

## Create, read and verify

Use the [common payment API](common-payment-api.md):

- `POST /api/v1/rider-app/payments/orders` with `{"purpose":"SUBMISSION_PENALTY","amount":"500.00"}`. Omit amount for full balance; Razorpay is the default provider. Explicit `provider: CASHFREE` retains the configured-provider partial penalty option.
- `GET /api/v1/rider-app/payments/orders/:paymentRequestId` reads the common state.
- `POST /api/v1/rider-app/payments/orders/:paymentRequestId/verify` accepts the Razorpay order/payment IDs and signature, or an empty body for Cashfree.

Purpose and provider are resolved from the saved payment request during verification. Penalty allocation uses the immutable invoice snapshot. Captured payments post one RiderPayment, billing ledger credit and wallet history entry using the shared penalty settlement code. The common response uses SUCCEEDED or REVIEW_REQUIRED rather than exposing a raw collection SUCCESS with a review code.

## Webhooks and recovery

The existing signed `POST /api/v1/webhooks/payments/razorpay` persists events before acknowledgement. Its existing minute worker routes penalty orders as well as handover orders and reconciles orders even if the app never calls verify. Duplicate calls/events cannot post a second ledger credit. Separate order and capture records retain gateway state.

New invoices after order creation are excluded. Payments against already cleared invoice portions remain unallocated and are flagged for support review. Duplicate captures and external refunds are also flagged for review; no automatic refund or accounting reversal is performed. The existing payment collection detail includes the Razorpay order and capture review evidence. Existing collection verification/admin reconciliation also routes Razorpay collections to Razorpay rather than Cashfree. Cashfree refund routes reject Razorpay payments rather than sending them to the wrong provider.

The summary exposes the common `payEndpoint` and `paymentPurpose`. Active Razorpay checkout appears as `paymentInProgress.source = RAZORPAY`, including `orderId`, and disables `payNowAvailable`. Review-required captured payments also block another Razorpay attempt pending support resolution. Partial unpaid debt continues to block the next handover under existing rules.

## Configuration and database

Use the existing `RAZORPAY_ENABLED`, `RAZORPAY_CLIENT_IDS`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. No change to `PAYMENT_PROVIDER` is required. An unavailable client/account receives `RAZORPAY_UNAVAILABLE` (503).

Apply migration `20261024170000_razorpay_penalty_payments` before running the updated API. No seeds are required.
