# Fleet preparation and QC — Phase 2

## Modes and rollout

The migration adds PREPARATION_QC; it does not change any client's current mode.
SIMPLE continues to allow optional onboarding photos. ONBOARDING_EVIDENCE retains
its original activation requirements. Allocation and submission INSPECTION photos
are mandatory according to their existing requirements in all modes. Preparation
photos never satisfy handover/return photo requirements.

Enable Preparation + QC in Fleet Readiness Settings after assigning staff.
The preview lists unallocated scooters, active rentals, in-progress handovers/
submissions, and open preparations. In-progress allocations or preparations block
mode changes; an active rental stays with its rider. Admins can cancel an open
preparation with a mandatory reason. A mode change never automatically releases a
scooter or clears a maintenance or administrative block.

Policy changes use expectedVersion and a mandatory reason. Existing cycles retain
their frozen policy version; new rules apply to new cycles. Switching modes clears
old approvals so switching back cannot resurrect them.

## Permissions

Dedicated RFD_MANAGER and QC_MANAGER users can sign in to CLIENT_PANEL only.
Client Admin may also assign these capabilities to an existing operations user.
FleetReadinessStaff grants canPrepare/canReview per active hub; a role alone does
not grant access. A user may have both capabilities. Independent review defaults
to true and prevents anyone who contributed preparation work from reviewing it.

Client Admin manages policy and staff. Operations Manager can monitor queues,
reassign RFD ownership and cancel preparations. Neither automatically gains
permission to prepare or review without a hub grant. Fleet Managers can read
readiness for scooters in their assigned hubs; preparation/QC writes need grants.

## Lifecycle

IN_PROGRESS -> AWAITING_QC -> APPROVED, or REWORK_REQUIRED -> new revision.
Maintenance/cancellation close the cycle. Component replacement, component identity
changes, hub transfers, maintenance/out-of-service transitions and receipt of a
returned scooter invalidate readiness. Queues also list scooters awaiting a cycle.

Starting a cycle claims it for the preparer. Save checklist results and odometer,
upload all required photos, then submit. Each revision owns separate photos. Rework
starts a fresh draft revision; old evidence is retained but cannot satisfy new
slots. Submitted revisions/photos are immutable. QC rejection requires reason and
failedItems. Approval is atomic, restricted to the submitted revision, and cannot
release a scooter with unfinished allocation/submission/mechanic checks.

The default checklist covers identity, installed components, body/mirrors, tyres,
brakes, steering/suspension, lights/horn, dashboard, wiring, battery mounting,
charging, keys and operational test. Core safety checks and front/rear/left/right/
dashboard photos cannot be removed. Battery and controller installation/label slots
are generated per installed component. IoT requirements are disabled by default.
Optional custom checks may allow NA with a reason; FAIL blocks submission.

`allocationBlockedByAdmin` records explicit allocationEnabled changes made through
the fleet update API, separately from temporary submission holds. QC restores
allocationEnabled only when there is no administrative block. Preparing a scooter
requires maintenance to finish first. Existing disabled AVAILABLE scooters retain
their block when the client enables Preparation + QC.

Database guards apply the readiness gate to every path that makes a scooter
AVAILABLE and to allocation creation/final handover (including exchanges).
Readiness-pending scooters use INSPECTION_PENDING and do not inflate the Home
ready-for-deployment count. Manual AVAILABLE updates cannot bypass QC. Inspection
and submission evidence, pricing/payment, Team Lead and OTP rules are unchanged.

## API

All routes below are under `/api/v1/client`, authenticated and tenant-scoped.
Responses use the existing `{ data: ... }` envelope. UUID parameters are validated.

- GET fleet-readiness/context: permitted hubs/capabilities and permitted assignees.
- GET fleet-readiness/policy: operatingMode, version, configuration.
- POST fleet-readiness/policy/preview: `{ operatingMode }`.
- PUT fleet-readiness/policy: `{ operatingMode, expectedVersion, reason, configuration }`.
- GET fleet-readiness/staff: users, hubs, capability assignments (management only).
- POST fleet-readiness/staff: `{ name, mobile: "+91…", role: "RFD_MANAGER" | "QC_MANAGER" }`.
- PUT fleet-readiness/staff/:userId: `{ assignments: [{ hubId, canPrepare, canReview }] }`.
  An empty array revokes all readiness grants for that user; it does not delete them.
- GET fleet-preparations/summary: counts grouped by cycle status.
- GET fleet-preparations/candidates: scooters eligible to start a preparation.
- GET fleet-preparations: preparation queue.
- GET fleet-qc: defaults to AWAITING_QC, supports other status filters/history.
- POST fleets/:fleetId/preparations: starts/returns the existing open cycle.
- GET fleets/:fleetId/readiness: latest preparation, allocation blockers, canAllocate.
- GET fleet-preparations/:id: scooter/components, revision checklist, photo slots,
  photos, review decisions, events and permitted actions.
- PATCH fleet-preparations/:id: `{ revision, odometerKm, checklist: { CODE: { result: "PASS" | "FAIL" | "NA", notes } } }`.
- POST fleet-preparations/:id/assign: `{ revision, userId }`.
- POST fleet-preparations/:id/submit: `{ revision }`.
- POST fleet-preparations/:id/qc-approve: `{ revision }`.
- POST fleet-preparations/:id/qc-reject: `{ revision, reason, failedItems: ["TYRES"] }`.
- POST fleet-preparations/:id/maintenance: `{ revision, reason }` (assigned RFD).
- POST fleet-preparations/:id/cancel: `{ revision, reason }` (management).
- POST fleet-preparations/:id/upload-intents: `{ revision, photoType, mimeType, fileName, sizeBytes }`.
  JPEG/PNG/WebP only, up to 5 MiB. PUT bytes to uploadUrl.
- POST fleet-preparations/:id/photos/:photoId/complete: `{ revision }`.
  Storage seals the image under a server-only object key, then validates its
  type/signature and size before completion. Replaying an earlier signed PUT URL
  only changes the unreferenced draft object, never submitted evidence. The API
  storage principal needs permission to read draft objects and write sealed objects.
- GET fleet-preparations/:id/photos/:photoId/download-url: scoped signed viewer/download URL.

Queues accept page (default 1), limit (default 20, max 100), hubId, search and
status; preparation queue also supports assignedToId. Stable ordering and explicit
totals allow server pagination. Mutations retain page/filter selection in the panel.

Use the revision returned after saving rework or creating an upload intent;
starting rework increments currentRevision. Reload detail after a 409 before
retrying. Open-cycle creation, upload completion, submission and identical review
retries are safe to repeat; changing a review decision requires a new revision.

## Panel

Vehicle Management: Vehicle Preparation, Quality Check, Fleet Readiness Settings.
Team Management: Preparation & QC Staff. Fleet rows have a Readiness dialog.
Preparation/QC dialogs include checklist, photo viewer/download, installed serials,
review feedback, immutable revision evidence and activity history. RFD/QC users
only see readiness menus; settings/staff actions remain management-restricted.

## Verification and deployment

Apply `20261018060000_fleet_preparation_qc`, generate Prisma Client and deploy API
and panel together. Do not change the current client's SIMPLE setting to try out
QC; use an isolated test client/database. Phase 3 installation-team dependencies
are intentionally not part of this implementation.
