# Simple fleet onboarding

## Phase 1

`Client.fleetOperatingMode` defaults to `SIMPLE` for existing and new clients
when the migration is applied. This is the current development client's policy.
`ONBOARDING_EVIDENCE` preserves the earlier required-photo activation policy;
it does not imply independent QC approval. Preparation teams and QC are deferred
to later phases.

Client bootstrap exposes `client.fleetOperatingMode`.

The earlier standalone `GET /api/v1/fleets/:id/onboarding-status` route has been removed because no current web or mobile client calls it. The API keeps the onboarding evidence calculation inside fleet activation. The response shape below is internal service data, not a public API contract:

- `operatingMode`: the client's policy.
- `photosRequired`: whether onboarding photos block activation.
- `evidenceComplete`: whether all configured onboarding photo slots are complete.
- `ready`: whether the onboarding photo policy allows activation.
- `items`: existing entity/photo slots, including missing photos, for optional uploads.

`ready` describes the evidence gate, not overall allocation eligibility.

In Simple mode, the onboarding screen offers **Complete later and activate Fleet**
when photos are missing. Existing photos and component assignments are retained.
The fleet detail media upload facilities remain available for later uploads.

`POST /api/v1/fleets/:id/activate` allows missing onboarding photos in Simple mode.
Activation still requires an unallocated fleet in IN_TRANSIT or AVAILABLE status.
It locks the fleet and rechecks its status and unfinished allocations before
marking onboarding ACTIVE and operational status AVAILABLE. Repeated activation
of an already active fleet does not reset its operational status.

The allocation picker continues to require AVAILABLE, ACTIVE onboarding,
allocation enabled, assigned-hub access, and no unfinished allocation. Merely
registering a scooter does not activate it.

## Mandatory transaction evidence

Allocation inspection and submission photo requirements are unchanged. Simple
mode only relaxes onboarding evidence; it never relaxes required INSPECTION photos
or the submission's captured photo requirements. No historical media is deleted
and no fleet is automatically made available by the migration.

## Deployment

Apply `20261018050000_simple_fleet_onboarding` before starting the updated API.
Generate Prisma Client and deploy the API and panel together. No seed rerun or
fleet backfill is needed.
