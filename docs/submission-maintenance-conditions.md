# Submission maintenance conditions

## Fleet statuses and issues

`MAINTENANCE`, `BROKEN` (major repair) and `AWAITING_PARTS` all count as under maintenance and cannot be allocated. `AVAILABLE` requests release through the existing readiness rules. No `MECHANICALLY_OK` status is added.

Issue categories: `POWERTRAIN` (motor, controller, drivetrain), `BATTERY` (pack, BMS, battery connectors), `ELECTRICAL` (wiring, lights, charger, charging port), `BRAKES`, `TYRES_WHEELS`, `SUSPENSION_STEERING`, `BODY_CHASSIS`, `ACCESSORIES`, `OTHER`. Every issue needs an explanation and inspection evidence, including `OTHER`.

Issue progress is `OPEN`, `IN_PROGRESS`, or `RESOLVED`. This is independent of report stage, fleet status and any maintenance job status. An issue never automatically creates a charge.

## Dropdowns

`GET /api/v1/client/vehicle-submissions/metadata` returns `fleetStatuses`, `issueCategories` and `issueStatuses` in the standard `data` envelope. Existing staff authorization applies.

## Record or edit a report

Existing routes:
- `POST /api/v1/client/vehicle-submissions/:id/reports` with `Idempotency-Key`.
- `PATCH /api/v1/client/vehicle-submission-reports/:id` with `If-Match` equal to the draft's digest.

Both now require `fleetStatus` and `issues` in addition to the existing fields. Example, with placeholders for real UUIDs:

```json
{
  "stage": "BASIC",
  "mechanicName": "Mechanic name",
  "summary": "Motor failed; replacement required",
  "safeForReuse": false,
  "unsafeReason": "Scooter cannot run",
  "checksComplete": true,
  "fleetStatus": "BROKEN",
  "evidencePhotoIds": ["<completed inspection photo UUID>"],
  "issues": [{
    "category": "POWERTRAIN",
    "description": "Motor failure",
    "status": "OPEN",
    "requiredParts": "Replacement motor assembly",
    "evidencePhotoIds": ["<completed inspection photo UUID>"]
  }],
  "items": []
}
```

- New issues omit `issueId`. The server assigns stable IDs for retries.
- To update an existing issue, include its returned `issueId`. It must belong to this submission, client and fleet. Draft issue IDs are also accepted when editing that same draft.
- `requiredParts` is a text description of required spares, up to 1,000 characters. `AWAITING_PARTS` requires it on at least one unresolved issue.
- Optional `penaltyFindingId` links an issue to an item with the matching `findingId` in the report's existing penalty `items` array, or retains a link already confirmed for that issue. Subsequent repair reports preserve the existing link without charging it again. Charges still follow spare pricing and evidence configuration.
- Up to 50 issues; up to 20 evidence photos per issue. Evidence must be completed photos from this submission's inspection.
- `MAINTENANCE`/`BROKEN` require at least one described issue. `AVAILABLE` requires `safeForReuse: true`, `checksComplete: true` and all included issues resolved; `issues: []` is allowed for a fault-free scooter.
- `GET /api/v1/client/vehicle-submissions/:id` returns reports and confirmed live `maintenanceIssues` for that submission. Rider details remain limited to their own submission.

## Confirmation and deeper findings

Existing impose, OTP/bypass and confirm endpoints remain in use. Drafting or imposing a report does not apply the condition or update live issues. Confirmation atomically applies issues, changes the fleet condition, records status history/audit, and completes physical submission for a BASIC report.

The report digest includes condition and issues. Changing either after imposition invalidates confirmation; finalized reports are immutable. Correct a draft with its current digest, or use a new DEEP report for later findings or repair progress. DEEP reports remain available after checks are complete, but cannot change a scooter that has another unfinished allocation.

Example repair update: create a DEEP report containing the existing `issueId`, status `RESOLVED`, repair description and proof; select `AVAILABLE` only when all outstanding fleet issues are resolved. Unmentioned unresolved issues remain open and block release. A failed confirmation rolls back issue changes.

A maintenance hold keeps `mechanicChecksComplete` false on the overall submission until release, even if an individual report has `checksComplete: true`. This preserves existing submission work queues and readiness holds.

Simple mode remains configured as before. Preparation/QC modes require renewed preparation/QC before allocation. Existing admin allocation blocks are preserved. Allocation/submission photos, OTP rules, rental closure, exchange, penalty settlement and payment-independent submission continue unchanged.

## Maintenance and fleet reads

- `GET /api/v1/fleet-manager/maintenance/fleets` includes all three maintenance statuses. Optional `fleetStatus` and `issueCategory` filters supplement hub/search/pagination. Category filtering matches unresolved issues. `summary.underMaintenance` remains the unfiltered count in assigned hub scope.
- `GET /api/v1/fleet-manager/maintenance/fleets/:fleetId` includes live `maintenanceIssues`, finalized reports with `fleetStatus`/`issues`, status history and evidence metadata.
- Existing fleet detail includes `maintenanceIssues`.
- Home live and historical maintenance/parking counts include the two new statuses. Ready-for-deployment and eligible-fleet rules exclude them.

Fleet Manager actions remain restricted to assigned hubs within the client. Existing image URL routes authorize downloads.

## Migration and app integration

Apply `20261019030000_submission_maintenance_conditions` before running the new API. No seed changes or history backfill are needed. Existing maintenance records stay valid without invented categories. Existing reports retain their original digest and nullable condition.

The Flutter app is outside this repository. Its mechanic-report form must add the condition selector, issue editor and the two required payload fields; it must display the new maintenance response fields and filters. Existing callers that omit the new report fields receive validation errors.
