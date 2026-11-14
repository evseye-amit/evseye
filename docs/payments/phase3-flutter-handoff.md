# Payment reliability follow-up: Flutter handoff

Date: 2026-11-14. Scope: monorepo backend, tests and staging workflow only. No Flutter source was changed. This document supplements [Phase 2](phase2-flutter-handoff.md) and the [payment API contract](mobile-payment-api-contract-v1.md).

## Flutter actions

1. Continue treating server verification/reconciliation as authoritative. `WALLET_INACTIVE` rejects a new top-up before order creation. Show the wallet restriction; do not repeatedly create orders with new idempotency keys.
2. Captures that cannot settle locally are retained. Common order detail returns `REVIEW_REQUIRED` with `nextAction: CONTACT_SUPPORT` for `WALLET_SETTLEMENT_REQUIRES_REVIEW` or `CAPTURE_SETTLEMENT_PENDING_REVIEW`. Do not display success, start a replacement payment or retry the SDK. Keep the payment request ID available for support/reconciliation. After wallet reactivation, backend reconciliation can settle the original payment exactly once.
3. When wallet payment conflicts with an existing checkout or debit, handle `PAYMENT_ALREADY_IN_PROGRESS` / `AUTOPAY_ALREADY_IN_PROGRESS` by recovering the existing request. Wallet funds are no longer consumed before those checks. Preserve the original idempotency key for retries, including wallet-only success.
4. Payment home can return `payNowUnavailableReason: UNSUPPORTED_INVOICE_CURRENCY`. Disable Pay Now and show the supplied currency. A single currency retains decimal-string `amountDue` and `overdueAmount`. For mixed currencies, `amountDue`, `overdueAmount` and `currency` are **null**, and the new `balancesByCurrency` array contains separate decimal-string totals. Update nullable parsing; do not add currencies together or assume INR. Normal INR-only responses retain their existing scalar values.
5. Cashfree collection/receipt history now uses verified method evidence (`UPI`, `CARD`, `NETBANKING`, `WALLET`, `EMI`, `PAYLATER`, `BANK_TRANSFER`, or `UNKNOWN`). Do not hardcode a UPI label. The common order's nullable `paymentMethod` field still reads Razorpay capture evidence; Cashfree callers must not infer a method from that null field. Existing historical receipts are not rewritten from assumptions.
6. AutoPay creation uncertainty remains recoverable by the original debit ID. `CREATE_UNCERTAIN_REQUIRES_REVIEW` requires support/provider reconciliation, not a second debit. Full payment reversal can reopen an invoice. Backend operations exposes `REFUND_RECOLLECTION_REQUIRES_APPROVAL`; an administrator must explicitly schedule recollection before normal automatic retries resume. Flutter must not trigger a fresh AutoPay debit in response to a refund.

Example mixed-currency home fields:

```json
{
  "amountDue": null,
  "overdueAmount": null,
  "currency": null,
  "payNowAvailable": false,
  "payNowUnavailableReason": "UNSUPPORTED_INVOICE_CURRENCY",
  "balancesByCurrency": [
    { "currency": "INR", "amountDue": "500.00", "overdueAmount": "500.00" },
    { "currency": "USD", "amountDue": "10.00", "overdueAmount": "0.00" }
  ]
}
```

## Backend delivery and release requirements

- Wallet funding and checkout reservation now share one database transaction. Wallet billing guards pending checkout and AutoPay obligations across providers.
- New Cashfree debits claim dispatch atomically. Recovery resumes a proven-unsent reservation with the original identity, amount, schedule and pinned merchant. Expired/ineligible unsent requests fail safely without charging. Already-claimed or historical uncertain requests are fetched and flagged for review if absent; they are never blindly resubmitted.
- Migration `20261114160000_cashfree_dispatch_recovery` conservatively marks pre-existing Cashfree CREATING rows as potentially dispatched. Migration `20261114161000_refunded_collection_reservation` reserves invoices only for unresolved attempts, allowing an explicit new collection after a full refund while retaining successful debit history.
- Recovery rotates attempted transactions, checkouts and refunds even when provider verification fails. A broken merchant no longer occupies the same batch indefinitely.
- Staging now runs `payment-deployment-gate.mjs` in the candidate API task definition before updating the service. It checks all required migrations/readiness counts, exactly one valid active policy per intended client/environment, retained credential fingerprints, and authenticated read-only gateway access. It requires explicit client merchant configuration; an empty intended-merchant set fails closed. `PAYMENT_READINESS_CLIENT_IDS` can explicitly select the intended clients; otherwise all clients with an ACTIVE merchant policy in that environment are checked. Intentionally inactive-only configurations are excluded from that default selection. The gate uses the candidate API task's secrets, not a migration task's reduced environment.
- The gate makes no order, charge or refund. Successful credential checks do **not** establish UPI Intent, QR, subscription entitlement, live payment acceptance or Flutter device readiness. Record deployed SHA, migration output, gate logs and controlled device acceptance before rollout sign-off. No deployment or live transaction was performed by this code change.

## Acceptance cases for Flutter and release owners

- Wallet-only success and replay; partially funded invoice; an already-open online checkout; an in-progress AutoPay debit.
- Wallet suspended before top-up and after checkout creation; late successful capture; review UI; recovery after reactivation with one wallet credit.
- UPI/card/missing-method histories without a guessed UPI label.
- INR-only, single unsupported currency and mixed-currency home responses.
- App restart after provider debit and before local settlement; retain original request identity and recover status.
- Full refund, reopened invoice and explicit operations-approved recollection.

Gateway method reference: [Cashfree payments for an order](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order). The backend retains bounded method labels only, not payer/card details.

## Validation evidence

- Payment release acceptance: **448 tests passed across 46 files, no skips**, against a fresh disposable PostgreSQL 16/PostGIS database with all five release database variables set.
- Wallet and provider-refund accounting: **24 tests passed across 6 files**.
- All **21 migrations** applied from scratch. A rollback-isolated regression verified conservative backfill of historical Cashfree dispatch claims; database tests verified explicit recollection after a full refund.
- API TypeScript checking, targeted lint, whitespace checks, workflow YAML/step-order validation, and native Node loading of the production gate passed.
- Automated gateway responses were simulated. No staging deployment, merchant configuration change, real charge/refund or Flutter device acceptance was performed.
