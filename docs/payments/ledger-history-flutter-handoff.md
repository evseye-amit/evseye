# Flutter handoff: deployment transactions and ledger terminology

Date: 2026-11-23
Status: backend and web follow-up implemented locally; Flutter implementation required. This follow-up is not yet deployed.

## Product behavior

Show confirmed deployment/onboarding payments alongside other transactions. This includes existing historical payments, without a migration or new financial postings. Rename customer-facing “Wallet” to “Transactions” for navigation and activity, or “Ledger” for balances and statements. Apply this across all locales, accessibility labels, errors, notifications, receipts, support categories, and AutoPay screens.

Keep internal API paths, model/property names, localization keys, error codes, and database names unchanged. This is a presentation change, not a change in accounting or a determination of regulatory compliance.

## API contract

Existing routes remain under `/api/v1`:

- `GET /rider-app/wallet`: `data.recentTransactions` includes deployment payments in the latest 10 transactions.
- `GET /rider-app/wallet/transactions?page=1&pageSize=20`: existing `data` array and `meta: { page, pageSize }` envelope; combined history is paginated on the server.
- `GET /rider-app/wallet/transactions/:id`: accepts the opaque deployment ID returned by history. URL-encode the ID.
- Staff: `GET /riders/:riderId/wallet/transactions`: includes deployment payments with existing pagination totals and date/type/status filters.

Only deployment records with `status=PAID` and a positive amount appear. Pending, rejected, and zero-charge deployment requests are not completed transactions. Rider history includes only that rider's authenticated client and ledger currency. Deployment records are read directly, so historical payments appear immediately after backend rollout.

Example entry:

```json
{
  "id": "deployment:550e8400-e29b-41d4-a716-446655440000",
  "transactionNumber": "EVD-550e8400-e29b-41d4-a716-446655440000",
  "transactionType": "PAYMENT",
  "status": "POSTED",
  "amount": "1200.10",
  "currency": "INR",
  "description": "Deployment payment (paid externally)",
  "referenceType": "DEPLOYMENT_PAYMENT",
  "referenceId": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-10-01T00:00:00.000Z",
  "postedAt": "2026-10-02T00:00:00.000Z",
  "affectsBalance": false,
  "movements": [],
  "breakdown": {
    "status": "AVAILABLE",
    "items": [
      { "type": "SECURITY_DEPOSIT", "label": "Security deposit", "amount": "500.00" },
      { "type": "ONBOARDING_FEE", "label": "Onboarding fee", "amount": "200.10" },
      { "type": "RENTAL", "label": "Rental plan amount", "amount": "500.00", "period": "WEEKLY" }
    ]
  }
}
```

IDs are opaque strings, not necessarily UUIDs. `referenceId` is a DeploymentPayment ID, not a RiderPayment ID. Do not send it to `/receipts/payments/:id` or to ledger-entry/reversal endpoints. Existing payment-transaction details use source `DEPLOYMENT`; retain that flow for deployment evidence rather than inventing a receipt link.

`affectsBalance` and `movements` are additive history fields. For ordinary transactions, movements contain the signed changes for CASH, REWARD, and SECURITY_DEPOSIT; `affectsBalance` reflects whether any such movement is nonzero. Existing ordinary transaction-detail payloads may omit these fields: parse them as optional. Deployment and agreement-deposit-refund detail include both.

Combined history is ordered by `createdAt DESC, id DESC`. Display the payment date using `postedAt ?? createdAt`. Staff date filters continue to use creation date, in UTC; do not re-sort each page locally.

## Flutter implementation

1. Preserve the fields above through `WalletLedgerEntry` → `WalletEntry`. Detect deployment entries using `referenceType == 'DEPLOYMENT_PAYMENT'`.
2. Display “Deployment payment”, “Paid externally”, and an unsigned amount for these entries. The current `PAYMENT` mapping assumes a balance debit; override that for deployment entries. Do not show a minus sign, a cash credit, or a balance reduction. Show “No change to ledger balance” in details.
3. Keep amounts as decimal strings through parsing. Do not derive balances from history. Use the balance API for cash, rewards, holds, and deposits.
4. Implement load-more pagination for transaction history. The current provider fetches only the first 50 records; the first deployment payment can be older than that. Advance `page`, append by opaque `id`, and stop when a response contains fewer than `pageSize` records. Reset pagination on refresh/account change. Recent activity remains limited to 10.
5. Keep the existing payment category filter compatible: deployment records use `PAYMENT`, not a new enum value. Make the external payment classification visible in the row and detail.
6. Update localization VALUES, retaining keys such as `commonWallet` and `walletCouldNotLoadWallet`. Regenerate localized Dart output using the project's existing localization workflow.

Suggested wording:

| Existing copy | Replacement |
| --- | --- |
| Wallet (navigation/activity) | Transactions |
| Wallet balance | Ledger balance |
| Your wallet | Your ledger |
| Wallet statement | Ledger statement |
| From your wallet | From your ledger balance |
| Add money to wallet | Add funds |
| Wallet AutoPay / wallet recharge | AutoPay / automatic ledger recharge |
| Payment or wallet | Payments or ledger |
| Could not load your wallet | Could not load your ledger |
| Return to wallet | Return to ledger balance |

Audit `packages/evseye_core/l10n/*.arb`, generated localization files, home/deployment/waiting pages, transaction screens, rental payment screens, top-up and AutoPay flows, support, and backend descriptions/error messages rendered directly. Avoid showing raw machine values such as `WALLET_*` to users; map them to ledger wording. No Flutter files were changed in this task.

## Statement scope

Monthly statements remain statements of balance movements. Deployment payments paid externally do not change their opening/closing balances or credits/debits and are not added to the statement's movement rows. They appear in transaction history and transaction details. Do not manufacture a statement debit or deposit credit from the deployment payment total; its charge/deposit allocation already lives in deployment accounting.

## Acceptance checks

- Existing paid deployment appears once in recent activity when recent enough and once in full history, including after loading older pages.
- Deployment detail opens with its opaque prefixed ID; amount is unsigned and clearly external.
- Pending/zero-charge deployments do not appear as completed payments.
- No balance, reward, deposit, or statement total changes when viewing history.
- No cross-rider, cross-client, or cross-currency data appears.
- Regular top-ups, rewards, deductions, reversals, and their receipts still work.
- No user-facing “wallet” or translated equivalent remains, including screen-reader labels and errors.

## Previous backend/web validation

- API and web TypeScript checks passed.
- 17 focused API unit tests and 5 PostgreSQL integration tests passed, including mixed-history pagination, date/type/status filters, deployment detail, tenant/rider isolation, currency isolation, and unchanged balances/financial record counts.
- 25 existing web regression tests passed.
- PostgreSQL tests used a disposable local database. The unused geography column was represented as text in a temporary schema copy because local PostGIS was unavailable; financial schema fields were unchanged. Production records were not accessed or changed.
- Both Flutter working trees remained unchanged.


## Follow-up: agreement security deposits (23 November)

The staff balance endpoint now returns `deposits: AgreementDeposit[]` alongside `wallets`. Rider `GET /rider-app/wallet` and `GET /rider-app/wallet/balance` return `data.agreementDeposits` for the authenticated rider and ledger currency. Existing `securityDeposits` and `securityDepositBucket` remain unchanged: they describe the separate ledger-based deposit system. Do not replace one with the other, add either to spendable balance, or manufacture ledger credits from these records.

Each agreement deposit contains:

```json
{
  "id": "deposit-id",
  "agreementId": "agreement-id",
  "depositType": "RIDER_SECURITY",
  "code": "SECURITY",
  "currency": "INR",
  "status": "PARTIALLY_REFUNDED",
  "requiredAmount": "500.00",
  "paidAmount": "500.00",
  "refundedAmount": "200.00",
  "deductedAmount": "0.00",
  "forfeitedAmount": "0.00",
  "transferredInAmount": "0.00",
  "transferredOutAmount": "0.00",
  "remainingAmount": "300.00",
  "outstandingAmount": "0.00",
  "pendingRefundAmount": "0.00"
}
```

Show a separate Security deposits section even when there is no spendable ledger. Show Paid, Refunded, Deducted, Remaining held, and current status. Show pending refunds, forfeiture, and transfers when nonzero. Keep currency per record and retain closed/refunded deposits for history. `paidAmount` means net unreversed COLLECTION entries, not current `fundedAmount`; refunds reduce funding but must not erase the amount originally paid. Reversed collections/refunds/deductions are excluded from these totals. `remainingAmount` is the authoritative current deposit balance; do not reconstruct it by subtracting only refunds from payments because adjustments and transfers can also apply.

Display mappings: `HELD` → “Paid · Held”; `PARTIALLY_COLLECTED` → “Partially paid”; `REQUIRED` → “Required”; `REFUND_PENDING` → “Refund pending”; `PARTIALLY_REFUNDED` → “Partially refunded”; `REFUNDED` → “Refunded”; `SETTLEMENT_PENDING` → “Settlement pending”; `FORFEITED` → “Forfeited”; `CLOSED` → “Closed”. Do not call a deposit refunded merely because its remaining amount is zero.

## Follow-up: expandable deployment breakdown

`breakdown` is added to deployment history and detail entries. It has `status: AVAILABLE | UNAVAILABLE` and `items: [{ type, label, amount, period? }]`.

- Show Security deposit, Onboarding fee and Rental plan amount beneath the single deployment payment; zero amounts are valid (waived/not collected upfront).
- An optional `OTHER_FEES` line preserves other one-time fees. Rental plan amount includes the recurring plan charges collected upfront, including recurring extras where applicable. Amounts include the taxes/adjustments already incorporated in the accepted pricing.
- Component amounts must not be counted as separate transactions. Their sum equals the payment total. The deposit component reflects the amount collected by this payment, not the deposit's current remaining balance.
- The API selects the accepted snapshot by the payment's saved agreement ID and pricing hash, including historical commercial versions. It does not use current rate cards. When evidence is missing, mismatched, malformed, or does not reconcile, it returns `UNAVAILABLE` with an empty array; show “Breakdown unavailable for this historical payment”. Do not invent a split on-device.

## Follow-up: agreement deposit refunds in history

Posted agreement deposit refunds now appear as separate externally paid history entries:

- `id`: `deposit-refund:<RiderDepositTransaction ID>` (opaque string)
- `transactionNumber`: `EVDR-<ID>`
- `transactionType`: `SECURITY_DEPOSIT_REFUND`
- `referenceType`: `RIDER_DEPOSIT_REFUND`
- `referenceId`: deposit transaction ID
- `depositId`: agreement deposit ID
- `deploymentPaymentIds`: related deployment payment IDs that collected this deposit
- `status`: `POSTED`, or `REVERSED` if the refund entry was reversed
- `affectsBalance: false`, `movements: []`

The existing transaction detail route supports this opaque ID. Override the ordinary deposit-refund-as-ledger-credit presentation for `RIDER_DEPOSIT_REFUND`: show an unsigned externally refunded amount, not a credit to available funds. Do not send this ID to the legacy ledger deposit-return receipt route. Pending refund requests appear only in the deposit summary until a refund is posted. Reversals update the original refund entry's status and summary totals. Monthly balance-movement statements remain unchanged.

## Follow-up: AutoPay rider display

Staff `GET /client/autopay/mandates` and `GET /client/autopay/recharges` add nullable `riderName` and `riderMobile` while retaining `riderId` for API operations. Display `Name (mobile)` in the UI; use “Rider unavailable” if identity is absent. Mandate search supports rider name/mobile, and exports include both fields. Never use the visible name as an identifier for mutations.

## Follow-up acceptance checks

- A paid agreement deposit appears even if the ledger security-deposit bucket is zero; refunded deposits remain visible.
- Partial/full refunds, deductions, transfers, pending refunds and reversals produce correct amounts and labels.
- Deployment components sum to the original payment total and remain unchanged after a refund or rate-card amendment.
- Missing historical evidence yields the explicit unavailable state.
- Refunded amounts do not increase ledger cash or rewards.
- AutoPay rows/search/exports show rider name and mobile instead of using UUID as the visible rider label.
- Flutter code remains unchanged in this backend/web task; implement these additions in the Flutter delivery.

Follow-up validation: API and web TypeScript checks passed; 45 focused API unit tests, 5 PostgreSQL integration tests, and 25 web regression tests passed. PostgreSQL used the disposable test database described above. Neither Flutter working tree was modified. No production data changes or schema migrations are required.

## Rental billing follow-up (2026-11-23)

Backend and web implementation is on `codex/reliable-rental-billing`; deployment requires the new database migration. Flutter source is unchanged.

The existing history endpoints now include finalized rental invoices, including invoices with no collection yet. Identify these entries using `referenceType == 'RENTAL_INVOICE'` or `activityType == 'CHARGE'`. IDs have the opaque form `rent-invoice:<invoiceId>` and work with the existing transaction-detail endpoint when URL-encoded. The existing `RENTAL` type filter includes both rental charges and actual deductions.

Additional fields for a rental charge:

```json
{
  "id": "rent-invoice:<invoiceId>",
  "transactionType": "RENTAL",
  "referenceType": "RENTAL_INVOICE",
  "referenceId": "<invoiceId>",
  "activityType": "CHARGE",
  "affectsBalance": false,
  "movements": [],
  "rental": {
    "invoiceId": "<invoiceId>",
    "status": "PARTIALLY_PAID",
    "currency": "INR",
    "periodStart": "2026-11-22T08:00:00.000Z",
    "periodEnd": "2026-11-23T08:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "frequency": "DAILY",
    "chargedAmount": "100.00",
    "paidAmount": "40.00",
    "outstandingAmount": "60.00",
    "creditAmount": "0.00",
    "settlementCreditAmount": "0.00",
    "lines": [{ "type": "RENTAL", "kind": "CHARGE", "description": "Vehicle rental", "amount": "100.00" }],
    "payments": [{ "id": "<transactionId>", "source": "CASH", "amount": "40.00" }]
  }
}
```

Implementation requirements:

- Show “Rental charge”, the service period, charged amount, paid amount, and remaining due. Use `rental.status`, not the generic history `status`, for payment status: PAID → Paid; PARTIALLY_PAID → Partially paid; FINALIZED → Due; OVERDUE → Overdue; VOID → Voided.
- Keep the charge amount unsigned. Issuing an invoice does not change available funds. A linked actual deduction is a payment of that invoice, not another rental charge. Do not sum invoice rows and deduction rows as total spending.
- Render all invoice line items. A rental invoice can also contain onboarding, penalties, or credits. `kind=CREDIT` reduces the bill; display that explicitly. `chargedAmount` is the net invoice total. Credits already applied must not be subtracted again.
- Payments may include deployment receipts, other external payments, cash, and rewards. A deployment receipt was already shown when paid; its invoice allocation is informational, not a second balance credit. Reversal allocations have negative amounts. `settlementCreditAmount` is separate from money paid.
- Actual ledger deductions retain their existing IDs and `referenceType=RIDER_INVOICE`, with `referenceId` pointing to the invoice. Their `movements` drive the signed balance change. Multiple allocations may share a transaction ID (e.g. cash and rewards); preserve the source as well as ID when rendering details.
- Use the supplied period timestamps and timezone; do not assume midnight or invent daily charges for weekly/monthly plans. End is exclusive. Legacy invoices without a billing-period record use their existing date values with `timezone=UTC` and `frequency=null`.
- Refresh history and balances after funding/repayment and on app resume. Generation and collection are asynchronous; a due invoice may become partially paid or paid shortly afterwards. Bank AutoPay is independent of using existing ledger funds.
- Keep security deposits separate; they are never a source for ordinary rent collection. Preserve the previous deposit status and deployment breakdown UI requirements.
- No new Flutter scheduler, locally calculated rental debit, or client-side financial posting is needed. All billing happens on the backend.

Acceptance: unpaid invoice visible before any deduction; partial/full payment updates the same charge; linked deductions appear once; deployment-funded rent is not collected twice; security deposits remain unchanged; historical pagination and tenant/rider isolation continue working.

Backend rollout and administrator recovery procedures: [rental-billing-runbook.md](rental-billing-runbook.md).
