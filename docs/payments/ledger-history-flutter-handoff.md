# Flutter handoff: deployment transactions and ledger terminology

Date: 2026-11-22
Status: backend and web implementation in this change; Flutter implementation required. Not yet deployed.

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
  "movements": []
}
```

IDs are opaque strings, not necessarily UUIDs. `referenceId` is a DeploymentPayment ID, not a RiderPayment ID. Do not send it to `/receipts/payments/:id` or to ledger-entry/reversal endpoints. Existing payment-transaction details use source `DEPLOYMENT`; retain that flow for deployment evidence rather than inventing a receipt link.

`affectsBalance` and `movements` are additive history fields. For ordinary transactions, movements contain the signed changes for CASH, REWARD, and SECURITY_DEPOSIT; `affectsBalance` reflects whether any such movement is nonzero. Existing ordinary transaction-detail payloads may omit these fields: parse them as optional. Deployment detail includes both.

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

## Backend/web validation completed

- API and web TypeScript checks passed.
- 17 focused API unit tests and 5 PostgreSQL integration tests passed, including mixed-history pagination, date/type/status filters, deployment detail, tenant/rider isolation, currency isolation, and unchanged balances/financial record counts.
- 25 existing web regression tests passed.
- PostgreSQL tests used a disposable local database. The unused geography column was represented as text in a temporary schema copy because local PostGIS was unavailable; financial schema fields were unchanged. Production records were not accessed or changed.
- Both Flutter working trees remained unchanged.
