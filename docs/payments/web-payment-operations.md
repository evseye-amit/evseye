# Web payment operations checkpoint

Available locally under Payment Transactions → Online payment operations for CLIENT_ADMIN. All API operations derive the client from authenticated context; the UI does not accept a client override. Flutter is unaffected.

## Included

- Payments/refunds: source, gateway, rider reference, state and amount; provider checks for checkout, AutoPay and owned deployment attempts; refund verification; deployment capture/refund references and reasons.
- Cashfree refund request form with reason, amount and accounting treatment. The backend enforces confirmed-payment status, reservation limits and accounting rules. Pending requests retain the exact body/key in session storage, scoped to authenticated client/user/payment. Storage must succeed before submission; an uncertain response locks the request for identical retry. Closing/reopening the dialog restores it in the same tab/session. If browser storage is lost, inspect existing refund records before requesting another refund.
- Refund recovery uses the saved provider. Cashfree webhooks use Cashfree verification even when the global checkout default changes. Unsupported Razorpay general refunds remain support-only; deployment refunds continue through the existing deployment capture workflow.
- AutoPay mandate list. Debits are visible in payment reconciliation; this checkpoint does not provide administrative mandate cancellation or a dunning-management screen.
- Normalized settlement report import for CASHFREE and RAZORPAY, with report/detail and exception display. Server validates totals, references, duplicate entries, status, amount and currency. Razorpay matching includes collection payments, AutoPay gateway payment IDs, deployment captures and deployment refunds. Ambiguous matches stay in review.
- Razorpay configuration shows current version and local resolution, explicitly not gateway connectivity certification. Configuration forms still support Razorpay only.

## Normalized settlement import

POST /api/v1/client/finance/provider-settlements/imports accepts the JSON file below. The UI previews its provider/reference/item count/net before submission. This format is normalized application input, not an unmodified provider dashboard export. Convert gateway export fields deliberately before import.

```json
{
  "provider": "RAZORPAY",
  "providerSettlementId": "setl_example",
  "currency": "INR",
  "grossAmount": "500.00",
  "refundAmount": "0.00",
  "feeAmount": "10.00",
  "taxAmount": "1.80",
  "netAmount": "488.20",
  "settledAt": "2026-11-13T00:00:00.000Z",
  "items": [{ "kind": "PAYMENT", "providerReference": "pay_example", "amount": "500.00" }]
}
```

provider may be omitted for legacy Cashfree imports. Existing Cashfree canonical hashes are preserved. Identical report replay returns the existing report; changed contents with the same client/provider/settlement ID return SETTLEMENT_IMPORT_CONFLICT. Items are PAYMENT or REFUND; amounts use INR decimal strings. For Razorpay, use actual gateway payment/refund IDs, not local debit IDs or order IDs. Report matching never creates payment receipts or credits a bank account.

Review results include MISSING_INTERNAL, STATUS_MISMATCH, AMOUNT_MISMATCH, CURRENCY_MISMATCH, AMBIGUOUS_INTERNAL and DUPLICATE_PROVIDER_RECORD. Reports are snapshots: this checkpoint does not rematch an existing report after a local status changes. REPORT_MATCHED means internal records match the imported report, not that a bank receipt was independently verified.

## Limits and remaining work

Lists are bounded to the most recent records (200 per reconciliation source and settlement reports, 100 mandates). Full exports/pagination, rider-friendly labels, provider-native file parsing, direct settlement API ingestion, rematching/exception resolution and bank confirmation remain pending. There is no new live gateway refund capability for Razorpay invoice, penalty or AutoPay payments. Distributed worker leases, coordinated backoff and aging alerts also remain pending.

Tests: payment contract/policy/recovery unit suites; provider settlement/refund/operations tests; PostgreSQL import concurrency and tenant isolation; web action/idempotency tests. Browser smoke checks use mocked API responses and verify panel navigation, provider recovery and identical refund retries after 503. They do not establish live provider readiness.
