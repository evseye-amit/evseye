# Rider rate card: Phase 2 pricing preview

## Reused Phase 1 and platform structures

The engine uses client-owned `RiderRateCard`, `RiderRateCardVersion`, `RateCardRentalRate`, `RateCardFee`, `RateCardDeposit`, `RateCardAdjustment`, `RiderBatteryPlan`, and `VehicleCommercialGradeAssignment`. Existing `Client`, `Rider`, `Fleet`, `Hub`, registration, authentication, role guards, and client context supply the subject and ownership checks. Fleet model/variant and Hub location are existing strings. Money uses Prisma Decimal; no JavaScript number arithmetic is used for prices.

## Schema additions and migration

Migration `20260926233000_rider_pricing_preview` adds configurable percentage basis (`BASE_AMOUNT` or `CURRENT_AMOUNT`), exclusive/stackable selection, rental or named-deposit adjustment target, country scope, rental tax settings, fee eligibility, deposit waiver fields, first-rental-upfront setting, and client-owned promotions. Defaults preserve Phase 1 behavior. PostgreSQL checks enforce tax ranges, deposit waiver bounds, valid promotion values/periods, and adjustment targets. The migration file has been generated and Prisma validation passes; it has not been applied to a database in this task.

## Resolution and calculation

The API first verifies the authenticated client, rider, fleet, hub, and battery plan. The rider endpoint also requires an active or initiated allocation to that rider. Vehicle age uses registration date, falling back to manufacturing year/month, and counts completed calendar months. A missing date means age rules do not match. Commercial grade uses the effective manual assignment; ambiguity fails.

All active rate cards in the client are considered. Cards are ranked by card priority, matching base-rate specificity, then default flag. Equal top scores fail. One active version must match the effective date, using half-open periods `[effectiveFrom, effectiveTo)`. Within that version, base rates rank by individual fleet, variant, model, OEM, type, and category; equal top matches fail. Custom periods also match duration value and unit.

Adjustment order is vehicle, age, grade, location, hub, battery plan, other, client subsidy, discount, then promotion. Exclusive rules choose the highest specificity and priority; tied matches fail. Explicitly stackable rules apply in priority/code order. Location specificity is hub, zone, city, state, country. Percentages use the configured base or current running amount. Subsidies, discounts, and promotions cannot lower rental below zero; configured discount caps are honored. Money rounds half up to two decimals at charge-line boundaries. Configured taxes can be inclusive or exclusive. Refundable deposits remain separate from recurring and one-time charges. Deposit rules apply to a named deposit and preserve the original amount, adjustment breakdown, waiver, and final requirement.

Preview performs reconciliation before returning the result and writes no agreement, invoice, ledger, deposit, allocation, payment, or promotion usage record. Every response carries a calculation ID, version, base rate, rule IDs/codes, line amounts, tax, totals, and calculation order. Structured logs contain identifiers and amounts without KYC/payment details.

## APIs

- `POST /api/v1/rider-rate-cards/preview`: detailed client-operations preview; requires `CLIENT_ADMIN` or `OPERATIONS_MANAGER`.
- `POST /api/v1/rider-app/commercial-offer/preview`: rider-safe preview; requires `RIDER`, derives rider ID from the signed-in user, and limits the vehicle to that rider's allocation.
- Client-admin promotion endpoints: `GET /api/v1/rider-rate-cards/promotions/list`, `POST /api/v1/rider-rate-cards/promotions`, and `POST /api/v1/rider-rate-cards/promotions/:id/deactivate`.

Preview input contains `riderId` (operations only), `vehicleId`, optional `hubId`, `rentalPeriodType`, optional custom duration fields, optional `batteryPlanId`, optional `effectiveDate`, and optional `promotionCode`. Client ID is never accepted from the request body.

## Explicit limits for later phases

Fee eligibility modes needing agreement history fail with `FEE_ELIGIBILITY_HISTORY_UNAVAILABLE`; manual fees are skipped. Promotions with usage limits fail with `PROMOTION_USAGE_HISTORY_UNAVAILABLE` because Phase 2 has no accepted-offer usage ledger. No rider commercial tier, automatic grade inference, agreement, financial obligation, or payment flow is introduced. Database-backed migration and concurrency tests remain to be run against a PostgreSQL instance before deployment.
