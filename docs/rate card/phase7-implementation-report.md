# Phase 7 implementation report

## Existing components reused

Phase 6 `RiderInvoice`, `RiderPayment`, allocation, and reconciliation logic; Phase 4 `RiderDepositService`; existing `PaymentProvider`, `PaymentMandate`, `PaymentTransaction`, `PaymentAttempt`, signed provider event store, Cashfree subscription adapter, and mock adapter.

## Data and migration

Added `PaymentCollectionRequest`, `PaymentCollectionPolicy`, and `PaymentRefund`. Modified `PaymentTransaction` to allow an invoice collection history, link its confirmed Phase 6 receipt, and retain normalized failure classification. Modified `PaymentAttempt` to belong to exactly one AutoPay transaction or checkout request. Modified `PaymentProviderEvent` to link checkout events. Linked deposit collections to their Phase 4 deposit transaction.

Migration: `20260927040000_payment_orchestration_phase7`. Unique indexes protect idempotency keys, provider IDs, full refunds, active invoice checkout, active outstanding checkout, active deposit checkout, and active AutoPay invoice collection. Checks protect positive amounts, policy bounds, and the attempt owner rule. It also aligns Phase 6 receipt foreign keys with client-scoped rider ownership.

## Payment flow

The provider-neutral contract now supports one-time checkout orders, payment verification, checkout refunds, and Cashfree PG webhooks alongside subscription mandates and charges. Cashfree-specific order and refund fields stay inside its adapter. Rider invoice, outstanding-balance, and deposit checkouts snapshot server-calculated amounts. Signed webhooks are deduplicated by raw payload hash and use a server-side provider fetch. Verified invoice success creates exactly one Phase 6 receipt, ledger credit, and current-balance allocation in one serializable transaction. A late success retains overpayment as unallocated cash. Verified deposit success posts through the Phase 4 deposit engine. A changed deposit balance leaves a reviewable unallocated receipt.

Mandates now permit UPI AutoPay or eNACH according to package settings, and rider cancellation calls the provider. The hourly job schedules eligible AutoPay invoices from a disabled-by-default client policy; it checks outstanding, category, rider preference, active collection, mandate, and debit cap. It re-reads the invoice before dispatch. Configured retry intervals apply only to explicitly retryable failures; unknown and nonretryable outcomes require verification or manual payment. The same job polls open collections and refunds and retries failed linked webhook reconciliations. A client admin report identifies unallocated cash, amount mismatches, local settlement gaps, and failed webhook events; a platform super admin can inspect unmatched signed event metadata.

Provider refunds support a full confirmed receipt. The admin request is idempotent; provider success is fetched and amount/currency verified before a reversing ledger entry, allocation reversal, and invoice reopening are committed. Original payment and allocation records remain. Normal security-deposit refunds remain in Phase 4.

## Interfaces and controls

Rider endpoints: Pay Invoice, Pay Outstanding, Pay Deposit, verify checkout, collection history, payment home, safe receipt history, attempt status, refund history, and AutoPay status/create/cancel. Client admin endpoints: policy, reconciliation, reconciliation retry, full payment refund request/status. All rider reads derive the rider from the authenticated user. Admin mutations scope payment and rider by client. Idempotency keys are required for financial requests. Cashfree PG webhook URL and signing secret are required when Cashfree is enabled. Production callback URLs require HTTPS.

Audit entries cover policy changes, collection creation/confirmation, provider receipt settlement, deposit collection, refund request, and refund settlement. Invalid signed webhooks are rejected before event persistence. Unknown orders are retained as unmatched event metadata for platform review.

## Verification performed

- API unit suite: **294 passed across 68 files**.
- API end-to-end suite: **8 passed** with local socket access.
- TypeScript typecheck: **passed**.
- API build: **passed**.
- Lint: **passed**; warnings remain only in unrelated existing modules.
- Phase 7 SQL migration: **applied successfully** to a disposable PostgreSQL clone of the Phase 6 schema.
- Prisma schema diff after migration: **no Phase 7 drift**. Remaining diff concerns existing Phase 6 billing schedule keys, nearest-hub spatial columns/usage, and one preexisting index name.
- Active checkout uniqueness: **verified** with duplicate in-flight rows in the disposable database.
- Cashfree adapter and webhook checks use mocked HTTP responses and HMACs. **No live Cashfree sandbox transaction was performed.**

## Limits requiring follow-up

Cashfree subscription debit scheduling is date-based; policy can retain a custom India time but cannot guarantee the provider's execution hour. Refund initiation supports full receipts; partial refunds, a second request after a definitive failed refund, and unsolicited provider reversals require manual reconciliation. Unknown orders without a client association are available only to platform super admins. Production rollout needs the new migration and Cashfree PG webhook configuration. No live-provider settlement or refund was verified here.
