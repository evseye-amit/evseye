# Rider reference verification

All routes use the `/api/v1` prefix and existing authenticated client context.
Allowed roles: `CLIENT_ADMIN`, `OPERATIONS_MANAGER`, `FLEET_MANAGER`, `KYC_OPERATOR`.
Riders cannot approve or reject their own references. References from other clients
are never returned or reviewable.

## Fleet manager app

- `GET /riders/:riderId/references`: all current references for an existing rider;
  returns 404 for an unknown or other-client rider.
- `GET /rider-references?userId=:userId`: references while onboarding is pending,
  before a Rider record exists.
- `GET /rider-references`: all references in the current client. Optional filters:
  `riderId`, `userId`, `status` (`PENDING`, `APPROVED`, `REJECTED`), and `search`.
- `POST /rider-references/:referenceId/approve`: no body required.
- `POST /rider-references/:referenceId/reject`:
  `{ "rejectionReason": "The contact could not confirm the rider's details." }`.
  A nonblank reason of at most 1000 characters is required.

Responses follow the usual `{ "data": ... }` envelope. Each reference contains
`id`, `riderId` (null before completion), `userId`, `riderName`, `riderMobile`,
`name`, `mobile`, `relation`, `status`, `rejectionReason`, `reviewedAt` and
`reviewedBy` (`id`, `name`). Always use the returned reference `id` for review.
A successful review returns the updated reference; update that row in the app.
A duplicate/concurrent review returns 409: refresh references before retrying.
A removed or replaced reference returns 404.

## Storage and lifecycle

References are read from the existing onboarding values and rider metadata, including
configured reference fields. Decisions are stored in `RiderReferenceReview`, with a
client-scoped fingerprint of the owner, source field, name, normalized mobile and
relationship. No writes occur during listing. Existing references appear as pending
without a backfill or reseed. There is no need to reset the database.

Unchanged references retain their decisions when reordered or when onboarding creates
the Rider profile. A different name, mobile, or relationship creates a pending reference;
previous decisions remain in the review table and audit log. Returning to exactly the
same details restores the decision for that same reference. Removed references are
excluded from current lists. The client and reviewer are recorded on every decision.

The client panel submenu is **Rider Management → Reference Verification**. It provides
search, column filters, sorting, pagination, review counts, reviewer details and rejection
reasons, using the document verification page's design. Review actions update one row
without reloading the table. Verification does not add an onboarding or allocation gate.

Apply `20261016010000_rider_reference_reviews` with the normal migration deployment
before starting the updated API. This adds one review table and preserves existing data.
