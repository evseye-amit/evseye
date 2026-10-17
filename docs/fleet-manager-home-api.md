# Fleet Manager Home API

`GET /api/v1/fleet-manager/home?hubId=<UUID>`

Requires the existing bearer access token and `FLEET_MANAGER` role. Client scope comes from authentication. The optional hub must be active, not deleted, and assigned to the manager in that client. Without `hubId`, select the primary active assigned hub, otherwise the first by hub ID. `availableHubs` supports a hub selector.

Unknown/unassigned/cross-client hubs return 404 without revealing another client's hub details. Invalid UUIDs return 400. Missing authentication returns 401; other roles return 403.

## Response

All values are wrapped in the normal `{ "data": ... }` envelope. Example (IDs abbreviated for readability):

```json
{
  "data": {
    "state": "READY",
    "generatedAt": "2026-10-18T06:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "date": "2026-10-18",
    "manager": {
      "id": "manager-id",
      "name": "Fleet Manager",
      "attendance": {
        "status": "PRESENT",
        "periodId": "attendance-period-id",
        "checkInAt": "2026-10-18T03:00:00.000Z"
      }
    },
    "availableHubs": [
      { "id": "hub-id", "code": "HUB-GGN-SEC-15", "name": "Gurugram Sector 15 Hub", "isPrimary": true }
    ],
    "hub": {
      "id": "hub-id",
      "code": "HUB-GGN-SEC-15",
      "name": "Gurugram Sector 15 Hub",
      "address": {
        "line1": "62, HOPE Apartments", "line2": "4th Floor", "landmark": null,
        "city": "Gurugram", "district": null, "state": "Haryana",
        "postalCode": "122001", "country": "India",
        "formatted": "62, HOPE Apartments, 4th Floor, Gurugram, Haryana, 122001"
      },
      "location": { "latitude": 28.45, "longitude": 77.03 },
      "parking": { "occupiedSlots": 4, "capacity": 200, "occupancySource": "RECORDED_VEHICLE_STATUS" }
    },
    "summary": {
      "fleetUtilisation": { "percentage": 80, "allocated": 16, "total": 20 },
      "onShift": { "present": 1, "total": 5, "role": "FLEET_MANAGER" },
      "riders": { "present": 12, "active": 18 },
      "pendingAllocation": 2,
      "pendingSubmission": 1,
      "readyForDeployment": 3,
      "underMaintenance": 1
    },
    "yesterday": {
      "date": "2026-10-17",
      "asOfExclusive": "2026-10-17T18:30:00.000Z",
      "status": "AVAILABLE",
      "reason": null,
      "historyAvailableFrom": "2026-10-17T06:00:00.000Z",
      "counts": {
        "pendingAllocation": 3,
        "pendingSubmission": 2,
        "readyForDeployment": 4,
        "underMaintenance": 1
      }
    }
  }
}
```

The app renders the four cards from `yesterday.counts`, using these titles:

- Pending Allocation
- Pending Submission
- Ready for Deployment
- Under Maintenance

`summary` always contains live values. Do not use it as a fallback for yesterday. Greetings and translated labels can be rendered by the app; the API returns names and semantic keys. No uptime, free bays, service bays or open-job fields are returned.

If the manager has no active assigned hub, `state` is `HUB_NOT_ASSIGNED`, a useful `message` is included, and `hub`, `summary`, and `yesterday` are null. Manager attendance remains available.

## Metric definitions

### Hub and rider attribution

A fleet's home hub is `homeHubId`, falling back to `currentHubId` only when no home hub exists. Fleet utilisation uses this stable attribution. Available stock and recorded parking use `currentHubId`.

An active, nondeleted rider belongs to their primary `UserHub`, otherwise their first assigned hub by ID. If no explicit user/hub assignment exists, use the home hub (falling back to current hub) of their most recently created allocation's fleet. Linked users must be active and not deleted. For the MVP, riders with neither association form a shared queue within their client. Every Fleet Manager with an active assigned hub can see these riders in Pending Allocation and review their documents. The pending-allocation card includes this shared queue at each selected hub; counts across hubs are not additive. Active-rider and attendance totals still require a hub association. Once a fleet allocation establishes a hub association, the rider is visible only in that hub scope.

The existing `GET /api/v1/mobile-deployments/fleet-manager/pending-riders` now uses the same attribution. Pass `?hubId=<UUID>` for the selected home hub, or omit it for eligible riders across all of the manager's active assigned hubs. Its response shape is unchanged.

### Pending Allocation

Active riders attributed to this hub without an allocation in `INITIATED`, `INSPECTION_PENDING`, `OTP_PENDING`, `ACTIVE`, or `DEALLOCATION_INITIATED` status. Uses the same eligibility statuses as the existing allocation workflow.

### Pending Submission

Return/exchange requests with submission required and a scheduled date before the query's cutoff (now for live, today's IST midnight for yesterday). Excludes cancelled/rejected/expired requests. Future scheduled requests are not due yet. Scope uses the actual submission hub when present, otherwise the planned hub.

Count requests without a submission unless terminal (`COMPLETED`, `RETURNED`, `TERMINATED`), plus submissions not yet `CONFIRMED` or with mechanic checks incomplete. Return/exchange records linked to the same allocation count once. Confirmed submissions with completed mechanic checks do not count again because of later penalty reports.

### Ready for Deployment

Nondeleted vehicles physically recorded at this hub, with `status=AVAILABLE`, `onboardingStatus=ACTIVE`, allocation enabled, and no allocation in an in-progress/active status. There is no IoT requirement.

### Under Maintenance

Nondeleted vehicles with `status=MAINTENANCE`, attributed to current hub, falling back to home hub if current hub is missing.

### Fleet utilisation

Distinct active-onboarding, nondeleted fleet attributed to the hub with an `ACTIVE` or `DEALLOCATION_INITIATED` allocation, divided by total active-onboarding, nondeleted fleet attributed to the hub. Count each vehicle once. Return percentage rounded to two decimal places, or null when the denominator is zero.

### Attendance

Manager presence and on-shift fleet managers use attendance periods covering `generatedAt`, including overnight check-ins. `onShift.total` counts active, nondeleted Fleet Managers assigned to this hub. `riders.present` counts attributed active riders whose linked user has a current attendance period. Multiple periods do not multiply a person.

Continue using the existing `/api/v1/attendance/check-in` and `/api/v1/attendance/check-out` endpoints. An absent manager has null `periodId` and `checkInAt`.

### Parking

Recorded stock at current hub in `AVAILABLE`, `RESERVED`, `ALLOCATION_IN_PROGRESS`, `INSPECTION_PENDING`, `MAINTENANCE`, or `OUT_OF_SERVICE` status. Deployed and in-transit vehicles are excluded. This is inventory-based occupancy, not sensor detection. Capacity uses `parkingSlots`, falling back to `vehicleCapacity`; unknown capacity remains null. Do not clamp overcapacity counts.

## Yesterday history

Yesterday is the state immediately before today's midnight in `Asia/Kolkata`, not the number of events during yesterday. All reads for one response use a repeatable-read PostgreSQL transaction.

The additive migration captures a baseline and installs transactional history triggers on the eight relevant tables. Only fields required by these metrics are retained (IDs, assignments, statuses, dates and eligibility flags); names, phone numbers, credentials, documents and report contents are not copied. Relevant inserts/updates/deletes are recorded atomically with business writes. Irrelevant updates do not add revisions. It does not depend on a midnight job or the API being online at midnight.

`FleetManagerHomeHistoryCoverage.availableFrom` marks when baseline capture completed. The API does not reconstruct dates before that marker. On initial deployment, yesterday returns:

```json
{
  "date": "2026-10-16",
  "asOfExclusive": "2026-10-16T18:30:00.000Z",
  "status": "UNAVAILABLE",
  "reason": "HISTORY_NOT_AVAILABLE_FOR_DATE",
  "historyAvailableFrom": "2026-10-17T06:00:00.000Z",
  "counts": null
}
```

Show an unavailable state rather than zero counts. Once the next IST midnight has passed, recorded revisions support yesterday. Historical attribution uses historical assignments and statuses; changing a hub assignment today does not rewrite yesterday's counts. Deleted rows retain tombstones. History is retained; any future retention policy must preserve a baseline and adjust coverage accordingly.

Migration baseline capture briefly locks writes to the tracked tables; reads remain available. Test on a copy before applying to large production datasets. No seed data or fabricated historic summaries are inserted.

## Verification

Run the history migration in an isolated database whose name contains `_test_`, then:

```sh
HOME_TEST_DATABASE_URL=postgresql://.../evseye_home_test_local \
  ./apps/api/node_modules/.bin/vitest run --root apps/api \
  src/fleet-manager-home/home.spec.ts \
  src/fleet-manager-home/home.integration.spec.ts \
  src/allocations/mobile-deployment.service.spec.ts \
  src/allocations/mobile-deployment.controller.spec.ts
```

PostgreSQL tests cover historical state after updates/deletes, rollback, irrelevant updates, coverage, hub isolation, default selection, rider attribution, overnight attendance, deduplicated submission work, and fleet/parking definitions. Tests never backfill production history.
