# Rider wallet reward earnings

Client Operations → Rider Management → Riders has an **Earnings** action for Client Admin and Operations Manager users. It opens a read-only dialog without navigating away from, refreshing or resetting the Riders list. The standalone Rider Earnings menu is removed.

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
