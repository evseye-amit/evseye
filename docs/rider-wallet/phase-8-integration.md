# Rider wallet Phase 8 integration status

The repository contains a NestJS rider API and Next.js client panel, but no Flutter rider application. This phase adds the following authenticated rider API reads:

- `GET /rider-app/wallet/statements?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=25` returns a live UTC statement for up to 366 days. The default period is the current month to today. Opening and period movements come from posted immutable ledger entries. Cash and rewards are presented together as the spendable ledger balance; security deposit is separate. This is a generated view, not a new balance authority or a frozen official document.
- `GET /rider-app/wallet/receipts/payments/:id` returns a receipt only for the authenticated rider's confirmed payment.
- `GET /rider-app/wallet/receipts/refunds/:id` returns a receipt only for a successful refund owned by the authenticated rider.
- `GET /rider-app/wallet/receipts/deposit-returns/:id` returns a receipt only for a returned deposit request owned by the authenticated rider.

All IDs are scoped to the token's client and rider. The statement masks the rider's mobile and excludes internal clearing accounts. Statement transaction rows are paged and use stable `postedAt DESC, id DESC` ordering. Invalid periods and pagination are rejected.

## Remaining Phase 8 work

This implementation does not yet provide a Flutter wallet UI, PDF generation or secure document storage, an immutable statement snapshot, client rider financial screen, consolidated finance dashboard, notification flows, or production performance/load verification. Existing Phase 7 limitations around bank settlement accounting and external deposit payout remain. The live statement should not be represented as an official archived statement, and its `spendable` figure is a ledger balance rather than invoice-specific spend eligibility after holds and wallet policy.
