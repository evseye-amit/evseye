# Fleet Manager vehicle exchange access

Fleet Managers can use these existing `/api/v1/vehicle-exchanges` routes:

- `GET /` and `GET /:id`
- `POST /:id/approve` and `POST /:id/reject`
- `POST /:id/replacement` and `GET /:id/preview`
- `POST /:id/offer`, `POST /:id/reject-offer` and `POST /:id/accept`
- `POST /:id/reconcile-deposits`
- `POST /:id/handover`, `POST /:id/complete` and `POST /:id/cancel`

Authentication and client scope come from the signed user identity. The route-level hub guard restricts Fleet Manager list results and access to individual requests. Only active, undeleted hub assignments in the same client count. No assignments produce an empty list and no access to individual exchanges.

The operational hub is selected in this order:

1. Actual vehicle submission hub, once a submission exists.
2. Planned return hub, when there is no submission.
3. Original scooter's current hub, for older requests with neither.

A foreign planned or actual hub cannot fall back to a local original scooter to gain access. Foreign-client requests are excluded. A request outside the assigned scope returns 404.

For mutations, both an already-selected replacement and any proposed replacement scooter must belong to an assigned hub in the same client. An explicit replacement hub must also be assigned. Replacement availability and assigned hubs are checked again when the service reserves the fleet. Cross-hub operations require a staff member with the necessary hub assignments or the existing Client Admin/Operations Manager access.

Existing request bodies, exchange state checks, pricing, fee and deposit calculations, submission evidence, allocation checks and completion requirements are retained. Assisted offer acceptance still requires `consent: true`, `riderConsentReference`, `assistedReason`, and the valid offer ID/hash; the Fleet Manager is recorded as the actor through existing audit/consent history. Rejection retains its required reason.

The Rider App's exchange endpoints and ownership checks are unchanged. Policy editing remains Client Admin-only. Staff request creation, policy/history reads and the legacy return/confirm-return routes retain their previous permissions; Fleet Managers continue to use the existing submission workflow for intake.

No schema migration or seed change is needed. Flutter integration and deployment are separate.
