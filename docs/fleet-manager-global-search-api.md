# Fleet Manager global scooter search

All routes use `/api/v1`, a Fleet Manager bearer token and the authenticated
client. This adds read-only visibility across all client hubs, including hubs
not assigned to the manager. Other clients and soft-deleted scooters are excluded.
A manager with no hub assignment can search but cannot manage any scooter.

## Search

`GET /mobile-deployments/fleet-manager/fleets/search?search=DL01&page=1&limit=25`

Optional filters: `hubId` (current hub UUID) and `status` (FleetStatus).
Search is a case-insensitive partial match on vehicle number, fleet code or
chassis number. Omit search to browse. Page starts at 1; limit is 1–100.
Returns `{ data: [...], meta: { page, limit, total } }`, sorted by fleet code/ID.

Each item contains fleet ID/code, vehicle and chassis numbers, model, variant,
colour, fleet/onboarding statuses, allocationEnabled, OEM, vehicle type,
current hub (ID/code/name/city) and:

```json
{
  "access": {
    "canManage": false,
    "reason": "This scooter is outside your active assigned hubs."
  }
}
```

`canManage` describes hub authorization only. Individual actions also have their
existing status, payment, inspection and other business requirements. It is not
an authorization token: the server rechecks access on mutations. Hubs must be
active, non-deleted, and assigned to the manager. A scooter with no current hub
is read-only. Home hub alone does not grant management access.

## Details

`GET /mobile-deployments/fleet-manager/fleets/:fleetId`

Returns `{ data: ... }` with the same fields plus:

- `frontPhoto`: signed URL, photo ID and expiry, or null. Uses completed FRONT
  evidence from the latest pre-allocation inspection, falling back to completed
  FRONT fleet evidence. Refresh the response after expiry.
- `allocation`: current nonterminal allocation ID/status/date and minimal rider
  identity (ID, rider code, name), or null. No rider phone, address or KYC data.
- `submission`: latest submission ID/status, confirmation/checks state, hub ID
  and return/exchange reference IDs, or null. No private mechanic reports or
  penalty evidence is exposed through global search.

Foreign-client, deleted and unknown fleet IDs return 404. The general media
APIs retain their existing read permissions; global details deliver only the
selected scooter image rather than widening arbitrary photo access.

## Action enforcement

The app should hide/disable actions when `access.canManage` is false. The new
APIs have no mutation routes and grant no additional permissions. Existing
allocation/plan/Team Lead routes remain scoped. Fleet edits/status changes,
component mappings (including bulk and component source scooters), inspection
completion and scooter/inspection photo upload/completion now check assigned-hub
permissions at the HTTP boundary. Forbidden mutations return 403 with code
`FLEET_HUB_ACCESS_REQUIRED`. Moving a scooter to an unassigned hub is forbidden.
Client Admin and Operations Manager permissions remain unchanged.

Return/submission mutations also check the scooter’s current hub, in addition
to existing receiving/submission hub checks. Selecting an assigned receiving hub
cannot bypass the scooter’s current-hub restriction. Exchange management routes
remain restricted to their existing roles. Active-hub checks apply throughout.
No schema change or data migration is required.
