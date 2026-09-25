# Rider billing foundation

Phase 1 records client-scoped Rider charges, credits, immutable ledger entries, and finalized invoice snapshots. It does not initiate payments or enable AutoPay. The existing one-time deployment payment remains separate.

## Financial flow

1. A Client Admin posts a charge or credit with a stable `Idempotency-Key` header. Retrying an identical request returns the original posting. Reusing the key for different values returns `409`.
2. Each posting creates one ledger entry and one audit event in the same serializable database transaction. Ledger rows cannot be changed or deleted.
3. Finalizing a billing period collects all still-open charges dated before the period's inclusive end, including older unbilled charges. Available credits are applied oldest first, only up to the charge subtotal. Both charges and applied credits become immutable invoice lines. A fully credited invoice becomes `PAID` with zero payable. A payable invoice becomes `FINALIZED`.
4. Approval of a monetary referral credit posts one `REFERRAL_REWARD` billing credit within the referral transaction. Cash referral rewards continue through their existing payout path.

All monetary API inputs and outputs use decimal strings. Each Rider has one currency in their payment profile; mixed-currency postings are rejected. No tax or payment is calculated in Phase 1.

## Operations API

Requires a Client Admin token for writes; Client Admin and Operations Manager can read. Base URL: `/api/v1/client/riders/:riderId/billing`.

- `GET /` — payment profile and balance summary
- `GET /invoices`, `GET /invoices/:invoiceId` — invoice list and snapshot
- `GET /ledger` — 100 most recent ledger entries
- `POST /charges` — post a charge; requires `Idempotency-Key`
- `POST /credits` — issue a credit; requires `Idempotency-Key`
- `POST /invoices/finalize` — finalize one billing period, idempotent by Rider and dates

Example charge:

```http
POST /api/v1/client/riders/{riderId}/billing/charges
Idempotency-Key: rent-2026-09-rider-123
Content-Type: application/json

{"chargeType":"RENT","description":"September vehicle rent","quantity":"1","unitAmount":"1200.00","currency":"INR","effectiveDate":"2026-09-01"}
```

Example invoice finalization:

```json
{"billingPeriodStart":"2026-09-01","billingPeriodEnd":"2026-09-30","dueDate":"2026-10-05"}
```

The invoice response includes decimal-string `subtotal`, `creditAmount`, `totalAmount`, `outstandingAmount`, and snapshot `lines`.

## Rider App API

Requires a Rider token. Base URL: `/api/v1/rider-app/billing`. The Rider is derived from the token, so no Rider ID is accepted.

- `GET /` — payment profile and balance summary
- `GET /invoices`, `GET /invoices/:invoiceId` — own invoices
- `GET /ledger` — own ledger entries

## Deferred decisions

Phase 2 introduces mandate records and provider abstraction. Payment collection, invoice settlement, retry policy, refund posting, UI, and automatic recurring charge generation are later phases. Their rules and provider identifiers have not been invented here.
