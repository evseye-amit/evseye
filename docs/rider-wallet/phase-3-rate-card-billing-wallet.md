# Rider wallet Phase 3: rate card, invoices, settlement

```text
Frozen RiderAgreementCommercialVersion / Rate Card snapshot
          │
          ├── recurring rental → existing RiderBillingEngine → RiderInvoice
          └── one-time onboarding / deposit → WalletBillingService → RiderInvoice
                                                        │
                                              wallet funding planner
                                                        │
                                 WalletTransaction + immutable journal entries
                                                        │
                                          WalletInvoiceAllocation
```

## Pricing and invoice history

The wallet never calculates a price. Rental pricing continues through the existing billing schedule, commercial segment, proration, tax, charge, and invoice engine. Rental invoices now copy the frozen commercial snapshots and pricing hashes. The one-time generator reads version 1 of an accepted rental agreement, verifies its currency/version, and snapshots the onboarding and deposit lines. Existing `RiderInvoice`, `RiderInvoiceLine`, `RiderCharge`, `RiderPaymentProfile`, and invoice sequence are reused. No second billing account or invoice table is introduced. A database trigger blocks edits to issued invoice pricing fields and line changes. A partial unique index protects rental periods; a client-scoped source key protects one-time invoice retries. Invoice numbers use the existing financial-year sequence.

The admin one-time generation operation creates distinct ONBOARDING and SECURITY_DEPOSIT invoices. Onboarding creates a normal RiderCharge and billing journal debit. Deposit creates a wallet-linked requirement and an invoice line without classifying deposit as rental revenue. The old agreement deposit workflow still exists. The new generator rejects agreements with already funded legacy or wallet deposits because those historical payments need reconciliation before a second obligation can be safely created. Generation is explicit; it is not attached to agreement acceptance. The recurring engine skips onboarding lines already billed separately.

## Wallet settlement

Settlement takes the authenticated client, locks the rider wallet, then locks the invoice. It reads current wallet availability and the current wallet policy. The Phase 2 funding planner chooses eligible REWARD and CASH amounts; SECURITY_DEPOSIT is excluded from ordinary charges. Rental/onboarding settlement posts one balanced wallet transaction (reward/cash debits and clearing credit), creates immutable source allocations, and updates invoice paid/outstanding/status inside the same PostgreSQL transaction. No external payment record is fabricated. A retry with the same key returns the existing invoice effect. A different key can settle remaining outstanding value only.

For a deposit invoice, only cash is eligible. Each deposit line receives a balanced cash debit and deposit credit, and its requirement status advances from PENDING to PARTIALLY_PAID or PAID. Phase 2 trusted deposit funding (deposit credit against clearing debit) now allocates to a linked deposit invoice in the same transaction. Locking a deposit remains a separate explicit step. Reversing a wallet invoice transaction creates opposite journal entries and immutable REVERSAL allocations, then restores the invoice's outstanding amount. Generic wallet reversal rejects invoice-linked transactions so invoice accounting cannot be bypassed.

A client admin may void an unpaid one-time invoice with a reason. Onboarding voiding adds a billing-ledger reversal and marks its charge VOIDED. Deposit voiding cancels only unfunded requirements. Issued invoice lines and pricing remain as historical evidence.

## Lifecycle, due dates, and APIs

`RiderPaymentProfile` supplies payment terms, grace days, and the optional `autoSettleInvoiceFromWallet` flag (default false). Recurring and one-time generation attempt wallet settlement after issue when enabled. The existing billing job marks overdue invoices after their due date and grace period. No penalties are triggered. Existing rider billing APIs list and show the new invoices, including their wallet allocations. Client admins use `POST /wallets/billing/agreements/:agreementId/one-time-invoices`, `POST /wallets/billing/invoices/:invoiceId/settle`, `POST /wallets/billing/settlements/:transactionId/reverse`, `POST /wallets/billing/invoices/:invoiceId/void`, and `GET /wallets/billing/invoices/:invoiceId/allocations`. Settlement and reversal require an Idempotency-Key header.

## Extension boundary

The remaining invoice outstanding amount is available for a later external payment order. Existing external payment services remain unchanged. Automated one-time generation is deferred until the old agreement deposit collection workflow is reconciled with wallet deposit invoices. Issued-invoice adjustments and replacement after void are not yet exposed by this new wallet path; existing RiderCredit and billing processes remain available. A database-backed migration, isolation, and concurrent-settlement run is required before rollout.
