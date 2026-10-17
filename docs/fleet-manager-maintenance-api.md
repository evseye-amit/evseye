# Fleet Manager maintenance fleets — phase 1

Both routes require a Fleet Manager bearer token. Client identity comes from authentication. Data is restricted to active, nondeleted assigned hubs and nondeleted fleet with `status=MAINTENANCE`.

Hub attribution matches the Home API maintenance count: current hub first, home hub only when current hub is missing. A vehicle at an unassigned current hub is not visible merely because its home hub is assigned.

## List

`GET /api/v1/fleet-manager/maintenance/fleets`

Optional query parameters:

- `hubId`: UUID of an active assigned hub. Omit for all active assigned hubs.
- `search`: up to 100 characters, trimmed; case-insensitive partial matching on vehicle number, fleet code, chassis number and model name.
- `page`: defaults to 1, minimum 1.
- `pageSize`: defaults to 20, maximum 100.

Response shape:

```json
{
  "data": {
    "items": [],
    "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 },
    "summary": { "underMaintenance": 0 },
    "hubs": []
  }
}
```

Each item includes fleet ID/code, vehicle number, chassis number, model/variant/colour, fleet and onboarding status, allocation-enabled flag, odometer, OEM, vehicle category/type, current/home hub, resolved `hub`, `updatedAt`, `lastRecordedMaintenanceChange`, and `latestMechanicReport`.

`lastRecordedMaintenanceChange` is `{ id, reason, createdAt }` from the most recent recorded status transition into maintenance, or null. It is a recorded event, not a guaranteed start date for the current maintenance episode: some existing submission flows update fleet status without writing status history. `updatedAt` is not presented as a maintenance start date either.

`latestMechanicReport` is the most recently created `POSTED` report for that fleet, or null. It includes report ID, BASIC/DEEP stage, mechanic name, summary, safe-for-reuse/check-completion flags, unsafe reason, evidence photo IDs, created/confirmed timestamps, status and submission/inspection IDs. Draft, submitted and cancelled reports are not returned as finalized results. Names and summaries describe recorded reports, not invented service jobs.

`meta.total` reflects search and hub filters. `summary.underMaintenance` reflects the selected hub scope before search. Ordering is `updatedAt DESC, id DESC`. Each vehicle appears once, regardless of the number of mechanic reports. Out-of-range pages return an empty item list with the real total. A manager with no active assigned hub gets an empty result.

## Details

`GET /api/v1/fleet-manager/maintenance/fleets/:fleetId`

```json
{
  "data": {
    "fleet": {},
    "latestMechanicReport": null,
    "statusHistory": [],
    "mechanicReports": [],
    "evidencePhotos": [],
    "historyMeta": {
      "statusHistoryLimit": 100,
      "hasMoreStatusHistory": false,
      "mechanicReportLimit": 50,
      "hasMoreMechanicReports": false
    }
  }
}
```

`fleet` contains the same vehicle fields and recorded maintenance transition as a list item. `statusHistory` contains up to 100 recorded transitions, newest first, with ID, previous/new status, reason and timestamp. `mechanicReports` contains up to 50 finalized reports, newest first. The flags disclose truncated histories.

`evidencePhotos` contains existing, complete inspection-photo references belonging to the returned reports' inspections and the authenticated client. Each reference has ID, entity type/ID, photo type, MIME type and uploaded timestamp. Existing media download routes and their access rules still apply. Unavailable/deleted evidence may remain referenced in the historical report's original `evidencePhotoIds` but does not appear as available in `evidencePhotos`.

Neither route exposes OTP request IDs, bypass reasons, request hashes, charge/payment internals or storage object keys. Reads use a consistent database transaction. No maintenance-job statuses, priority, due dates, assignments, closed-week counts, completion averages or job mutations are introduced in phase 1.

## Errors

- 400: invalid UUID, pagination or query values.
- 401: missing/invalid access token.
- 403: role is not Fleet Manager.
- 404: requested hub is not active/assigned, or fleet is missing, deleted, outside the permitted scope or no longer under maintenance.

## Verification

Run the existing migrations in a disposable database whose name contains `_test_`, then:

```sh
MAINTENANCE_TEST_DATABASE_URL=postgresql://.../evseye_maintenance_test_local \
  ./apps/api/node_modules/.bin/vitest run --root apps/api src/fleet-manager-maintenance
```

Tests cover query validation, role restrictions, pagination/search, cross-client and hub isolation, home-hub fallback, inactive hubs, missing reports/history, finalized report selection, evidence references and sensitive-field exclusion. No production data is needed.
