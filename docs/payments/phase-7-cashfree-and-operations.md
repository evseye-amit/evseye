# Optional Cashfree merchants and payment operations

Implemented locally on 2026-11-14. Flutter source is unchanged. Deployment and gateway/device acceptance are separate from local implementation.

## Deployment without Cashfree

Cashfree configuration is optional. No merchant rows, credentials, API connectivity checks or activation are required when Cashfree is unused. Constructors do not resolve Cashfree secrets. Existing Razorpay merchants continue to use their own configurations. Missing shared Cashfree credentials do not block startup even if a legacy global selector still says `cashfree`; unconfigured Cashfree capabilities fail closed at request time. Configured client Razorpay routing takes priority. Cashfree subscription creation also checks its return URL before reserving a mandate. Provided callback URLs must use HTTPS in production.

Apply migrations before deploying the API:

1. `20261114020000_payment_automation_jobs` (previous Phase 6 work).
2. `20261114030000_cashfree_merchant_binding`.
3. `20261114040000_payment_operations_evidence`.

These migrations are additive and do not create or activate Cashfree merchants. The read-only `payment:readiness` check recognizes Cashfree as supported and requires the new schema migrations; it does not require any Cashfree merchant to exist.

## Merchant configuration and recovery

Platform Payments settings now offer Razorpay and Cashfree. `PUT /api/v1/platform/clients/:clientId/payment-providers/cashfree` accepts the existing configuration DTO: environment (`TEST` or `PRODUCTION`), client app ID in `keyId`, immutable environment secret reference, optional merchant account ID, status and expected revision. The referenced JSON contains `keySecret` and `webhookSecret`; never send secret values through the admin form. Client merchant selection uses the existing deployment policy environment (`RAZORPAY_ENVIRONMENT`, default `TEST`) for both gateways. Runtime Cashfree sandbox is presented to mobile as `SANDBOX`; a saved production merchant always uses the production Cashfree host. The separate global `CASHFREE_ENVIRONMENT` applies to legacy shared records only.

Disable the existing gateway before activating another in the same environment. Concurrent edits are checked against the saved revision. Historical credentials must remain available after rotation.

New Cashfree checkout requests, mandates and debits retain the merchant version. Refunds resolve the original payment's merchant. Webhook routing reads the untrusted order/subscription/refund reference only to find its saved binding, then verifies the raw-body signature before persisting events or applying effects. Historical records without bindings explicitly use the legacy shared configuration; they are never silently moved to a new client merchant. Cashfree deployment checkout remains unsupported; capabilities advertise supported checkout and AutoPay purposes only.

## Direct settlement ingestion

Client-admin endpoints:

- `GET /api/v1/client/finance/provider-settlements/merchant-versions`: non-secret merchant choices, including retained versions.
- `POST /api/v1/client/finance/provider-settlements/fetch`: `{ provider, configurationVersionId, settlementId, date: "YYYY-MM-DD" }`.

The server verifies tenant/provider ownership, fetches gateway evidence with that merchant version, follows bounded pagination and imports a balanced report. Razorpay fetches the processed settlement and its daily reconciliation rows; Cashfree fetches settlement reconciliation using the settlement ID. Report source and configuration version are retained. Repeated identical imports are idempotent; conflicting reports are rejected.

Payment and refund rows are supported. Transfers, disputes, adjustments, ambiguous refund references, inconsistent totals or exhausted pagination require review instead of a partial import. An ingestion failure creates a durable admin alert. Reports currently retain the existing 500-item import limit. Importing or matching a report never posts rider money or confirms a bank credit.

Gateway references: [Razorpay settlement reconciliation](https://github.com/razorpay/markdown-docs/blob/master/api/settlements/fetch-recon.md), [Cashfree settlement reconciliation](https://www.cashfree.com/docs/api-reference/payments/latest/settlement-reconciliation/settlement-reconciliation).

## Bank confirmation

`POST /api/v1/client/finance/provider-settlements/:id/bank-confirmation` accepts `{ amount, currency, utr, creditedAt, accountLast4, evidenceReference }`.

This is an operator's attestation against bank-statement evidence, not an automated bank-feed integration. Amount and currency must match the settlement; a gateway UTR, when present, must match too. Bank UTRs cannot be reused across settlements within a client. Confirmation is audited and immutable through the API; repeated identical submissions return the original confirmation. Matching status remains separate, so later rematching cannot erase bank confirmation or disguise unmatched financial rows.

## External-refund adoption

For verified Razorpay invoice/penalty/AutoPay payments:

`POST /api/v1/client/riders/:riderId/payments/:paymentId/refunds/adopt-external`

Body: `{ reference: "rfnd_...", reason, treatment: "UNALLOCATED_RETURN" | "PAYMENT_REVERSAL" }`.

The gateway refund must already be processed and belong to the original payment/order/merchant. The amount is fetched from the gateway. The admin must explicitly choose accounting treatment. Existing reservations, available funds and full-reversal constraints still apply. Adoption never submits a gateway refund. It uses the existing idempotent receipt/wallet reversal pipeline, with external origin/reference and an audit record. A gateway receipt linked to an existing internal refund must be recovered using that original request.

Cashfree external-refund adoption and deployment-capture adoption are not exposed by this endpoint; their source-specific accounting needs review. Existing Cashfree refunds created through the application remain supported and use saved merchant credentials.

## Alert routing

Alerts are durable in-app work items routed to the client-admin queue, with optional assignment to an active admin in the same workspace. The worker scans aged refunds, settlement exceptions, unconfirmed bank receipts and failed tenant-scoped webhook events every five minutes under a shared lease. It skips sources already routed, preventing old unresolved records from starving newer alerts.

- `GET /api/v1/client/finance/payment-alerts?page=1` (100 records per page).
- `GET /api/v1/client/finance/payment-alerts/assignees`.
- `POST /api/v1/client/finance/payment-alerts/:id/route`: `{ assigneeId?, acknowledge? }`.

Acknowledgement records ownership, not resolution of the underlying payment issue. Assignments and acknowledgements are audited. No email, Slack, push transport or recipient configuration is required for deployment; this release routes alerts inside web operations.

## Acceptance

Deploy with zero Cashfree merchants and no Cashfree credentials; verify Razorpay capabilities and recovery are unchanged. Then, only when a Cashfree sandbox merchant is available, configure two test clients and validate checkout, mandate/debit, refund and webhook tenant isolation, rotation and retained-credential recovery. Validate direct statement ingestion against real provider reports, bank-evidence review with finance, duplicate refund adoption, and the admin alert queue. Flutter owns Android/iOS payment testing; no live gateway payment/refund or staging migration was performed by this implementation.


## Local verification

The complete payment/deployment release gate passed **338 tests across 41 files with no skips**, using a disposable PostgreSQL database. The separate environment suite passed 15 tests; the web suite passed 24 tests. API/web TypeScript, Prisma schema validation, targeted lint and whitespace checks passed. Both new migrations were applied transactionally to the disposable database. Integration tests cover saved Cashfree merchant rotation and cross-tenant webhook rejection, bank confirmation concurrency/immutability, alert deduplication/tenant assignment, and exactly-once external refund accounting without a refund POST. Gateway requests are simulated; no real merchant refund, bank transfer or deployment was performed.
