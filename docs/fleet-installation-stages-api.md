# Fleet installation stages — Phase 3

## Modes and rollout

`STAGED_PREPARATION_QC` adds hub-scoped installation stages before the existing RFD/QC flow. `SIMPLE`, `ONBOARDING_EVIDENCE` and `PREPARATION_QC` retain their behavior. The migration does not switch any client mode or copy/delete existing evidence. Allocation and submission INSPECTION photos remain mandatory under their existing policies; installation/preparation photos cannot satisfy them.

Configure installation stages and grant staff permissions before enabling the mode. The current client must remain `SIMPLE`. Use an isolated client/database to exercise staged mode.

## Configuration

Use the existing `/api/v1/client/fleet-readiness/policy` GET/PUT routes. GET includes `installationStageTemplates`: intake followed by parallel battery/controller confirmation, with IoT excluded. PUT retains `expectedVersion`, mandatory `reason`, `operatingMode`, and `configuration` containing the existing RFD policy plus `stages`.

Each stage has:

- `code`: unique uppercase code (40 characters maximum); `name`.
- `component`: `NONE`, `BATTERY`, `CONTROLLER` or `IOT`.
- `dependencies`: other stage codes. Unknown dependencies, cycles and duplicate definitions are rejected.
- `hubIds` and `vehicleTypeIds`: empty arrays mean all; prerequisites must cover all hub/type combinations used by dependent stages.
- `verificationRequired`: an independent reviewer must approve the submitted stage.
- `items`: checklist entries `{code,label,required,allowNA}`; failure blocks submission, and NA requires both permission and a reason.
- `photoTypes`: required photo codes. Hardware stages generate a slot for each installed component, such as `<batteryId>_LABEL`; use `requiredPhotoTypes` from stage detail, not hardcoded slot names.

Policy updates apply to new cycles. Existing cycles retain frozen stage definitions. Preview accepts optional `configuration` and returns proposed stage dependencies and the mode-change impact. Active handovers/submissions/open preparation cycles prevent switching modes. Stages only apply to the configured hubs/types; a cycle with no applicable stages is rejected.

## Staff

Extend existing `PUT /fleet-readiness/staff/:userId` hub assignments with:

```json
{
  "assignments": [{
    "hubId": "<uuid>",
    "canPrepare": false,
    "canReview": false,
    "stageCodes": ["BATTERY"],
    "reviewStageCodes": []
  }]
}
```

These capabilities can be assigned to the existing supported operations roles, including RFD/QC staff. Installation-only users do not need RFD preparation permission. A role alone grants no installation write access. Staff can have multiple capabilities; independent stage review still prohibits contributors reviewing their own work. Client Admin controls permissions and policy. Operations Managers can assign work and cancel cycles but need an explicit capability to perform/review a stage.

## Lifecycle and handoffs

Start with `POST /fleets/:fleetId/preparations` as permitted RFD or installation staff. Creation is idempotent and starts the complete readiness cycle. The response is the existing preparation id; list installation stages to find its work items.

Stages progress `WAITING -> READY -> IN_PROGRESS -> SUBMITTED -> COMPLETED`, with `SUBMITTED` used only for stages requiring verification. Without verification, submission completes the stage. Dependencies unlock automatically. Rejection requires a reason and valid failed checklist codes, produces `REWORK_REQUIRED`, and explicit rework starts a new revision with fresh checklist/photos. Immutable submitted evidence and decisions remain in append-only history.

Once all applicable stages are completed, the assigned RFD employee completes the existing preparation checklist/photos and submits to final independent QC. Managers use the existing preparation assignment API to hand RFD ownership to the appropriate staff member. Installation completion alone never makes a scooter AVAILABLE. The final database guard and allocation guard also enforce staged mode.

## Installation APIs

All routes below start `/api/v1/client/fleet-installations`; existing response envelope `{data:...}`, authentication and client scoping apply.

- `GET /`: paginated queue, with `page` (1), `limit` (20, max 100), `hubId`, `stage`, `status`, `assignedToId`, `search`. Search matches scooter code, registration or chassis. Response includes `items,total,page,limit,summary`. Summary respects the other filters but spans statuses.
- `GET /:id`: frozen definition, current revision/checklist, timeline, installed hardware, available inventory choices, photos/required slots, assignees, permissions and recent cycle events.
- `GET /:id/inventory`: available or already-installed hardware for this stage; accepts `search,page,limit` and returns labelled choices plus totals. Other scooters’ installed hardware is excluded.
- `POST /:id/claim`: `{revision}`. Claims an unassigned stage for the caller; competing staff cannot steal a claim.
- `POST /:id/assign`: `{revision,userId}`. Management only, target must have the stage capability in the same active hub.
- `POST /:id/save`: `{revision,checklist:{CODE:{result:"PASS",notes:""}}}`.
- `POST /:id/components`: `{revision,batteryIds:[...]}` or `{revision,controllerId}` or `{revision,iotDeviceId}` matching the stage hardware kind. Existing hardware may be confirmed without reinstalling it. Installed hardware belonging to another scooter is rejected. Locks, active-installation unique indexes and one transaction protect installation history/status updates.
- `POST /:id/submit`: `{revision}`. Validates components, checks and all evidence. Same-submitter retries are idempotent.
- `POST /:id/approve`: `{revision}`. Explicit stage-review grant required.
- `POST /:id/reject`: `{revision,reason,failedItems:["CODE"]}`. Explicit reviewer grant and independent review required.
- `POST /:id/rework`: `{revision}`. Assigned staff only; returns the new revision.
- `POST /:id/upload-intents`: `{revision,photoType,mimeType,sizeBytes}`. JPEG/PNG/WebP, maximum 5 MiB; PUT bytes to returned uploadUrl.
- `POST /:id/photos/:photoId/complete`: `{revision}`. Seals/validates storage bytes before completion. Replaying an old PUT cannot change sealed evidence.
- `GET /:id/photos/:photoId/download-url`: scoped signed viewer/download URL, including previous submitted revisions.

For cancellation use existing `POST /api/v1/client/fleet-preparations/:preparationId/cancel` with the **preparation's** `currentRevision` and mandatory reason. Required stages cannot be skipped by cancelling an individual work item. The installation board exposes cancellation of the entire cycle.

After a component change, re-fetch detail: the stage revision and/or RFD revision can advance. Reload after a 409 before retrying.

## Invalidation

During installation, component changes/identity edits reset stages of that hardware kind and their transitive dependents. Unrelated stages retain completed work. Fresh photos are required for the new revision, and any existing draft RFD evidence starts a new revision. Installing hardware and resetting dependent stages happen atomically.

After RFD submission or QC approval, a component change invalidates the preparation cycle. Hub transfers, maintenance and scooter receipt/return also invalidate readiness; a new cycle starts with fresh required confirmations/evidence. Already installed components can be confirmed rather than physically reinstalled. Final QC remains independent of installation and RFD contributors. Existing administrative, maintenance, mechanic, payment, Team Lead and handover gates continue to apply.

## Panel

Vehicle Management adds **Installation Board** alongside Vehicle Preparation, Quality Check and Fleet Readiness Settings. It provides stage/status/hub/search filters, pagination, start/claim/assignment, component confirmation, checklist, photo viewing/download, independent review, reasoned rejection/rework, cancellation and activity/history. Mutations preserve queue pages/filters.

Readiness Settings adds stage templates, stage/dependency/checklist/photo configuration and hub/vehicle-type applicability. **Installation, Preparation & QC Staff** extends per-hub grants to perform and verify each stage.

## Deployment

Apply `20261018070000_staged_fleet_preparation`, regenerate Prisma Client, and deploy API/panel together. No automatic client-mode switch or legacy backfill is included. Active component duplicates, if present, must be resolved before creating the active-installation unique indexes; the migration fails rather than silently modifying hardware history.
