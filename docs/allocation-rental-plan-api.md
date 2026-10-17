# Allocation rental plans, security deposits and onboarding fees

All routes below use `/api/v1`, bearer authentication and the authenticated client.

## Flow

1. Fleet manager allocates an eligible scooter using the existing allocation endpoint. This reserves it; it does not begin the rental.
2. Fleet manager lists eligible plans and selects one for that allocation.
3. Rider reads and accepts the presented commercial offer and its terms.
4. Fleet manager requests the server-calculated payment. Rider submits a reference and the manager verifies receipt.
5. Existing PDI, rider acceptance and package-dependent training finish.
6. One transaction activates the allocation, rental agreement and commercial version, and creates the billing schedule at actual handover.
7. Rider can request a return immediately, providing a date and optionally a hub/location.

There is no legacy recovery, inferred agreement creation at return, or data backfill in this change.

## Fleet manager plan APIs

### GET `/mobile-deployments/:allocationId/plans`

Optional query: `batteryPlanId` (UUID).
Only fleet managers assigned to the scooter's current active hub may call this endpoint.
Returns `{ data: { items, batteryPlans } }`.
Each item contains:

- `rateCard`: ID, code, name, version ID and version number.
- `selection`: fields to send to the selection endpoint.
- Rental period, recurring amount and rental breakdown.
- One-time charges, refundable deposit amounts, taxes and total `payableToday`.
- `scooterAgeMonths`, nullable when registration/manufacturing data is incomplete.

Only published, currently effective versions and matching scooter/price rules participate.
Supported billing periods: DAILY, WEEKLY, FORTNIGHTLY, MONTHLY, QUARTERLY and CUSTOM.
Custom allocation plans use DAY/DAYS/WEEK/WEEKS durations totaling at most 366 days.

### POST `/mobile-deployments/:allocationId/commercial-offer`

Required header: `Idempotency-Key` (8–100 ASCII letters, digits, colon, underscore or hyphen).

```json
{
  "rateCardVersionId": "<published-version-uuid>",
  "rentalPeriodType": "DAILY"
}
```

Optional fields: `batteryPlanId`, `promotionCode`; CUSTOM also needs `durationValue` and `durationUnit`.
The server resolves rider, scooter, hub and effective date from the allocation.
Caller-supplied amounts, rider IDs, scooter IDs, hub IDs and pricing dates are rejected.
Returns the linked offer (automatically PRESENTED) and agreement, if already accepted.
Another plan can replace an unaccepted offer before payment; the previous offer is superseded.
An accepted plan cannot be silently replaced. Retries with the same key and selection reuse the offer
before payment starts. After payment starts, use GET to retrieve the selected offer.

### GET `/mobile-deployments/:allocationId/commercial-offer`

Available to the scoped fleet manager and to the allocation's rider.
Returns `{ data: { allocationId, offer, agreement } }`.
No selection returns `offer: null`. Offers include the full rider-facing breakdown and terms.
`GET /mobile-deployments/rider/current` also includes `commercial`; it returns
`screen: PLAN_ACCEPTANCE` while the selected offer awaits rider consent.

## Existing rider acceptance API

POST `/rider-app/commercial-offers/:offerId/accept`:

```json
{
  "consent": true,
  "acceptedTermsVersion": "<termsVersion-from-offer>"
}
```

Acceptance freezes pricing and terms, initializes deposit obligations, links the agreement to
the allocation and leaves the agreement `PENDING_ACTIVATION`.
It does not start billing. A caller-supplied `startDate` is no longer accepted.

## Payment contract change

POST `/mobile-deployments/:allocationId/ask-payment` now takes **`{}`**.
Remove the old `currency` and `items` request fields from app clients.
The selected plan must already be accepted and the fleet request must be complete.

The response is the existing deployment payment, with a generated breakdown containing:
`agreementId`, `pricingHash`, `currency`, `nonRefundableAmount`, `deposits` and `total`.
Previously funded deposits are excluded from the new payment amount.
Explicit zero payable amounts automatically advance to `PAYMENT_PAID` without a fake receipt.

Existing endpoints remain:

- POST `/:allocationId/payment/submit` under `/mobile-deployments`, with `provider` and `providerReference` (maximum 160 characters).
- POST `/:allocationId/payment/verify`, called by the fleet manager after checking receipt.

Verification is atomic and repeatable. It funds the deposit ledger and records the nonrefundable
portion as a confirmed rider payment credit. Initial invoices apply that agreement's credit,
so rental and onboarding amounts are not collected twice. Deposit money remains separate.
Changed deposit balances invalidate an unverified payment quote rather than overcollecting.

## Versioned pricing configuration

Use the existing client-admin rate card/version APIs. Published versions remain immutable.
Effective ranges are `[effectiveFrom, effectiveTo)`; adjacent versions are allowed.
Existing accepted agreements keep their stored version, prices, terms and rule references.

### Scooter security deposit

Add a deposit to a draft version through POST `/rider-rate-cards/versions/:versionId/deposits`:

```json
{
  "code": "SCOOTER_SECURITY",
  "name": "Scooter security deposit",
  "depositType": "VEHICLE_SECURITY",
  "amount": "1500.00"
}
```

Use the existing `/versions/:versionId/adjustments` API for city/hub/age differences:

```json
{
  "code": "HUB_OLDER_SCOOTER_DEPOSIT",
  "adjustmentType": "VEHICLE_AGE",
  "calculationType": "FIXED_AMOUNT",
  "target": "DEPOSIT",
  "targetDepositCode": "SCOOTER_SECURITY",
  "amount": "-200.00",
  "city": "Gurugram",
  "hubId": "<hub-uuid>",
  "minVehicleAgeMonths": 24,
  "priority": 10
}
```

### Onboarding fee

POST `/rider-rate-cards/versions/:versionId/fees` accepts the additional fields
`city`, `hubId`, `minVehicleAgeMonths`, `maxVehicleAgeMonths`, `priority`, `selectionGroup`:

```json
{
  "code": "ONBOARDING_HUB_AGE",
  "name": "Onboarding fee",
  "chargeType": "ONBOARDING_FEE",
  "nature": "ONE_TIME",
  "eligibility": "ONCE_PER_CLIENT_RIDER_RELATIONSHIP",
  "amount": "299.00",
  "city": "Gurugram",
  "hubId": "<hub-uuid>",
  "minVehicleAgeMonths": 12,
  "maxVehicleAgeMonths": 36,
  "priority": 10
}
```

Onboarding alternatives are selected as a single fee group. Specificity ranks hub, city and age
conditions, then priority. Equal matches fail with `PRICING_RULE_CONFLICT`.
Other fee types may use `selectionGroup` for alternative rules while keeping independent fees additive.
New onboarding fees default to ONCE_PER_CLIENT_RIDER_RELATIONSHIP; other fee types retain EVERY_NEW_AGREEMENT.
FIRST_RENTAL_ONLY and explicit EVERY_NEW_AGREEMENT are also supported.
History comes from handed-over agreements, so an unaccepted or cancelled quote does not consume eligibility.

City comes from the allocation hub, not the rider's residential address.
Scooter age uses registration date or a complete manufacturing year/month; missing data stays unknown.
Unknown age does not match age-specific rules. An explicitly configured generic rule may still apply.
Configure `VEHICLE_SECURITY` and `ONBOARDING_FEE` explicitly, including zero amounts when no charge applies.
Missing configuration fails instead of silently becoming zero.

## Exchanges and returns

Replacement allocations retain the accepted exchange agreement and pending amendment.
Existing exchange deposit reconciliation remains required. The mobile payment step is zero for that
handover because exchange completion separately posts its accepted exchange fee/proration; it does not
collect the original security deposit or onboarding fee again or reset the original billing anchor.
Complete the existing exchange workflow after replacement handover to activate the replacement amendment.

POST `/rider-app/ride-returns` continues to take a planned date and optional hub/location.
It resolves the linked rental agreement. Scheduling does not end the allocation or rental.
Physical submission still requires the existing photos, mechanic report and OTP/bypass workflow.
Useful error codes distinguish `ACTIVE_ALLOCATION_REQUIRED`, `RENTAL_PLAN_REQUIRED`,
`RENTAL_AGREEMENT_NOT_ACTIVE` and `ALLOCATION_AGREEMENT_MISMATCH`.

## Deployment and verification

Apply `20261018020000_allocation_commercial_plan` and deploy the API with the new app request flow.
The migration adds allocation links, fee conditions and the required offer/agreement number sequences.
No data backfill is needed or provided. Do not run old app builds that still submit arbitrary payment items.
Billing continues to use the existing client tax profile/rule configuration.

Tests use `DEPLOYMENT_PLAN_TEST_DATABASE_URL`, which must name a migrated disposable `_test_` database.
Run the allocation commercial integration tests and deployment pricing tests to cover selection, concurrency,
fees, deposits, payment credit, atomic rollback, immediate returns and replacement handover.
