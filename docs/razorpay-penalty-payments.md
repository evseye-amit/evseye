# Razorpay submission penalty payments

Rider authentication and client scoping apply to both endpoints. Existing Cashfree invoice/AutoPay and Razorpay handover routes remain available. Flutter integration is separate.

## Create or reuse an order

`POST /api/v1/rider-app/submission-penalties/razorpay/order`

Send `{}` (or no body) for the outstanding penalty balance, or `{"amount":"500.00"}` for a partial payment. Amount is a decimal string, minimum INR 1, maximum the current outstanding penalty balance. Other fields are rejected.

Response: `{"data":{"keyId":"rzp_test_...","orderId":"order_...","amount":50000,"currency":"INR"}}`.

Checkout amount is in paise. Invoices and allocation limits are saved before contacting Razorpay. Existing open orders are reused for the same amount. A pending collection with another provider blocks a new order and vice versa. Ambiguous order creation is recovered by receipt; it is never blindly retried as another create request.

## Verify

`POST /api/v1/rider-app/submission-penalties/razorpay/verify`

Body: `{"razorpayOrderId":"order_...","razorpayPaymentId":"pay_...","razorpaySignature":"<64 hex characters>"}`.

Ownership, signature, gateway payment order, amount, currency and capture state are checked. An authorized payment is still pending. Captured payments automatically post one RiderPayment, invoice allocations, billing ledger credit and wallet payment history using the same settlement function as Cashfree penalty checkout.

Response `data` contains the refreshed submission penalty summary plus `orderId`, `paymentId`, `paymentStatus`. `nextAction` is `AWAITING_GATEWAY_CONFIRMATION` for pending capture or `CONTACT_SUPPORT` for review. A failed attempt returns `RETRY_ONLINE_PAYMENT` when no other attempt is pending; retry Checkout with the same order (the collection remains reserved to prevent a concurrent second checkout). It is absent on settled payments.

## Webhooks and recovery

The existing signed `POST /api/v1/webhooks/payments/razorpay` persists events before acknowledgement. Its existing minute worker routes penalty orders as well as handover orders and reconciles orders even if the app never calls verify. Duplicate calls/events cannot post a second ledger credit. Separate order and capture records retain gateway state.

New invoices after order creation are excluded. Payments against already cleared invoice portions remain unallocated and are flagged for support review. Duplicate captures and external refunds are also flagged for review; no automatic refund or accounting reversal is performed. The existing payment collection detail includes the Razorpay order and capture review evidence. Existing collection verification/admin reconciliation also routes Razorpay collections to Razorpay rather than Cashfree. Cashfree refund routes reject Razorpay payments rather than sending them to the wrong provider.

The summary exposes `razorpayOrderEndpoint` and `razorpayVerifyEndpoint`. Active Razorpay checkout appears as `paymentInProgress.source = RAZORPAY`, including `orderId`, and disables `payNowAvailable`. Review-required captured payments also block another Razorpay attempt pending support resolution. Partial unpaid debt continues to block the next handover under existing rules.

## Configuration and database

Use the existing `RAZORPAY_ENABLED`, `RAZORPAY_CLIENT_IDS`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. No change to `PAYMENT_PROVIDER` is required. An unavailable client/account receives `RAZORPAY_UNAVAILABLE` (503).

Apply migration `20261024170000_razorpay_penalty_payments` before running the updated API. No seeds are required.
