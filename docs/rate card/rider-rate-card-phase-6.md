# Rider Rate Card Phase 6 — Rental Billing

## Gap analysis and reuse

The repository already had `RiderPaymentProfile`, `RiderCharge`, `RiderCredit`, `RiderInvoice`, `RiderInvoiceLine`, and append-only `RiderLedgerEntry`. Those remain the billing and commercial subledger entities. `PaymentTransaction` belongs to Cashfree mandate collection and has a one-invoice constraint, so Phase 6 adds `RiderPayment` and `RiderPaymentAllocation` for provider-independent receipts and many-to-many settlement. Rate Card tax fields are pricing inputs, not a GST master. Phase 6 adds `RiderTaxProfile` and effective-dated `RiderTaxRule` with a frozen invoice tax snapshot. Phase 1–5 commercial snapshots, version history, and Phase 5 exchange charges/credits are reused. Security deposits stay in the deposit liability category and never become rental invoice lines automatically.

## Billing period and source of truth

A schedule belongs to one agreement and stores frequency (`DAILY`, `WEEKLY`, `FORTNIGHTLY`, `MONTHLY`, `CUSTOM`), anchor instant, timezone, and `PREPAID` or `POSTPAID`. `CUSTOM` uses `customDays`. Periods are `[periodStart, periodEnd)` in the schedule timezone. The invoice's date-only fields are local calendar dates; the period table retains exact instants. Monthly cycles retain the original anchor day when a short month clamps it. `PREPAID` periods are generated at their start; `POSTPAID` periods become due at their end. The hourly job and the operations endpoint call the same engine.

The schedule frequency must match the frozen agreement rental period. This prevents interpreting a weekly frozen amount as a monthly amount. Custom rental terms currently support day- or week-based durations converted to `customDays`; a custom month duration needs a separate calendar-period definition before it can be scheduled.

The engine resolves all `RiderAgreementCommercialVersion` rows covering the period. It rejects gaps and overlaps. It reads frozen `recurringAmount` and `pricingSnapshot`, never a current Rate Card. Each rental charge and invoice line stores the commercial version, vehicle, pricing hash detail, and service interval. For a mixed period without a Phase 5 realized adjustment, each version amount is prorated by its share of the billing period in milliseconds, with half-up rounding to paise per line. A 4/7 share of ₹1,400 plus a 3/7 share of ₹1,750 gives ₹800 + ₹750. For `START_NEW_NEXT_BILLING_CYCLE`, the previous version's billing terms continue to the new `billingStartAt`.

Phase 5 posts exchange proration as a `RiderCharge` and/or `RiderCredit` at completion. When those rows exist for an exchange, the engine does not create the equivalent replacement rental segment again. An old-period credit causes the old full-period rental to be represented before that credit. Existing exchange fees and other open one-time charges are consumed once. Frozen one-time agreement charges are created only for the schedule's first period using a stable agreement/version/line source key. Refundable deposits are excluded.

## Invoice and tax

A client/financial-year sequence generates `EVS/<client-prefix>/<YYYY-YY>/<six-digit-sequence>` in a serializable transaction. A unique period, invoice, and charge source key, plus a PostgreSQL exclusion constraint on agreement period ranges, prevent double billing across workers. The period, charges, ledger postings, credits, invoice, and schedule advance commit together. A failed transaction leaves none of them behind. Retries after serialization conflicts use the current schedule cursor.

The overlap constraint uses PostgreSQL's `btree_gist` extension; the migration role must be able to install this trusted extension when it is absent.

Tax rules must be configured for every invoiced charge type, including an explicit zero-rate rule when applicable. A rule has tax code, effective range, and CGST/SGST/IGST percentages. The engine treats the frozen commercial charge amount as tax-inclusive, derives the taxable amount with Decimal arithmetic, calculates components, assigns any paise rounding remainder to the final applicable component, and saves the rule and supplier/customer place-of-supply snapshot on each line. `RiderInvoice.subtotal` is pre-tax and `taxAmount` is shown separately, so `totalAmount = subtotal - creditAmount + taxAmount`. Credits are applied to the gross charge total and preserved with a remaining balance. A missing tax rule stops generation instead of silently assuming a rate.

Invoices pass through `DRAFT` inside the generation transaction and are issued as `FINALIZED` (or `PAID` if zero) before commit. The existing database triggers prevent changing issued financial fields or lines; Phase 6 extends the invoice snapshot guard to agreement, period, tax, date, and issuance metadata. Due date is based on rider payment terms. Grace days affect operational overdue status without changing the legal due date. The job marks unpaid invoices `OVERDUE` after grace.

## Payments and balances

Authorized client admins record confirmed generic receipts with a required idempotency key and optional external reference. A payment may be allocated by specific invoice, oldest due first, or oldest invoice first. Serializable transactions prevent two workers from spending the same payment or overpaying an invoice. Excess remains `unallocatedAmount`. Allocations are reversible with a reason and timestamp; the invoice and payment balances are restored without deleting history. SQL triggers protect recorded payment details and allocation amounts.

A charge posts a debit when created and a confirmed payment posts a credit when received. Invoicing and allocation do not post duplicate ledger money entries. The reconciliation endpoint verifies `invoice total = paid + outstanding`, active allocations equal paid, and `payment amount = active allocations + unallocated`. The overview reports outstanding, overdue, available billing credit, unallocated payment, and refundable deposit held separately.

## API

Under `/client/riders/:riderId/billing`: schedules (GET/POST), `schedules/:scheduleId/generate` (POST), `policy` (PUT), `tax-profile` (PUT), `tax-rules` (POST), payments (GET/POST), `payments/:paymentId/allocate` (POST), `allocations/:allocationId/reverse` (POST), and `reconciliation` (GET). Existing invoice, ledger, charge, and credit routes remain. Rider app generic receipt history is `GET /rider-app/billing/payment-receipts` and resolves the authenticated rider. The existing `/rider-app/billing/payments` route remains the Cashfree collection history. Financial writes require client admin role; view routes allow operations manager where appropriate.

## Verification and limits

Phase 6 schema validation, TypeScript, lint, all 279 API unit tests, all 8 API e2e tests, and the SQL migration were run. A disposable PostgreSQL scenario produced one invoice from two concurrent generation attempts, settled it with partial and final payments, retained an overpayment balance, and passed reconciliation. The disposable clone has a pre-existing failed nearest-hub migration record, so the Phase 6 SQL was applied directly there rather than through `prisma migrate deploy`. The normal migration file is included for clean environments.

The current engine refuses billing for suspended periods and does not create a shortened final period across an agreement termination. Those cases need an explicit client suspension/final-period policy before automatic billing. The generic receipt API records money already confirmed by an authorized operator; provider confirmation, refunds, credit/debit notes, and collections workflows remain outside Phase 6.
