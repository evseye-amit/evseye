# Vehicle return and exchange submission

All paths are relative to `/api/v1` and require bearer authentication. This
extends the existing return, exchange, inspection, media and rider billing code.
The mobile app sources are maintained outside this repository; these endpoints
and response fields are the integration contract for those apps.

## Rider: choose date, optionally choose a hub

`GET /rider-app/vehicle-submissions/options?latitude=17.4&longitude=78.4`
returns eligible active receiving hubs and `defaultHub`. Coordinates are optional
but must be provided together. The default is the nearest hub by straight-line
distance using rider coordinates, then vehicle telemetry. Without coordinates,
the current receiving hub is preferred, followed by the first eligible hub.
The `selection` field explains which fallback was used.

Create a return using the existing `POST /rider-app/ride-returns` and a stable
`Idempotency-Key` header, with the minimal body:

```json
{"plannedReturnDate":"2026-10-20"}
```

Create an exchange using the existing `POST /rider-app/vehicle-exchanges`:

```json
{"plannedReturnDate":"2026-10-20"}
```

Both accept optional `plannedHubId`, `reasonCode`, `latitude`, and `longitude`.
Return notes use `notes`; exchange notes use the existing `reason` field.
Exchange resolves the rider's single active agreement if `agreementId` is
omitted. Existing exchange policy and commercial eligibility checks still apply.
Dates cannot precede today in India. Existing return idempotency retries remain
valid after the scheduled date. Existing rider list/detail routes include the
linked `vehicleSubmission` once intake begins.

## Fleet Manager: receive and photograph the vehicle

`GET /client/vehicle-submissions/requests?source=RETURN&phase=SCHEDULED&page=1&limit=20`
returns scheduled requests with rider names, fleet details and pagination metadata.
Each item includes `fleet` with `id`, `fleetCode`, `vehicleNumber`,
`chassisNumber`, `modelName`, `variantName`, `colour`, `status`, `oem`
(`id`, `name`), `vehicleType` (`id`, `name`), and `currentHub` (`id`, `code`,
`name`). Return requests resolve the scooter from the original allocation or
existing submission; exchanges show the outgoing scooter. A historical request
without a resolvable scooter returns `fleet: null`. Fleet status and hub reflect
the current fleet record. Use
`source=EXCHANGE` for exchanges. `phase=CHECKS` lists intake/mechanic checks
still in progress; `phase=ALL` includes completed submissions. Fleet Managers see only
their assigned hubs; client admins and operations managers see their client.

Start intake at the planned hub, or pass an actual receiving `hubId`:

- `POST /client/ride-returns/:requestId/submission/start`
- `POST /vehicle-exchanges/:requestId/submission/start`

Body is `{}` or `{"hubId":"<uuid>"}`. Repeating start returns the same intake;
its receiving hub cannot change afterward. Intake begins post-deallocation
inspection and holds the vehicle from allocation.

`GET /client/vehicle-submissions/:id` returns the asset snapshot, inspection ID,
`requiredPhotoTypes`, `missingPhotoTypes`, report history and `nextAction`.
Riders can read their own intake via `GET /rider-app/vehicle-submissions/:id`.

Use the existing media upload sequence:

1. `POST /media/upload-intents` with `entityType: "INSPECTION"`,
   `entityId: "<inspectionId>"`, the exact `photoType` returned by intake,
   `mimeType`, `fileName`, and `sizeBytes`.
2. Upload the file to `uploadUrl`.
3. `POST /media/:photoId/complete` after upload succeeds.

Required types include vehicle front/rear/left/right and `RETURN_CHECKLIST`,
plus a photo for every installed battery/controller and IoT device. Generic
`BATTERY`/`CONTROLLER` photos are required when installed component records are
absent. Client-configured required inspection photos also apply. Use returned
strings directly, including component IDs.

Open evidence in a viewer using the signed URL returned by:

- Staff: `GET /client/vehicle-submissions/:id/photos/:photoId/url`
- Rider: `GET /rider-app/vehicle-submissions/:id/photos/:photoId/url`

These routes check both submission ownership/hub access and photo membership.

## Record the mechanic report and initial penalties

The Fleet Manager records the mechanic's report; no mechanic account is needed.
Create a report using `POST /client/vehicle-submissions/:id/reports` with a
stable, unique `Idempotency-Key` (8–120 letters, digits, colons, underscores or
hyphens):

```json
{
  "stage":"BASIC",
  "mechanicName":"Mechanic name",
  "summary":"Basic inspection findings",
  "safeForReuse":false,
  "unsafeReason":"Panel repair and further checks required",
  "checksComplete":false,
  "evidencePhotoIds":["<inspection-photo-uuid>"],
  "items":[{
    "priceId":"<active-return-penalty-price-uuid>",
    "quantity":1,
    "details":"Cracked panel identified during intake",
    "evidencePhotoIds":["<damage-photo-uuid>"]
  }]
}
```

All intake photos must be complete before a BASIC report. Each report needs
proof, including zero-penalty reports (`items: []`). Every individual penalty
requires details and its own proof references. All proof must be COMPLETE photos
from this exact inspection. A missing-item charge must include the completed
`RETURN_CHECKLIST` photo as proof. Penalty prices come from the existing return
penalty price master; price/category/currency and amounts are frozen in the
report. Reusing the same price plus exact proof set as a previous finding is
rejected to prevent duplicate charges.

Report content is immutable. To correct an unposted BASIC report, call
`POST /client/vehicle-submission-reports/:reportId/cancel` with a required
`{"reason":"..."}` and create a fresh report/key. Only one pending report is
allowed per submission. Posted reports cannot be edited or cancelled.

## Review, impose and confirm

1. Show the rider the report, evidence and total.
2. `POST /client/vehicle-submission-reports/:reportId/impose` freezes the review
   stage as `SUBMITTED`.
3. `POST /client/vehicle-submission-reports/:reportId/otp/request` with
   `{"party":"BOTH"}` sends separate Rider and Team Lead OTPs. Resend may use
   `RIDER` or `TEAM_LEAD`. The response provides masked phones, request IDs and
   per-recipient delivery errors; do not assume both SMS messages succeeded.
4. Fleet Manager enters each OTP using
   `POST /client/vehicle-submission-reports/:reportId/otp/verify`:

   ```json
   {"party":"RIDER","otpRequestId":"<uuid>","code":"123456"}
   ```

   Verify `TEAM_LEAD` separately. The assigned Team Lead must be the single
   active primary lead. OTPs are single use and bound to the exact immutable
   report, party and recipient; expiry, attempt limits and resend cooldown apply.
5. `POST /client/vehicle-submission-reports/:reportId/confirm` with `{}` posts
   the report after both OTPs are verified.

Encourage the normal OTP flow after reviewing findings with the rider. If an
OTP is unavailable, only a Fleet Manager may confirm with a separate nonblank
reason for each bypassed party, for example:

```json
{
  "riderBypassReason":"Rider phone unavailable; explained findings in person",
  "teamLeadBypassReason":"No active primary team lead assigned"
}
```

Either party or both may be bypassed. Reasons, actor, report hash, proof, OTP
references and amounts are retained for audit. Zero-penalty handovers still
require both confirmations or explicit bypasses.

BASIC confirmation atomically completes deallocation, records the physical
receipt and posts any penalty charge exactly once. A return terminates the
agreement and stops rental accrual at confirmation time. An exchange preserves
the active agreement, clears its old current vehicle, and returns to the
existing replacement selection/offer/deposit/handover workflow. The Fleet
Manager intake API does not grant commercial pricing permissions.

## Historical detailed findings

Existing `DEEP` reports remain readable in submission history, penalty and
invoice breakdowns, fleet-manager maintenance views, and audit/evidence records.
They are historical records only: new report creation and editing accept only
`stage: "BASIC"`, and impose, OTP, verification and confirmation reject
historical `DEEP` reports with HTTP 409. Historical report contents, damaged
items, charges, finding IDs and evidence references are not rewritten.

An old uncharged `DEEP` draft or submitted report may still be cancelled. A
charged or posted report remains financial history and must use the existing
financial adjustment process.

Final settlement approval/closure is blocked until all mechanic checks and
the pending BASIC report flow is complete and all submission penalties are
invoiced. Historical DEEP rows do not reopen the removed final-check workflow;
an OPEN rider charge still blocks settlement. Operations use
the existing rider billing invoice finalization flow for charges posted after
the rental cutoff; this does not extend rent or backdate the penalty. The
rental schedule and existing payment, tax, deposit and refund rules continue
to apply.

Historical requests are migrated with `submissionRequired: false` so their
existing receipt/penalty flow remains available. New requests require this
workflow. Starting shared intake for a historical request opts it into the new
workflow. Legacy receipt/deallocation endpoints cannot bypass confirmation for
requests that require shared intake.

## Verification

The PostgreSQL integration test uses a disposable database with all migrations
applied. Set `SUBMISSION_TEST_DATABASE_URL` and run:

```sh
./apps/api/node_modules/.bin/vitest run --root apps/api src/vehicle-submissions/submission.integration.spec.ts
```

It covers return versus exchange state changes, proof requirements, both OTPs,
expiry/exhaustion, delivery failure, bypass permissions, concurrent confirmation,
additional charges, ledger links, report immutability and mechanic vehicle holds.
