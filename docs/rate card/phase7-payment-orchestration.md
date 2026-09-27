# Rider commercial platform: Phase 7 payment orchestration

## Flow and boundaries

Phase 6 invoices and deposits determine what is owed. Phase 7 creates a provider collection request, records its attempt, and verifies the provider result. Verified invoice payments call `RiderPaymentsService.confirmProviderPaymentInTransaction`, which creates one receipt, one payment ledger credit, and allocations against current invoice balances in a serializable database transaction. Excess cash remains unallocated. Verified deposit payments call the Phase 4 deposit engine and create a refundable deposit liability entry. If the deposit balance changed before confirmation, the confirmed cash remains an unallocated receipt for operations review.

Cashfree is behind `PaymentProvider`. The checkout adapter creates PG orders and fetches order payments; the subscription adapter retains UPI AutoPay and eNACH mandates and scheduled debits. Mock and disabled adapters implement the same contract. Neither browser handoff nor a webhook payload alone marks a payment successful. Webhooks require a valid HMAC over timestamp and raw body, are deduplicated, and trigger an authenticated provider status fetch.

## Database

`20260927040000_payment_orchestration_phase7` adds `PaymentCollectionRequest`, `PaymentCollectionPolicy`, and `PaymentRefund`; links provider collections to Phase 6 receipts or Phase 4 deposit transactions; links AutoPay transactions to receipts; and allows each attempt to belong to either an AutoPay transaction or a checkout request. It replaces the single transaction per invoice constraint with an indexed history, and adds partial unique indexes for active invoice, outstanding balance, and deposit checkouts. Database checks require positive collection and refund amounts and exactly one owner for each payment attempt.

Run the migration with the repository's normal Prisma deployment command before enabling the new endpoints. Existing invoice collections are retained as legacy transactions; reconciliation keeps their prior settlement accounting until a linked Phase 6 receipt exists.

## Configuration

- `PAYMENT_PROVIDER=mock|cashfree|disabled` continues to select the adapter.
- `CASHFREE_PG_WEBHOOK_URL` supplies the checkout webhook URL in a PG order.
- `CASHFREE_PG_WEBHOOK_SECRET` verifies PG webhook signatures. Both PG webhook settings are required when Cashfree is selected; production URLs must use HTTPS.
- Cashfree PG order and refund calls use API version `2025-01-01`; subscription calls retain `CASHFREE_API_VERSION`.
- Client AutoPay policy defaults to disabled. A client admin must enable it through `PUT /client/payment-collection-policy` and specify timing, retry intervals, eligible categories, and an optional maximum debit.

## Endpoints

Rider endpoints use the authenticated rider context, never an arbitrary rider ID:

- `POST /rider-app/billing/invoices/:invoiceId/pay` starts checkout for current invoice outstanding.
- `POST /rider-app/billing/payments/pay-outstanding` starts checkout for total current outstanding.
- `POST /rider-app/billing/deposits/:depositId/pay` starts a deposit checkout.
- `POST /rider-app/billing/collections/:collectionId/verify` checks provider status after handoff.
- `GET /rider-app/billing/collections` lists attempts.
- `GET /rider-app/payments/home`, `/history`, `/attempts/:id`, and `/refunds` supply payment screen data.
- Existing `GET/POST /rider-app/payments/autopay` remains; the create request accepts `UPI_AUTOPAY` or `ENACH` when the selected package permits it. `POST /rider-app/payments/autopay/:mandateId/cancel` invokes provider cancellation.

Client admin endpoints:

- `GET/PUT /client/payment-collection-policy` reads and updates collection policy.
- `GET /client/payment-reconciliation` lists matching and review states; `POST /client/payment-reconciliation/:riderId/:id/retry` rechecks a specific provider collection without an arbitrary accounting override.
- `GET /platform/payment-reconciliation/unknown-provider-events` exposes signed but unmatched event metadata to super admins for investigation.
- `POST /client/riders/:riderId/payments/:paymentId/refunds` requests a full provider refund; `POST /client/riders/:riderId/payments/refunds/:refundId/verify` verifies it; `GET /client/riders/:riderId/payments/refunds` lists refunds. Successful verification reverses allocations, reopens non-void invoices, posts a reversing ledger debit, and retains the original receipt.

Mutating collection and refund requests require `Idempotency-Key`. The service holds unknown provider outcomes for verification rather than issuing a new collection or refund with a different key.

## Scheduling and recovery

The hourly scheduler reads enabled client policies and active rider preferences, checks invoice categories, current outstanding, existing in-flight collections, mandate eligibility, and the mandate limit, then schedules a provider debit. It re-reads invoice balance immediately before sending the provider request. A later manual payment can make a provider success an overpayment; that cash remains accounted for and unallocated. Failures retry only when the provider adapter classifies them as retryable and the client policy permits another attempt. Unknown results remain blocked for reconciliation. Manual Pay Now remains available after a failed AutoPay attempt.

The scheduler also polls old pending and unknown AutoPay, checkout, and refund operations. The reconciliation endpoint identifies unallocated cash, amount mismatches, and local settlement gaps without automatically editing ambiguous financial records.

## Operational limits

- Cashfree schedules subscription debits by India calendar date; a configured custom hour is retained in policy but cannot guarantee the provider's execution hour.
- Provider refunds currently support full receipt refunds. Partial refunds and provider-initiated reversals without an EVsEye refund request require manual reconciliation.
- A definitively failed provider refund is retained for investigation; the same receipt cannot be submitted through an automatic second refund attempt.
- Deposit refunds continue through the Phase 4 deposit refund workflow. The Phase 7 receipt refund endpoint excludes normal deposit collections.
- A provider result without a matching amount, currency, order, or identity is held for review. A checkout order with no provider payment result remains pending or unknown until verification resolves it.
