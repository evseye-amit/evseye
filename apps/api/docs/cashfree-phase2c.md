# Cashfree Phase 2C: Rider invoice collection

Apply `20260925210000_cashfree_invoice_collection` after the Rider billing and mandate migrations. It adds one client-scoped `PaymentTransaction` per invoice and a `PaymentAttempt` record. Existing billing and mandate rows are retained. The immutable Rider ledger receives a `PAYMENT` credit only after Cashfree's payment lookup confirms a successful `CHARGE` for the exact subscription, payment ID, and invoice amount.

## API contract

All routes are under `/api/v1` and use the existing cookie/access-token authentication.

- `POST /client/riders/:riderId/billing/invoices/:invoiceId/collect` (Client Admin): `Idempotency-Key: collect-invoice-123`; body `{ "scheduledAt": "2026-10-02T10:00:00+05:30" }`. The API reads the finalized invoice's outstanding amount. The caller cannot provide an amount or mandate ID. It requires an active mandate that remains valid through the schedule date and has sufficient per-charge capacity. Returns `data.paymentId`, provider payment ID, amount, schedule date, and status.
- `GET /rider-app/billing/payments` (Rider): latest 100 collection records for the authenticated Rider.
- `POST /rider-app/billing/payments/:paymentId/verify` (Rider): fetches the authoritative Cashfree status. Repeated verification of a successful payment does not add another ledger entry.
- `POST /webhooks/payments/cashfree` (Cashfree): existing signed raw-body webhook endpoint. Register `SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED`, `SUBSCRIPTION_PAYMENT_SUCCESS`, `SUBSCRIPTION_PAYMENT_FAILED`, and `SUBSCRIPTION_PAYMENT_CANCELLED` alongside the mandate events. Webhook payloads are deduplicated and trigger a provider lookup; webhook content alone never settles an invoice.

Example response after scheduling:

```json
{
  "data": {
    "paymentId": "payment-uuid",
    "invoiceId": "invoice-uuid",
    "riderId": "rider-uuid",
    "status": "PENDING",
    "amount": "1200.00",
    "currency": "INR",
    "scheduledAt": "2026-10-02T04:30:00.000Z",
    "providerPaymentId": "EVSEYE_PAY_...",
    "providerReference": null,
    "completedAt": null
  }
}
```

The amount is snapshotted on the payment transaction. A network timeout leaves the transaction `UNKNOWN`; use verification and inspect Cashfree before any new charge. A second key for the same invoice is rejected. This phase does not automate retries, refunds, or mandate fallback.

Cashfree considers only the India calendar date of `payment_schedule_date`. The API rejects a date that is today or earlier in India. The merchant must validate its Cashfree pre-debit notification configuration and required lead time before enabling live collections. Scheduling alone is not proof that a notification was sent; the notification webhook is recorded and payment success is verified separately. Run a Cashfree sandbox end-to-end charge and signed webhook test with merchant credentials before production use.

Official reference: [raise a charge](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/raise-a-charge-or-create-an-auth), [fetch a payment](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/fetch-details-of-a-single-payment), [subscription webhook events](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/webhooks).
