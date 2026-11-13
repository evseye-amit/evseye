# Current follow-up

[Phase 7 and operations](phase-7-cashfree-and-operations.md) adds optional Cashfree merchants, direct statement ingestion, bank-evidence confirmation, Razorpay external-refund adoption and in-app alert routing. It supersedes the earlier pending-work lists below.

# Web payment operations checkpoint

## Phase 6 refund and settlement recovery — 2026-11-14

This section supersedes the earlier support-only Razorpay refund and snapshot-only settlement limits below.

- Version-bound Razorpay invoice, penalty and AutoPay payments now support the existing admin refund request flow. Top-ups remain non-refundable; legacy payments without a reliable merchant version remain review-only. Requests preserve reservation, amount and treatment checks. Full PAYMENT_REVERSAL reopens financial allocations; UNALLOCATED_RETURN only returns available unapplied funds.
- New normal refunds use the original client merchant version, payment/order identity and the local refund UUID as both receipt and `X-Refund-Idempotency`. The client receipt remains `providerRefundId`; the actual Razorpay refund ID is stored as `providerReference` and used by settlement matching. See [Razorpay's idempotent refund API](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md).
- Provider payment/order, original amount/currency, refund payment/receipt and refund amount must match before accounting. Unrecorded external refunds block new submissions for review. A timeout is UNKNOWN, retaining its reservation. Recovery looks up the existing receipt (up to 10,000 provider refunds) and never creates a replacement if not observed. Recovery after a crash before submission therefore needs operator investigation rather than an automatic new refund.
- Signed Razorpay refund events route through the existing durable, merchant-scoped inbox. Unknown/external refunds remain review cases; they are not silently assigned an accounting treatment. SUCCESS is monotonic under concurrent pending observations. Successful Razorpay refunds reverse rider ledger/invoice allocations and provider-clearing wallet entries together, once.
- Collection payment detail adds `refundedAmount`. Fully returned collections expose REFUNDED; outstanding local refund requests expose REFUND_PENDING; a completed partial return retains the original successful collection state with its returned amount. Flutter owns rendering and device acceptance.
- `POST /client/finance/provider-settlements/:id/rematch` rechecks imported report items against current internal evidence, with tenant checks, a transaction lock, duplicate detection and change audit. It never creates receipts, moves funds or certifies bank receipt. A five-minute worker retries REQUIRES_REVIEW reports automatically; unresolved/ambiguous evidence remains open.
- Refund recovery also runs every five minutes. New refund/settlement workers use database leases with heartbeat, token-guarded completion, exponential backoff capped at one hour and bounded batches. This is at-least-once processing; financial idempotency remains required after crashes/lease loss. Existing charge/deployment workers are not migrated to this lease mechanism by this change. Refunds pending over 24 hours emit `PAYMENT_REFUND_AGED`; log delivery alone is not an alert subscription.

Deployment requires migration `20261114020000_payment_automation_jobs` before starting this API revision. It creates the job lease table and the refund-number sequence missing from the consolidated baseline, initializing above existing refund numbers. Retain historical credential references. No staging/production migration or live refund was performed during implementation.

Remaining boundaries: provider-native settlement API ingestion, independent bank confirmation, automatic adoption of externally initiated refunds are not included. Pre-existing hourly collection and minute-based Razorpay recovery workers now use shared database leases; deploy the automation migration first. Imported normalized reports are the input to automated rematching. Merchant sandbox refund/webhook tests and operational alert routing remain release acceptance tasks.

Phase 6 validation: **312 payment/deployment tests passed across 37 files, no skips**, with all database suites enabled against disposable PostgreSQL. The final focused inbox test also passed duplicate and wrong-client refund event checks. All 24 web tests, API/web TypeScript, Prisma schema validation, targeted lint and whitespace checks passed. The migration was tested in an isolated transaction/schema, including initialization above an existing refund number. Test gateways were simulated; these results do not certify live gateway refund behavior. The disposable database was stopped after validation.


## Phase 5 configuration and operations — 2026-11-14

Platform administrators can select TEST/PRODUCTION, edit the Razorpay key, versioned secret reference, merchant account ID and status, review the intended change, and confirm saving. TEST is the default. Existing merchant IDs are preserved when editing. The editor shows the latest 100 retained versions for the selected environment, with current/historical labels; no secret values or credential fingerprints are returned. Reload explicitly discards local edits. Configuration resolution remains distinct from live gateway connectivity.

The web editor sends `expectedRevision` using the loaded `updatedAt` value, or `NEW` for a first configuration. The backend checks it while holding the client row lock and returns 409 `PAYMENT_CONFIGURATION_CHANGED` for stale edits before any write. Existing API callers may omit this optional field for compatibility. After a conflict or uncertain response, reload and review the saved state. Credential changes retain the existing immutable-version and audit behavior; changing credentials requires a new secret reference. Disabling affects new payments, not saved-version recovery.

Client payment operations support combined gateway, state and reference/rider filters, including rider names/codes and gateway references within deployment captures. Filters apply to the displayed history batch; full-history export applies these top-level filters across every batch. Table-local sort/search controls affect only the displayed table and do not change export filters. Existing provider recovery, supported refunds, mandate visibility and settlement import/detail remain available.

This phase does not add client-specific Cashfree configuration, unsupported Razorpay refunds, settlement rematching or distributed worker coordination. These remain later-phase work. Flutter owns final mobile sandbox/device acceptance.

Validation for this increment: 11 configuration tests (including stale edit/first-create conflict rejection), 23 web tests, API/web TypeScript and changed-web lint passed. Backend lint reported only existing warnings outside the changed lines; diff whitespace checks passed. No new browser smoke test or staging configuration mutation was performed for this increment. The earlier 287-test database run predates these changes and is not presented as a rerun.

Available locally under Payment Transactions → Online payment operations for CLIENT_ADMIN. All API operations derive the client from authenticated context; the UI does not accept a client override. Flutter is unaffected.

## Included

- Payments/refunds: source, gateway, rider reference, state and amount; provider checks for checkout, AutoPay and owned deployment attempts; refund verification; deployment capture/refund references and reasons.
- Cashfree refund request form with reason, amount and accounting treatment. The backend enforces confirmed-payment status, reservation limits and accounting rules. Pending requests retain the exact body/key in session storage, scoped to authenticated client/user/payment. Storage must succeed before submission; an uncertain response locks the request for identical retry. Closing/reopening the dialog restores it in the same tab/session. If browser storage is lost, inspect existing refund records before requesting another refund.
- Refund recovery uses the saved provider. Cashfree webhooks use Cashfree verification even when the global checkout default changes. Unsupported Razorpay general refunds remain support-only; deployment refunds continue through the existing deployment capture workflow.
- AutoPay mandate list. Debits are visible in payment reconciliation; this checkpoint does not provide administrative mandate cancellation or a dunning-management screen.
- Normalized settlement report import for CASHFREE and RAZORPAY, with report/detail and exception display. Server validates totals, references, duplicate entries, status, amount and currency. Razorpay matching includes collection payments, AutoPay gateway payment IDs, deployment captures and deployment refunds. Ambiguous matches stay in review.
- Razorpay configuration shows current version and local resolution, explicitly not gateway connectivity certification. Configuration forms still support Razorpay only.

## Normalized settlement import

POST /api/v1/client/finance/provider-settlements/imports accepts the JSON file below. The UI previews its provider/reference/item count/net before submission. This format is normalized application input, not an unmodified provider dashboard export. Convert gateway export fields deliberately before import.

```json
{
  "provider": "RAZORPAY",
  "providerSettlementId": "setl_example",
  "currency": "INR",
  "grossAmount": "500.00",
  "refundAmount": "0.00",
  "feeAmount": "10.00",
  "taxAmount": "1.80",
  "netAmount": "488.20",
  "settledAt": "2026-11-13T00:00:00.000Z",
  "items": [{ "kind": "PAYMENT", "providerReference": "pay_example", "amount": "500.00" }]
}
```

provider may be omitted for legacy Cashfree imports. Existing Cashfree canonical hashes are preserved. Identical report replay returns the existing report; changed contents with the same client/provider/settlement ID return SETTLEMENT_IMPORT_CONFLICT. Items are PAYMENT or REFUND; amounts use INR decimal strings. For Razorpay, use actual gateway payment/refund IDs, not local debit IDs or order IDs. Report matching never creates payment receipts or credits a bank account.

Review results include MISSING_INTERNAL, STATUS_MISMATCH, AMOUNT_MISMATCH, CURRENCY_MISMATCH, AMBIGUOUS_INTERNAL and DUPLICATE_PROVIDER_RECORD. Reports are snapshots: this checkpoint does not rematch an existing report after a local status changes. REPORT_MATCHED means internal records match the imported report, not that a bank receipt was independently verified.

## Limits and remaining work

History navigation and CSV export are implemented for reconciliation, settlement reports and mandates. Each batch contains up to 200 records per reconciliation source or settlement report list, and 100 mandates. Reconciliation includes rider-friendly names/codes. Provider-native file parsing, direct settlement API ingestion, rematching/exception resolution and bank confirmation remain Phase 6/later work. There is no new live gateway refund capability for Razorpay invoice, penalty or AutoPay payments. Distributed worker leases, coordinated backoff and aging alerts also remain pending.

Tests: payment contract/policy/recovery unit suites; provider settlement/refund/operations tests; PostgreSQL import concurrency and tenant isolation; web action/idempotency tests. Browser smoke checks use mocked API responses and verify panel navigation, provider recovery and identical refund retries after 503. They do not establish live provider readiness.

## Phase 5 history and export follow-up

The web panel has previous/next history batches for payments, settlements and AutoPay mandates. Each database query uses a timestamp plus ID ordering and stays scoped to the authenticated client. A lookahead row supplies `hasMore`; it is not returned as data. Unallocated receipts are now bounded too. Rider labels are resolved in a client-scoped batch lookup.

API: `GET /client/payment-reconciliation?page=N` returns `{data:{items,page,hasMore,reviewRequired}}`; the review count describes the current batch. Settlement list and mandate list accept optional `page=N` and return `{items,page,hasMore}` (mandates inside `data`); omitting `page` retains their legacy array response. Page numbers are positive decimal integers up to 999999. Reconciliation pages advance every source independently, not a single global chronological feed.

Full-history CSV export walks pages sequentially, includes progress/cancellation, applies the payment panel's gateway/state/reference filters, deduplicates by source/ID, and downloads only after all requests succeed. Exports quote embedded commas/newlines/quotes and neutralize spreadsheet formula prefixes. They contain operational data and rider labels, not gateway credentials. The download remains local to the browser.

These are live operational lists, not transactionally frozen audit snapshots: concurrent inserts, deletes or state changes can move offset boundaries or change membership during traversal. Refresh from batch 1 and repeat exports if activity changes materially; deduplication prevents repeated IDs but does not make an export point-in-time complete. No bank receipt certification is implied.

Validation: PostgreSQL tests cover crossing the 200-record boundary, rider labels, tenant isolation and settlement import/accounting; unit tests cover lookahead boundaries, invalid pages, legacy list compatibility and CSV escaping/formula neutralization. Flutter source is unchanged; final mobile acceptance remains owned by its team.

Follow-up results: 17 targeted backend unit tests, 2 PostgreSQL integration tests and all 24 web tests passed. API/web TypeScript and targeted lint passed; diff checks passed. The first integration attempt used the wrong local PostgreSQL port; restarting the disposable cluster on its intended port resolved the environment failure. The cluster was stopped afterward. Staging admin/browser acceptance is still required after deployment; no new live staging mutations were performed.
