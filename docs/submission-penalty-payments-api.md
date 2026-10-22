# Submission penalty payments and handover clearance

All endpoints use `/api/v1` and bearer authentication.

## Submission does not wait for payment

Keep the existing evidence, mechanic report, impose, OTP/bypass and confirm flow.
When a nonzero report is finalized with
`POST /client/vehicle-submission-reports/:reportId/confirm`, its existing
RETURN_PENALTY charge is attached to one dedicated finalized SUBMISSION_PENALTY
invoice in the same transaction. The response adds `paymentRequest`, containing
invoice ID, frozen itemized breakdown, totals, payment status and pay endpoint.
A zero-penalty report returns `paymentRequest: null`.

Physical return/exchange intake completes regardless of whether the rider pays.
A push/payment provider is never called during confirmation. Identical retries
return the same invoice and never post another charge. Historical DEEP reports
and their existing invoices remain readable; new report writes accept only the
BASIC stage.

Penalty amounts are displayed as outstanding dues, not spendable wallet funds.
The existing charge posts the debit once; invoice creation posts no second debit.
External payments use existing provider verification/webhook and wallet/billing
history. Wallet-funded penalty payments and reversals also update the rider
billing ledger. Refund/reversal that reopens an invoice makes its debt visible
again. Security deposit and settlement rules are not changed by this feature.

## Rider dialog and history

- `GET /rider-app/submission-penalties?page=1&limit=25&status=PENDING`
- `GET /rider-app/submission-penalties?status=ALL` for paid and pending history.
- `GET /rider-app/submission-penalties/:invoiceId`

List returns `{ data: [...], meta: { page, limit, total } }`. Limit is 1–100.
Each item includes `invoiceId`, `invoiceNumber`, `currency`, `totalAmount`,
`paidAmount`, `settledCreditAmount`, `outstandingAmount`, invoice `status`,
`paymentStatus` (PENDING/PARTIALLY_PAID/PAID), `createdAt` and `payEndpoint`.
`breakdown` includes report/submission/vehicle references, BASIC/DEEP stage,
summary and frozen `penalties` (description/code, quantity, unit amount, amount,
explanation and proof IDs). Amounts are decimal strings. Only the authenticated
rider's invoices in their client are accessible.

`GET /mobile-deployments/rider/current` adds `submissionPenalties` independently
of scooter data, including on waiting/payment/PDI screens. Its fields are
`pendingCount`, `outstanding` grouped by currency, up to five oldest
`paymentRequests`, and `listEndpoint`. Returned riders stay on HOME with null
allocation/scooter data and keep this summary plus wallet/last-earnings data.
`GET /rider-app/wallet` and `/rider-app/wallet/balance` include the same summary.

The Flutter app should show the payment dialog from `paymentRequests`, render
`breakdown.penalties`, and allow dismissal. Dismissing is a client UI operation;
it never cancels, waives, or marks the debt paid. Fetch again on login/Home
refresh and after returning from checkout. An uninstalled/offline app does not
change debt treatment.

## Pay using existing checkout

`POST /rider-app/billing/invoices/:invoiceId/pay`

Headers: `Idempotency-Key: penalty-payment-001` (8–120 safe characters).
Body: `{"useWallet":true}` (or false for external checkout only).
Wallet funding follows existing policy; this invoice uses the PENALTY category.
No automatic spendable-wallet deduction is performed just for imposing a penalty.
The automatic collection scheduler excludes these dedicated invoices, so the
rider initiates payment through the dialog/checkout.

If a balance remains, use the returned payment session with the configured
provider. Then call
`POST /rider-app/billing/collections/:collectionId/verify` or wait for the verified
provider webhook. Never trust the client checkout success callback as proof of
payment. Poll `GET /rider-app/billing/collections/:collectionId` and refresh the
penalty detail. Reuse the idempotency key for retries of the same attempt.
External checkout requires existing payment-provider configuration.
`POST /rider-app/billing/payments/pay-outstanding` also includes these invoices.

## Fleet Manager status

`GET /client/vehicle-submissions/:submissionId/penalties`

Returns `{ data: { submissionId, paymentRequiredToCompleteSubmission: false,
paymentRequests: [...] } }`. FM access is limited to active assigned submission
hubs; admins/operations retain their existing client scope. Payment may remain
pending after the fleet manager finishes submission.

## Notification delivery

A background worker queues one in-app/push message per pending penalty invoice
through the existing notification system. This is independent of submission.
Notification enqueue failures are retried; missing/expired tokens and push
failures never roll back submission. In-app history and pending-payment APIs
remain available without FCM delivery. Notification data contains
`type: SUBMISSION_PENALTY_PAYMENT`, `invoiceId`, and
`route: SUBMISSION_PENALTY_PAYMENT`. Fetch the invoice to determine current
status rather than displaying stale notification amounts as the current due.

## Block the next handover, with an audited admin exception

`GET /mobile-deployments/:allocationId/penalty-clearance`

Fleet managers see only allocations in active assigned hubs. Response includes
`hasUnpaidPenalties`, `outstanding` grouped by currency, `handoverBlocked`, and
any matching `exception`.

Every shared commercial activation path, including mobile, staff activation and
exchange replacement handover, blocks with HTTP 409,
`UNPAID_SUBMISSION_PENALTIES`, when the rider has unpaid return penalties.
Existing unbilled RETURN_PENALTY charges also count; they retain their existing
billing path. Login, wallet access, payment and physical submission stay allowed.

Only CLIENT_ADMIN may call:

`POST /client/mobile-deployments/:allocationId/penalty-handover-exception`

```json
{ "reason": "Approved payment arrangement; allow rider to resume work" }
```

A nonblank reason of at most 500 characters is mandatory. The approval is
client/rider/allocation scoped, records its approver and exact debt snapshot,
and is audited. It is consumed only when that allocation's handover succeeds;
transaction rollback preserves it. Debt changes require fresh approval. An
exception permits one handover; it does not forgive debt, remove pending payment
requests or bypass Team Lead/PDI/payment requirements. It cannot carry over to
another allocation.

## Setup

Apply migration `20261018030000_submission_penalty_payments` before running this
code. It adds notification bookkeeping and the audited exception table. There
is no automatic backfill or debt waiver. Existing database data is not reset.
