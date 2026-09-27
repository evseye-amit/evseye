# Rider rate card: Phase 1

## Existing architecture and reuse

The app uses NestJS, Prisma/PostgreSQL, JWT guards, role guards, `ClientContextService`, and `AuditService`. `Client` owns riders, fleets, hubs, billing charges, invoices, ledger entries, and payment records. `Fleet` is the vehicle entity; it references global OEM, vehicle category, and vehicle type masters and stores model/variant names. Hubs store city/state/country strings. Fleet registration dates are in `FleetRegistration`. Existing billing and payment records remain separate from rate-card configuration. Money is stored as Prisma `Decimal` with PostgreSQL `numeric` columns.

## Gap analysis and implementation

No rider rental rate card or versioned rider pricing masters existed. Phase 1 adds client-owned `RiderRateCard`, `RiderRateCardVersion`, `RateCardRentalRate`, `RateCardFee`, `RateCardDeposit`, `RateCardAdjustment`, `RiderBatteryPlan`, and `VehicleCommercialGradeAssignment`. It does not duplicate Client, Rider, Fleet, Hub, OEM, category, or type. Model and variant remain strings because there are no model or variant master tables. Location dimensions follow the existing string-based hub data.

The migration adds enum types, numeric columns, indexes, foreign keys for rate-card/version ownership, checks for nonnegative charge amounts and valid periods, one active default card per client, and exclusion constraints preventing overlapping active versions or vehicle grades. Draft versions can be edited; published versions cannot. An active version requires at least one rental rate. Deactivation preserves history. The database migration has been generated but has not been applied to a running database in this task.

## API plan and implemented routes

All routes are under `/api/v1/rider-rate-cards`. Reads require a client admin or operations manager; writes require a client admin. The client ID comes from the authenticated identity.

- `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/deactivate`
- `POST /:id/versions`, `POST /versions/:id/activate`, `POST /versions/:id/deactivate`
- `POST /versions/:id/rental-rates|fees|deposits|adjustments`
- `PATCH /versions/:versionId/rental-rates|fees|deposits|adjustments/:id`
- `GET /battery-plans/list`, `POST /battery-plans`, `PATCH /battery-plans/:id`, `POST /battery-plans/:id/deactivate`
- `GET /grades/:fleetId`, `POST /grades`

Commercial writes use the existing audit log. Inputs validate amount scale, periods, adjustment value choice, client ownership of fleet/hub/battery plan, and master references. The development seed is opt-in with `SEED_RATE_CARD_DEMO=1`; it creates a draft Gurugram example for the first active client.

## Boundaries and next phase

Phase 1 only manages configuration. It does not calculate offers, create agreements, collect deposits, bill riders, or change the existing allocation and payment flows. Phase 2 should add deterministic rate resolution and a read-only preview. Before production activation, apply the migration and run database-backed tests of exclusion constraints and concurrent activation. Audit records currently follow writes as separate operations; a future hardening pass should make each write and its audit record atomic.
