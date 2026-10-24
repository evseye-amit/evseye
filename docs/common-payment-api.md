# Common Rider payment API

All endpoints require Rider authentication. Client and Rider identity come from the token. Amounts and obligations are validated server-side. Flutter integration is separate.

## Create or reuse checkout

`POST /api/v1/rider-app/payments/orders`

Supported request bodies:

- Allocation/handover: `{"purpose":"DEPLOYMENT","allocationId":"<uuid>"}`. Razorpay collects the full accepted commercial/deposit quote. Caller amounts are rejected.
- Consolidated penalties: `{"purpose":"SUBMISSION_PENALTY","amount":"500.00"}`. Defaults to Razorpay. Omit amount for the full outstanding penalty balance.
- Cashfree consolidated penalties: `{"purpose":"SUBMISSION_PENALTY","provider":"CASHFREE","amount":"500.00"}`. Retains the existing scoped partial payment flow through the configured checkout adapter.
- Individual invoice: `{"purpose":"INVOICE","invoiceId":"<uuid>","useWallet":true}`. Uses the configured checkout provider after existing wallet settlement rules. Wallet use defaults to true.
- Outstanding invoices: `{"purpose":"OUTSTANDING","amount":"500.00"}`. Uses the configured checkout provider and the existing ALL scope, including eligible penalty invoices. Omit amount for the full outstanding balance.
- Deposit: `{"purpose":"SECURITY_DEPOSIT","depositId":"<uuid>"}`. Uses the configured checkout provider for the current required deposit shortfall.

`Idempotency-Key` is required for configured-provider checkout: INVOICE, OUTSTANDING, SECURITY_DEPOSIT and explicit CASHFREE penalty checkout. Reuse it unchanged on retries. Razorpay retains existing durable order reuse, concurrent-tap protection and ambiguous-create recovery.

Partial amounts are decimal strings, up to two decimal places, from INR 1 to the selected outstanding balance. Unknown purposes, fields and unsupported provider combinations are rejected. DEPLOYMENT and SECURITY_DEPOSIT do not accept partial amounts. No caller-supplied Rider, currency or successful payment status is accepted.

Example Razorpay response:

```json
{
  "data": {
    "paymentRequestId": "collection:<uuid>",
    "purpose": "SUBMISSION_PENALTY",
    "provider": "RAZORPAY",
    "status": "PENDING",
    "amount": "500.00",
    "currency": "INR",
    "providerOrderId": "order_...",
    "providerPaymentId": null,
    "failureCode": null,
    "checkout": { "orderId": "order_...", "keyId": "rzp_test_...", "amountPaise": 50000 },
    "nextAction": "AWAITING_GATEWAY_CONFIRMATION"
  }
}
```

Create returns checkout parameters to open the appropriate SDK; verify determines the final payment state. Cashfree/configured checkout returns `checkout: {"orderId":"...","paymentSessionId":"..."}`. The mock adapter is labeled MOCK. Amount at the top level is always a decimal currency string; Razorpay SDK amount is explicitly `amountPaise`.

When wallet funding pays an invoice completely, the response has `provider: WALLET`, `status: SUCCEEDED`, `paymentRequestId: null` and `checkout: null`. There is no external checkout to verify. Existing invoice/wallet history contains the settlement.

Payment request IDs are opaque, namespaced references to existing records: `collection:<uuid>` for collections and `deployment:<uuid>` for deployment gateway orders. Return them unchanged; do not substitute a provider order ID. This API does not require a new table, a new migration or data deletion.

## Read and verify

`GET /api/v1/rider-app/payments/orders/:paymentRequestId`

Returns the same common payment representation, scoped to the authenticated client and Rider. Reading does not contact a gateway or settle money. Cancelled allocations and manually submitted deployment payments do not expose checkout parameters.

`POST /api/v1/rider-app/payments/orders/:paymentRequestId/verify`

For Razorpay, send:

```json
{
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "<64 hexadecimal characters>"
}
```

For Cashfree/mock, send `{}` or no body. Server-side provider lookup supplies the authoritative result. Purpose, provider, amount and success state cannot be supplied to verification. Razorpay callback order ID must match the saved payment request before signature verification/settlement.

Responses normalize status to CREATING, PENDING, SUCCEEDED, FAILED, CANCELLED, EXPIRED, UNKNOWN, REVIEW_REQUIRED, REFUND_PENDING or REFUNDED. Settled penalty surplus is REVIEW_REQUIRED even though its underlying collection is SUCCESS. Refund/review captures take precedence over paid business records. `checkout` is null for completed/review/refund states.

`nextAction` can be AWAITING_GATEWAY_CONFIRMATION, RETRY_ONLINE_PAYMENT or CONTACT_SUPPORT. A failed Razorpay attempt can retry using the same reserved order; do not create a second collection while payment state is uncertain. SUCCEEDED has no nextAction. Refresh existing allocation/penalty/invoice/wallet APIs for detailed business results after verification.

## Retained functionality

The common API calls the existing deployment, penalty and configured checkout services. It does not replace their financial settlement, invoice snapshots, deposits, wallet behavior, reconciliation, refund protections, client allowlists or credentials.

The replaced Rider gateway-specific order/verify and billing checkout create/verify routes are removed from controllers. Billing collection read endpoints remain available. Manual payment submission/receipt/approve/reject, AutoPay/mandate/scheduled collection, admin reconciliation and gateway webhooks remain unchanged.

No change to PAYMENT_PROVIDER is needed for Razorpay; it remains independent of the configured Cashfree/mock/disabled checkout adapter. Razorpay must still be enabled and configured for the client. Gateway secrets are never returned. Configure existing webhook URLs for server-side recovery when the app closes.
