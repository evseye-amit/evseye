# Team Lead assignment during allocation

All endpoints require a Fleet Manager bearer token. Routes use `/api/v1`.

## List active Team Leads

`GET /mobile-deployments/fleet-manager/team-leads?search=Lead&page=1&limit=25`

Lists active, non-deleted Team Lead profiles/users in the manager's client.
Search matches name, mobile or employee code. Page starts at 1; limit is 1–100.
Response: `{ data: [...], meta: { page, limit, total } }`. Each item contains
`id` (profile ID), `userId`, `name`, `mobile`, `employeeCode`, `designation`,
and `assignedRiderCount`.

Team Leads are client-wide choices; the allocation itself is restricted to the
manager's active assigned hubs.

## View and assign the primary Team Lead

- `GET /mobile-deployments/:allocationId/team-lead`
- `PUT /mobile-deployments/:allocationId/team-lead`

PUT body:

```json
{ "teamLeaderId": "<Team Lead profile UUID>" }
```

Use the profile `id` returned by the list API, not its `userId`.
GET and PUT return `{ data: { allocationId, riderId, teamLead } }`; `teamLead`
contains profile ID, user ID, name, mobile, employee code and designation.
GET returns `teamLead: null` when no single eligible primary lead exists.

Create the allocation first, then assign the Team Lead before completing
handover. Assignment is allowed only in INITIATED, INSPECTION_PENDING and
OTP_PENDING. Client/hub authorization and active rider/lead checks apply.
An existing valid primary assignment satisfies the requirement; GET lets the
app display it. PUT replaces the primary assignment while preserving other
assignment records as non-primary. Repeating the same assignment preserves its
assignment time. Changes are audited. Concurrent changes serialize per rider.

## Mandatory handover check

Every shared commercial activation path, including mobile, staff activation and
exchange replacement handover, requires exactly one eligible active primary Team
Lead in the same client. Missing/inactive/deleted leads block handover with HTTP
409 and code `ALLOCATION_TEAM_LEAD_REQUIRED`:

“Assign an active Team Lead before completing scooter allocation.”

Assigning a Team Lead does not complete PDI, payment or training. Existing
submission OTP recipient selection uses this same active primary assignment;
photos, mechanic reports, penalties and OTP/bypass procedures are unchanged.
