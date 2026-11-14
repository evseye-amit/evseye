# Wallet AutoPay — operations and release

Implementation defaults: available cash threshold ₹550, fixed recharge ₹750, one unresolved request per wallet, 25-hour notice plus five-minute submission buffer, 24-hour cooldown after success. Client policy and rider consent are separate and default off. This change does not enable any rider/client or deploy infrastructure.

## Client configuration

Client Admin → Online payment operations → AutoPay → Wallet AutoPay.

API: `GET /api/v1/client/wallet-autopay-policy`, then `PUT` with:

```json
{ "enabled": true, "threshold": "550.00", "rechargeAmount": "750.00", "revision": 0 }
```

Use the revision returned by GET, never hardcode it. A missing policy returns revision 0 and disabled defaults. Threshold accepts ₹0.01–₹5,000; recharge accepts ₹500–₹5,000, both with exactly two decimals. Amount changes increment the consent revision and pause new requests until riders accept the new terms. Merely toggling the client switch preserves financial terms. Disabling blocks new submissions while reconciliation continues.

Operations APIs (CLIENT_ADMIN, tenant-scoped):

- `GET /api/v1/client/wallet-autopay-policy/requests?page=1`: 50 requests/page plus `hasMore`.
- `POST /api/v1/client/wallet-autopay-policy/requests/:id/verify`: reconcile existing provider evidence. Does not bypass the worker lease or create another request for an uncertain debit.

`UNKNOWN`/`REVIEW_REQUIRED` block another automatic recharge. Investigate provider order/payment references using the saved merchant credentials. Never delete claims or force a success status to unblock payment. External refunds and multiple captures require review; the system does not silently remove previously credited funds.

## Collection modes

A rider who opts into wallet funding cannot also schedule a new direct rental-invoice AutoPay debit. Wallet-first invoice settlement remains available. Existing submitted invoice collections must resolve before wallet opt-in. Turning off a client wallet policy does not silently switch opted-in riders into direct invoice collection.

Manual Add Money remains available. Scooter return initiation stops new recharge creation. A previously submitted payment is still reconciled and credited on verified capture even if the rider disables wallet funding, returns the scooter, or the rollout flag is disabled.

## Deployment sequence

1. Run API/web typechecks and payment release tests against disposable PostgreSQL databases. Apply the new migration to a staging database before deploying workers; the partial unique index is required for correctness.
2. Verify staging image SHA and existing Razorpay client configuration/credential version, `RAZORPAY_ENABLED`, `RAZORPAY_AUTOPAY_ENABLED`, package `RIDER_AUTO_PAY`, merchant approval for the wallet use case, signed webhooks, worker scheduling and notification delivery.
3. Deploy with wallet client policies disabled. The migration does not opt in existing mandates.
4. Confirm the Flutter team has implemented and tested the handoff document before enabling a rider-facing pilot.
5. Enable one staging client policy, obtain explicit test rider consent, deduct rent, and confirm exactly one ₹750 request. Observe PDN and actual captured-payment settlement over the real bank timing window. No real bank debit is exercised by local simulated-gateway tests.
6. Exercise failure, revoke, manual recharge during pending, return initiation and duplicate webhook delivery. Check ledger sum, request state and notifications.
7. Expand only after the pilot is reconciled. Watch pending age, action-required preferences, provider errors, notification failures and ledger/provider discrepancies.

Rollback: disable new client requests and/or the Razorpay AutoPay rollout flag. Keep the migration, saved merchant versions and reconciliation workers. Do not roll back/delete financial records or stop tracking submitted debits.

## Implementation notes

- `WalletAutoRechargeService` owns eligibility, reservations, recurring transport, recovery and cash settlement.
- `WalletService.locked` invokes registered balance evaluators only after commit. Failed evaluation never rolls back posted rental charges. A durable rental evaluation timestamp plus periodic scan recovers process interruption.
- No provider network call happens inside a wallet database transaction. Provider POST claims are persisted first; an ambiguous response is recovered by receipt/order/payment lookup, never replayed blindly.
- The database partial unique index includes CREATING, PENDING, UNKNOWN and REVIEW_REQUIRED. Ledger idempotency plus wallet locking protects repeated settlement.
- Worker budgets separately process pending requests and historical captures so refund/late capture checks do not consume the entire pending batch.
- Notifications use the existing durable notification pipeline with stable request-based deduplication.
- Flutter code is not maintained in this change. Share `wallet-autopay-flutter-handoff.md` with that team.

## Local validation environment

The payment tests use a disposable local PostgreSQL instance and a simulated Razorpay gateway. Repository migrations, including financial triggers and the new partial unique index, are applied. Local PostgreSQL has no PostGIS: the unrelated Hub location column is represented as text and its spatial sync/index are omitted only in the temporary test setup. The two existing commercial offer/agreement numbering sequences omitted from the consolidated baseline are supplied in that test setup. This does not validate spatial behavior or change repository migrations for those unrelated features.

Ensure the client's existing rental billing setup actually deducts rent from the wallet (`RiderPaymentProfile.autoSettleInvoiceFromWallet` where applicable). Wallet AutoPay funds the wallet; it does not change the rider's ₹261 tariff or automatically rewrite their invoice settlement settings.

Validation on 2026-11-14: API and web TypeScript checks passed; full `test-payment-release.mjs` passed 357 tests across 42 files with no skips, including 19 wallet AutoPay tests; existing payment-operations web tests passed (4/4); new API files passed oxlint and the new admin component passed ESLint. These results use the local environment described above, not a live Razorpay bank debit.
