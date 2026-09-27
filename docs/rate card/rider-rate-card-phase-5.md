# Rider Rate Card Phase 5: vehicle exchange

## Flow

1. A rider or operator requests an exchange against an active agreement with an active allocation. The client exchange policy must permit it and its minimum days requirement must be met.
2. Operations approves the request, then uses the existing deallocation process. Its completed return inspection and both deallocation OTPs are required before selecting a replacement. Damage deductions must be recorded through the deposit service before pricing the exchange.
   Once return is confirmed, the agreement's current vehicle pointer is empty, freeing the old vehicle for another agreement. The old commercial version remains in history until the new handover becomes effective.
3. Operations selects an available replacement. The Phase 2 pricing engine calculates its commercial snapshot. A client scoped reservation blocks other allocations. The immutable exchange offer captures the new snapshot, fee, proration, deposit difference, terms, hash, and expiry.
4. Acceptance verifies the exact offer and creates an amendment, pending commercial version, and the replacement vehicle deposit obligations. The original agreement snapshot remains unchanged. Rider security is carried over rather than duplicated.
5. Deposit reconciliation transfers actual available vehicle deposits after the old return, creates excess refund requests, and waits for any additional deposit collection. The new allocation then follows existing inspection and OTP activation. Completion makes the new commercial version effective at its allocation time and writes the prorated charge and fee to the rider charge ledger.

## Policy

`POST /vehicle-exchanges/policy` configures whether exchanges are allowed, minimum vehicle tenure, proration mode and policy, deposit excess handling, exchange fee and waiver reason codes, offer validity, and reservation duration. The default is disabled. Policy writes require client admin.

## Endpoints

Operations: `GET/POST /vehicle-exchanges`, `GET /vehicle-exchanges/:id`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/return`, `POST /:id/confirm-return`, `POST /:id/replacement`, `GET /:id/preview`, `POST /:id/offer`, `POST /:id/accept`, `POST /:id/reject-offer`, `POST /:id/reconcile-deposits`, `POST /:id/handover`, `POST /:id/complete`, `POST /:id/cancel`. Historical versions: `GET /vehicle-exchanges/agreements/:agreementId/versions`.

Rider scoped: `GET/POST /rider-app/vehicle-exchanges`, `GET /rider-app/vehicle-exchanges/:id`, `POST /:id/accept`, `POST /:id/reject-offer`, `POST /:id/cancel`, and `GET /rider-app/vehicle-exchanges/agreements/:agreementId/versions`.

Operations assisted acceptance requires `riderConsentReference` and `assistedReason` alongside the exact `offerId`, `offerHash`, and `consent: true`. The accepted method and proof are stored on the offer.

## Financial handling and limits

- The old deposit's actual available balance, after deductions and pending refunds, is the transfer source. `RIDER_SECURITY` is preserved as the same obligation. A depleted rider security balance must be replenished through the Phase 4 collection endpoint before handover. An exchange whose rate card changes the rider security requirement is rejected with `RIDER_SECURITY_CHANGE_REQUIRES_SEPARATE_AMENDMENT`.
- A requested excess refund is a liability workflow item; it is never marked paid by this exchange flow. Staff must complete it with an external payout reference in the Phase 4 refund workflow.
- Old rental credit is offered only when a paid invoice contains an agreement or amendment linked rental charge covering the exchange period. Payment is checked again at completion. An agreement or unrelated paid invoice alone never creates a credit. Proration charges and verified credits are posted only on completed handover.
- The accepted offer freezes proration mode, policy, fee and deposit treatment. Completion recalculates proration at the actual handover time and rejects a changed amount with `EXCHANGE_PRORATION_STALE`. A post-acceptance repricing or compensation workflow is not yet implemented, so this condition needs manual resolution. `START_NEW_NEXT_BILLING_CYCLE` records a separate billing start time.
- The exchange cannot be cancelled after the old vehicle has been returned or financial fulfillment has begun without an explicit compensating workflow. Such requests fail with `EXCHANGE_CANCELLATION_REQUIRES_COMPENSATION`.
- Accepted exchange offers and commercial version price fields are protected by database immutability triggers. Version 1 is backfilled for existing agreements by the Phase 5 migration.

## Verification

Prisma validation and TypeScript type checking pass. The focused rate card, deposit, allocation, and exchange tests pass (59 tests). Existing API end to end tests pass (8 tests). The Phase 5 migration was applied successfully to a disposable PostgreSQL database reconstructed from the Phase 4 schema; its version 1 backfill was checked. A full unit suite run had one unrelated Cashfree integration timeout under concurrent load; that test passed when rerun alone.
