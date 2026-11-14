# Phase 2 payment reliability — Flutter handoff

Date: 2026-11-14. Backend branch: `codex/payment-integration-staging`.

Only monorepo code changed. Flutter source, dependencies, and builds are untouched. This update builds on [Phase 1](phase1-flutter-handoff.md); backend deployment and mobile sandbox acceptance are still required. No staging deployment is included in this work.

## Backend changes

1. **AutoPay retry classification and timing.** Authoritative Razorpay failures now distinguish known transient reasons, failures requiring action, and unknown reasons. Only explicitly retryable failures can enter the existing retry policy. Transport errors, uncertain creation, and unknown gateway states do not authorize another debit. Retry deadlines use the saved first failure time (`PaymentTransaction.failedAt`), so reconciliation polling no longer postpones them. Repeated observations do not emit duplicate failure audit events.
2. **One wallet transaction per new top-up.** Successful checkout posts the ledger into the original pending wallet transaction, retaining its ID and transaction number. Failed/uncertain attempts can still settle after authoritative late capture. Historical posted placeholders without ledger entries are excluded from the wallet transaction listing; their raw records are retained. Existing financial ledger entries and balances are not rewritten.
3. **Top-up reconciliation.** A successful top-up is matched only when its owned posted wallet transaction has the correct amount/currency and balanced ledger entries crediting cash. Missing accounting evidence remains `PROVIDER_SUCCESS_LOCAL_PENDING`; provider success alone does not hide a posting problem.
4. **Wallet AutoPay settlements.** Razorpay settlement imports and rematching recognize `WalletAutoRecharge` by the provider payment ID and owning client/mandate. Pending, review-required, wrong-amount, wrong-currency, foreign-client, or ambiguous records are not silently matched. Matching a gateway report is still separate from confirming bank receipt.
5. **Payment home availability.** Home-screen Pay Now now reflects the configured outstanding-payment capability, minimum amount, unresolved payments, and the separate deposit-invoice flow. AutoPay's effective status respects the rider's local enable/disable setting while retaining the gateway mandate status.

The failure reason allowlist is application retry policy based on [Razorpay's documented reasons](https://github.com/razorpay/markdown-docs/blob/master/errors/payments/list.md). It is not permission for Flutter to retry debits itself.

## Flutter contract changes

Existing create, detail, verify, reconcile, pending, and abandon routes retain the Phase 1 contract. Use server payment status and balances as authoritative.

`GET /api/v1/rider-app/payments/home` adds:

| Field | Meaning |
|---|---|
| `autoPayEnabled` | The rider's local AutoPay preference. An authorized gateway mandate alone does not mean new debits are enabled. |
| `payNowUnavailableReason` | `null` when consolidated Pay Now is available; otherwise the reason below. |

`autoPayStatus` now returns `NOT_ENABLED` when the local preference is disabled, even if `mandateStatus` remains `ACTIVE`. An expired mandate is not advertised as active. Retain `mandateStatus` for mandate lifecycle details; local disable is not gateway revocation and does not cancel payments already submitted.

Example with local AutoPay disabled and an unresolved payment:

```json
{
  "data": {
    "autoPayEnabled": false,
    "autoPayStatus": "NOT_ENABLED",
    "mandateStatus": "ACTIVE",
    "payNowAvailable": false,
    "payNowUnavailableReason": "PAYMENT_ALREADY_IN_PROGRESS"
  }
}
```

Handle these unavailable reasons:

- `NO_AMOUNT_DUE`: show no payment due.
- `PAYMENT_ALREADY_IN_PROGRESS`: offer status recovery for the existing payment, using the Phase 1 routes; do not generate new keys repeatedly. Pending AutoPay can also block consolidated payment.
- `PAY_SECURITY_DEPOSIT_INVOICE_SEPARATELY`: open the deposit invoice's `INVOICE` checkout first.
- `PAYMENT_BELOW_GATEWAY_MINIMUM`: the consolidated amount is below INR 1.00; do not launch online checkout.
- Gateway capability reasons such as `PAYMENT_MERCHANT_UNAVAILABLE`, `PAYMENT_POLICY_UNAVAILABLE`, `PAYMENT_CAPABILITY_UNAVAILABLE`, or `PAYMENT_UNAVAILABLE`: suppress checkout and show an unavailable/support path. Keep a safe fallback for future reason values.

Home eligibility is a snapshot, not a reservation or connectivity test. Creation still performs authoritative checks. `payNowAvailable` describes consolidated outstanding payment; it is not the eligibility flag for Add Money or every individual invoice.

For wallet transactions, update the existing pending row by its stable transaction ID when it becomes posted. Do not add a second local “success” entry after the SDK callback. Refresh transactions and balances from the server. Historical refreshes may show fewer rows because empty legacy placeholders are omitted; credited money has not been removed.

Retry scheduling remains backend-owned. Do not calculate a retry deadline from `updatedAt`, start a new debit from the mobile app, or show an unknown failure as automatically retryable. Use the existing server retry/dunning status when displaying scheduled retries.

## Acceptance tests after backend deployment

- Complete a top-up, including app restart and duplicate callbacks: one visible wallet transaction, unchanged ID from pending to posted, and exactly one cash credit.
- Refresh a historical top-up that previously displayed two transaction rows: one ledger-backed row remains visible and the balance is unchanged.
- Verify a successful top-up in operations reconciliation; also confirm that a deliberately missing ledger posting still requires investigation.
- Simulate a known transient failed debit, poll it repeatedly, and confirm the retry deadline stays fixed. Unknown failures, authorizations still pending, and transport timeouts must not launch a replacement debit.
- Disable AutoPay locally while the mandate is still active: show the feature as disabled without claiming the mandate was revoked. Reconcile any already-submitted debit normally.
- Verify Pay Now when there is no balance due, no supported gateway, a pending checkout, an unknown AutoPay debit, a deposit invoice, or an amount below INR 1.00.
- Import/rematch wallet AutoPay settlement evidence using the correct and wrong client, amount, and payment state. Only the correct successful payment should match. This is a backend operations check, not a mobile SDK feature.
- Repeat mobile checkout/recovery acceptance on Android and iOS for each configured TEST merchant using the [Phase 1 checklist](phase1-flutter-handoff.md).

## Release requirements

Backend verification completed locally: all 18 migrations applied to fresh PostgreSQL 16/PostGIS; the API TypeScript check passed; the full payment release suite passed **397 tests across 44 files with no skips**. Legacy failure-clock backfill checks passed for both earliest-audit and no-audit fallback cases, with the test edits rolled back. Regression coverage includes historical failure polling leaving newer attempt state unchanged.

Apply `20261114140000_payment_failure_clock` before deploying the new API. It adds `failedAt` and backfills failed attempts from their earliest failure audit, or the existing update timestamp when no audit exists. It does not schedule or initiate a debit. Earlier Phase 1 migrations remain required.

The release gate includes real PostgreSQL payment tests; gateway responses are simulated. Passing automated tests does not replace merchant sandbox and device testing. Backend release operations must supply the deployed commit before Flutter enables the updated behavior.
