# Submission maintenance conditions

## Fleet statuses

`MAINTENANCE`, `BROKEN` (major repair) and `AWAITING_PARTS` all count as under maintenance and cannot be allocated. `AVAILABLE` requests release through the existing readiness rules. No `MECHANICALLY_OK` status is added.

Reports keep the mechanic name, summary, condition, evidence photos, damaged items and charges. Penalty/spare categories and `findingId` links remain unchanged.

## Dropdowns

`GET /api/v1/client/vehicle-submissions/metadata` returns `fleetStatuses` in the standard `data` envelope. Existing staff authorization applies.

## Record or edit a report

Existing routes:
- `POST /api/v1/client/vehicle-submissions/:id/reports` with `Idempotency-Key`.
- `PATCH /api/v1/client/vehicle-submission-reports/:id` with `If-Match` equal to the draft's digest.

Both now require `fleetStatus` in addition to the existing fields. Example, with placeholders for real UUIDs:

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
  "items": []
}
```

- `AVAILABLE` requires `safeForReuse: true` and `checksComplete: true`.
- For every other fleet status, `unsafeReason` is required, including when `safeForReuse` is true. The app sends the mechanic's “What needs work?” note in this field.
- `GET /api/v1/client/vehicle-submissions/:id` returns reports and submission evidence, without maintenance issue data. Rider details remain limited to their own submission.

## Confirmation and deeper findings

Existing impose, OTP/bypass and confirm endpoints remain in use. Drafting or imposing a report does not change the fleet condition. Confirmation changes the fleet condition, records status history/audit, and completes physical submission for a BASIC report.

The report digest includes the condition, evidence and penalty snapshot. Changing report content after imposition invalidates confirmation; finalized reports are immutable. Correct a draft with its current digest, or use a new report for later findings. Earlier reports remain available for history.

The first confirmed report completes mechanic checks even when a non-`AVAILABLE` report has `checksComplete: false`. The submission returns `nextAction: COMPLETE`; there is no repeat `DEEP_MECHANIC_CHECK` or “Record final check” step.

The scooter takes the selected `fleetStatus`. `MAINTENANCE`, `BROKEN` and `AWAITING_PARTS` remain not allocatable.

Simple mode remains configured as before. Preparation/QC modes require renewed preparation/QC before allocation. Existing admin allocation blocks are preserved. Allocation/submission photos, OTP rules, rental closure, exchange, penalty settlement and payment-independent submission continue unchanged.

## Maintenance and fleet reads

- `GET /api/v1/fleet-manager/maintenance/fleets` includes all three maintenance statuses. Optional `fleetStatus` supplements hub/search/pagination. `summary.underMaintenance` remains the unfiltered count in assigned hub scope.
- `GET /api/v1/fleet-manager/maintenance/fleets/:fleetId` includes finalized reports with `fleetStatus`, status history and evidence metadata. Issue fields and issue-only photos are not returned.
- Existing fleet detail does not include `maintenanceIssues`.
- Home live and historical maintenance/parking counts include the two new statuses. Ready-for-deployment and eligible-fleet rules exclude them.

Fleet Manager actions remain restricted to assigned hubs within the client. Existing image URL routes authorize downloads.

## Migration and app integration

Apply the maintenance-condition migrations before running the new API, including `20261020030000_remove_maintenance_issues`. This migration removes issue-only data and recalculates affected historical report digests. It also marks confirmed submissions with a posted BASIC report as having completed mechanic checks, without changing the chosen fleet status or allocation readiness. Pending rider or team-lead OTP requests for affected reports are cancelled because their consent references the old digest; request consent again before confirmation. No seed changes are needed.

The backend migration/API and Flutter update must be released together. The old app still sends `issues`; with `forbidNonWhitelisted`, those reports are rejected. The Flutter app is outside this repository. Its mechanic-report form must keep the condition selector, remove the Issues found card/sheet and stop sending `issues`. It must make “What needs work?” required for non-`AVAILABLE` statuses and display the remaining maintenance response fields.

The existing `PATCH /api/v1/fleets/:id/status` is the Option A “Mark ready for allotment” action. Fleet managers may move `MAINTENANCE`, `BROKEN` and `AWAITING_PARTS` to `AVAILABLE` when the vehicle has no active allocation. Admin allocation blocks remain in force, and Preparation/QC modes still require their readiness flow before allocation. Fleet-manager hub authorization remains unchanged.
