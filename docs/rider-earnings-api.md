# Rider wallet reward earnings

Client Operations → Rider Management → Riders has a **Wallet** action for Client Admin and Operations Manager users. It opens a read-only dialog with **Balance**, **Transactions** and **Reward Earnings** tabs, without navigating away from, refreshing or resetting the Riders list. Each tab retains its filters while switching tabs. The standalone Rider Earnings menu is removed.

## API

`GET /api/v1/riders/:riderId/earnings`

Requires authentication and `CLIENT_ADMIN` or `OPERATIONS_MANAGER`. The client comes from the authenticated context. Other-client, deleted and missing riders return 404. No wallet is created by this endpoint.

Query parameters:

- `page`: 1-based, default 1, maximum 1,000,000.
- `pageSize`: default 10, maximum 100.
- `from`, `to`: optional valid `YYYY-MM-DD` dates. UTC boundaries; both dates are inclusive. `from` must not follow `to`.
- `type`: optional `REWARD`, `REFERRAL_REWARD` or `SELF_SUBMISSION_REWARD`.

The standard `data` envelope contains `rider` (ID, name, mobile), `summary`, `items` and `meta` (page, pageSize, total).

Each summary entry contains `currency`, `allTimeAmount` and `periodAmount`. All-time totals include all reward types; period totals follow the selected dates and type. Amounts are decimal strings with two decimal places. Currencies are never added together. Wallets without earnings return zero totals in their currencies; a rider with no wallet returns empty summary and history arrays.

History items contain ID, transaction number, reward type, description, currency, amount, reference type/ID and posted date. Order is posted date descending, then ID descending. Out-of-range pages return no items and retain the correct total.

Only positive `POSTED` transactions of the three reward types with a credit to the wallet's reward account are included. Pending, failed, cancelled and reversed rewards are excluded, as are top-ups, refunds, deposits, payments, penalties and adjustments. Previously earned rewards remain earnings after spending/expiry; these totals are not available or withdrawable wallet balances. Work-partner delivery income is not included.

No schema migration or seed changes are required.

## Combined wallet dialog APIs

`GET /api/v1/riders/:riderId/wallet` returns rider identity and every existing wallet with its currency, status and the existing WalletService balance calculation: total, held, available, cash, rewards and the separate security-deposit bucket. It never creates a wallet. Cash plus rewards form the total; security deposit is separate. Available amounts reflect holds and the configured minimum balance.

`GET /api/v1/riders/:riderId/wallet/transactions` returns all transaction types and statuses with server pagination, optional `type`, `status`, `from` and `to` filters. Pagination and date validation follow the earnings API. Transaction dates filter `createdAt` (inclusive UTC calendar dates), so pending/failed transactions with no posted date remain visible. Results sort by creation time descending, then ID descending. Each item includes transaction amount/currency, type/status, description, references, creation/posted timestamps and signed cash/reward/deposit ledger movements. Movements are included only for posted or reversed records; clearing accounts are omitted. A reversed original and its reversal remain separate history rows. The balance service accounts for both; reward earnings exclude reversed rewards.

Both wallet APIs require Client Admin or Operations Manager, use authenticated client scope, and reject missing, deleted or other-client riders with 404. No financial rows, balances or audits are written by these APIs. Currencies remain separate. Wallet and transaction responses also expose supported transaction types/statuses for filter choices. The existing `/riders/:riderId/earnings` API remains the source for the Reward Earnings tab.
