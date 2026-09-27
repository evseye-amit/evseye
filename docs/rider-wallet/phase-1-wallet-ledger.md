# Rider wallet foundation

Rider → RiderWallet → WalletAccount → WalletLedgerEntry ← WalletTransaction. WalletHold reserves an account's available balance.

The **ledger is the source of truth**. Rider cash uses a liability convention: credit raises rider balance; debit lowers it. Clearing entries balance external value movement. Posted and reversed transactions contribute to balance because the original and reversing journal entries both remain. Pending, failed, and cancelled transactions do not contribute. No cached balance is stored.

One INR wallet is provisioned per client/rider/currency by an idempotent `ensure` operation; existing riders are provisioned lazily when their rider app wallet is first read. CASH and CLEARING accounts are created. Wallet, account, transaction, entry, and hold rows carry client IDs and composite foreign keys bind rider/account relationships to that client. API requests take the client from authenticated context.

Posting validates positive exact DECIMAL(18,2) amounts, account ownership/status/currency, and balanced debits and credits. One PostgreSQL transaction locks the wallet row, validates current ledger-derived available balance, inserts the transaction and all entries, marks it posted, and writes an audit event. The wallet row lock serializes competing posts and holds. A database trigger rejects ledger updates and deletes. Corrections create reversing journal entries; a partial unique index permits one full reversal per original.

Idempotency keys are unique per client; posting stores a SHA-256 request fingerprint and rejects a repeated key with different parameters. Holds are reservations, not ledger entries. A capture atomically posts a cash debit and clearing credit while closing the hold. Release and expiry close the hold without changing the ledger. Capture currently posts as PAYMENT; future business workflows should choose their own transaction type and server-computed amount.

Rider endpoints: `GET /rider-app/wallet`, `/balance`, `/transactions`, `/transactions/:id`. Admin endpoints under `/wallets` provide provisioning, balance, adjustments, holds, reversal, and ledger inspection. Admin adjustments require CLIENT_ADMIN, an idempotency key, and a reason. Wallet account details and journal entries are not returned to riders except the account balance breakdown in balance responses.

Existing billing `RiderLedgerEntry` is a separate charge/credit journal and is not modified by Phase 1. The wallet has no gateway, invoice, or deposit workflow integration yet. A reliable outbox should be added before financial events drive external side effects. Database-backed concurrency and cross-client integration tests remain necessary before production rollout.
