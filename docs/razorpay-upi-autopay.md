# Razorpay UPI AutoPay backend

## Rollout

Apply migration `20261024190000_razorpay_upi_autopay` and regenerate Prisma before starting the API. The migration only adds columns, indexes and a capture review table; it does not rewrite existing mandates or financial records. No seed change is required.

The defaults preserve existing behavior:

- `AUTOPAY_PROVIDER=configured` selects the existing `PAYMENT_PROVIDER` for new mandates.
- `RAZORPAY_AUTOPAY_ENABLED=false` prevents new Razorpay registrations and debit requests.
- To enable UPI AutoPay, configure `AUTOPAY_PROVIDER=razorpay`, `RAZORPAY_AUTOPAY_ENABLED=true`, and the existing `RAZORPAY_ENABLED`, API key, API secret, webhook secret and client UUID allowlist. Razorpay must enable UPI recurring payments for the merchant account.
- Keep `PAYMENT_PROVIDER` and Cashfree credentials unchanged. Existing mandates and debit records always route by their saved provider. ENACH retains the configured legacy provider.
- Keep old merchant credentials available while old mandates or payments need reconciliation. A mismatched key or client allowlist fails closed.
- Disabling new Razorpay AutoPay requests does not disable reconciliation while `RAZORPAY_ENABLED=true` and the saved merchant key remains configured.

No Flutter implementation is included. Do not enable the new provider for app users until the app supports the returned hosted authorization URL and the required registration email.

## Existing Rider APIs

Continue using `/api/v1/rider-app/payments/autopay` and its existing verify, cancel, pause, resume, enable, disable, upcoming and debits routes. Authentication, client scope, package entitlement and idempotency requirements are retained.

Create request (`Idempotency-Key` required):

```json
{ "method": "UPI_AUTOPAY", "email": "rider@example.com" }
```

`email` is optional for existing Cashfree flows and required for Razorpay's hosted registration. The current Rider/User schema has no email column, so this address is saved privately on the mandate and reused for subsequent debit requests. Missing email is rejected before creating a mandate. Never invent a Rider email.

The existing mandate response retains its original fields and adds:

```json
{
  "provider": "RAZORPAY",
  "status": "AUTHORIZATION_PENDING",
  "subscriptionSessionId": null,
  "authorization": {
    "type": "HOSTED",
    "url": "https://rzp.io/example",
    "keyId": "rzp_test_example"
  },
  "capabilities": { "pause": false, "resume": false, "cancel": true, "localDisable": true },
  "cancellationPending": false
}
```

The app should open the hosted URL, then call the existing verify endpoint when the user returns. URL parameters or app success callbacks are not proof of mandate authorization. The server fetches the registration, authorization payment and customer token. A confirmed recurring UPI token is required for ACTIVE. The nominal registration payment is never allocated to an invoice or wallet.

The integration initially permits INR 1–15,000 unattended debits and mandate limits up to INR 15,000. Higher limits requiring additional payer authentication are outside this rollout. Package mandate settings must fit that limit.

## Collection and accounting

The existing wallet-first policy scheduler and finalized-invoice collection flow remain in use. Razorpay schedules require at least 25 hours of lead time. The provider receives the token and earliest debit time with the order for pre-debit notification; actual notification/debit timing remains provider-controlled. Dedicated submission-penalty invoices remain excluded from automatic scheduling.

Each debit has a stable local reference, one saved Razorpay order and a separately saved gateway payment ID. The invoice amount, currency, customer, token, method, order and captured payment are verified before settlement. Registration success and authorized-but-uncaptured payments do not settle invoices.

Unknown registration, order and debit outcomes are reconciled using saved references and provider fetches. They are not blindly submitted again. Unrecoverable/ambiguous requests remain visible for support review. This conservatively favors preventing a second debit over automatic retry. Cashfree's existing retry policy is retained.

Captured funds use the existing Rider payment ledger and wallet accounting. Concurrent verify/webhook calls settle a debit once. A late capture after an invoice was paid or voided is recorded as an unallocated payment with `UNAPPLIED_PROVIDER_PAYMENT_REVIEW`, scoped to the original Rider and invoice. It is not silently applied to unrelated invoices.

`RazorpayAutoPayCapture` records observed captures and their settlement/review outcome. Duplicate captures and external refunds are flagged with `MULTIPLE_CAPTURES_REQUIRE_REVIEW` and `EXTERNAL_REFUND_REQUIRES_REVIEW`. They do not create a second credit or silently reverse existing ledger entries. Automated Razorpay AutoPay refunds are not implemented; the refund API rejects these sources for support review rather than attempting a Cashfree refund.

## Webhooks and recovery

Use the existing signed Razorpay webhook endpoint and durable inbox. Subscribe to payment authorized/captured/failed, order paid, and available UPI token confirmed/paused/cancelled/rejected events. The same endpoint continues to process existing handover and penalty payments. Signature checks and event deduplication remain in place.

The shared worker routes token and recurring-payment events to AutoPay. A minute-based poll recovers out-of-order token events, missing callbacks and uncertain requests. Polling includes completed debits to detect late captures and external refunds. Review codes, saved provider and gateway payment ID are exposed through existing client AutoPay operations APIs.

Local disable stops new collection submissions. It cannot withdraw a request already accepted by the bank. Cancel uses the actual customer-token cancellation API, disables new local submissions immediately and reports cancellation pending until provider confirmation. Deleting a token is never used to cancel a bank mandate. Pause/resume must be performed in the payer's UPI app; existing API routes return a useful unsupported-action response for Razorpay. Cashfree pause/resume behavior is retained.

## Verification

The tests use simulated provider responses and a disposable PostgreSQL database. No real Razorpay credentials or live debit is used. Before merchant rollout, verify authorization, pre-debit notification, capture, cancellation and webhook delivery with the merchant's enabled Razorpay account and supported UPI app.

Official contracts:
- [Hosted UPI authorization](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/authorization-transaction/)
- [Subsequent UPI payments](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/subsequent-payments/)
- [Recurring UPI tokens and cancellation](https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/)
