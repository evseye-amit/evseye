# Ride return and support API

All routes use `/api/v1`, bearer authentication, DTO validation, and the
`{ data }` response envelope. IDs below are examples.

## Rider return sequence

1. Request a return. The key is required and must be reused for an identical
   retry. The server resolves the authenticated rider's eligible rental. Do
   not send an agreement ID; no eligible rental returns a conflict, and
   multiple eligible rentals are rejected rather than guessed.

   ```sh
   curl -X POST "$API/rider-app/ride-returns" \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Idempotency-Key: return-rider-001' \
     -H 'Content-Type: application/json' \
     -d '{"reasonCode":"MOVING","plannedHubId":"<hub>","plannedReturnDate":"2026-10-20T10:00:00Z"}'
   ```

2. Track the rider's own return with `GET /rider-app/ride-returns` or
   `GET /rider-app/ride-returns/:id`. Cancel is allowed only before receipt.
3. After staff submit a non-zero penalty revision, request and verify the
   six-digit OTP:

   ```sh
   curl -X POST "$API/rider-app/ride-returns/<return>/penalties/otp/request" \
     -H "Authorization: Bearer $TOKEN"
   curl -X POST "$API/rider-app/ride-returns/<return>/penalties/otp/verify" \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"otpRequestId":"<otp>","code":"123456"}'
   ```

   The OTP is bound to the exact case, revision, digest, total, currency, and
   rider. A changed revision or total invalidates it. Invalid code and expiry
   attempts still record their attempt/status before returning an error.
4. Dispute the whole current list with
   `POST /rider-app/ride-returns/:id/penalties/dispute` and a required reason.

## Staff return and penalty sequence

Fleet and operations managers use `/client/ride-returns`; fleet managers are
limited to their assigned planned/received hubs. Client admin and operations
access is client-wide. Staff can request on behalf of a rider, receive at the
actual hub, and complete the post-deallocation inspection. For a staff request,
send `riderId`; the server resolves that rider's eligible rental within the
client. Do not send an agreement ID. No eligible rental returns a conflict, and
multiple eligible rentals are rejected rather than guessed. Receipt records the
billing cutoff before inspection or penalty work. A future receipt is rejected;
a backdated receipt needs `backdateReason`.

The existing `/client/agreements/:agreementId/termination` and
`/client/agreements/:agreementId/return` compatibility routes keep their
agreement-scoped path. This does not make `agreementId` part of either modern
create body.

```sh
curl -X POST "$API/client/ride-returns" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'Idempotency-Key: return-staff-001' -H 'Content-Type: application/json' \
  -d '{"riderId":"<rider>","reasonCode":"VEHICLE_RETURN","plannedHubId":"<hub>","plannedReturnDate":"2026-10-20T10:00:00Z"}'
curl -X POST "$API/client/ride-returns/<return>/receive" \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' \
  -d '{"receivedHubId":"<hub>"}'
curl -X PUT "$API/client/ride-returns/<return>/penalties" \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"priceId":"<active-price>","details":"Deep scratch","evidencePhotoIds":["<inspection-photo>"]}]}'
curl -X POST "$API/client/ride-returns/<return>/penalties/submit" \
  -H "Authorization: Bearer $STAFF_TOKEN"
curl -X POST "$API/client/ride-returns/<return>/penalties/approve" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

The draft stores price IDs and item evidence. Submit re-reads active prices,
copies code/category/description/amount/currency, calculates the immutable
digest and total, and starts rider approval. Manager approval may happen
before or after rider OTP/admin override. The second current-revision approval
posts one idempotent `RiderCharge` and ledger entry in the same serializable
transaction. A zero-item submission is terminal `POSTED` with total `0.00`,
no OTP, and no charge. Client admin may use
`POST .../penalties/override-rider-approval` with a required reason; manager
approval is still required.

Price administration is client-admin-only:

- `GET /client/return-penalty-prices`
- `POST /client/return-penalty-prices`
- `PATCH /client/return-penalty-prices/:id` (deactivate; prices are never deleted)

## Inspection and media rules

`POST /inspections/:id/complete` requires `safeForReuse` for a post-return
inspection. An unsafe result requires `unsafeReason`. Completing a received
return's inspection finalizes its allocation in the same transaction: safe
vehicles become `AVAILABLE`, and unsafe vehicles become `MAINTENANCE`. New
received returns do not need the legacy rider/operator deallocation OTP pair.
Standalone legacy deallocations still require both OTPs.

Return evidence uses the existing inspection media routes. Support attachments
use only their dedicated ticket routes; generic media upload, list, requirement,
complete, and download routes reject `SUPPORT_TICKET`.

## Support tickets

Riders create and read only their own tickets under
`/rider-app/support/tickets`. A resolved rider reply reopens the ticket.
Client admins and operations managers have client-wide staff access; fleet
managers are limited to the ticket's derived hub. Hub derivation is received
return, then planned return, then current allocation.

```sh
curl -X POST "$API/rider-app/support/tickets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"subject":"Vehicle issue","message":"The returned vehicle is still shown in my app."}'
curl -X POST "$API/rider-app/support/tickets/<ticket>/attachments/upload-intent" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"photoType":"SCREENSHOT","mimeType":"image/png","fileName":"issue.png","sizeBytes":12000}'
```

Use `GET` list endpoints with `limit` (1–100, default 25), `status`, `hubId`
where supported, and the returned opaque cursor. Ticket replies and status
updates are audited. There is no assignment, live-chat, notification, or
background worker API in this version.

## Common errors

| Code/message | Meaning |
|---|---|
| `RETURN_ALREADY_REQUESTED` | A non-cancelled request already exists with different data. |
| `RETURN_NOT_CANCELLABLE` | The vehicle was already received. |
| `SAFE_FOR_REUSE_REQUIRED` / `UNSAFE_REASON_REQUIRED` | Inspection safety input is incomplete. |
| `PENALTY_REVISION_CHANGED` | The list, evidence, digest, or total is no longer current. |
| `PENALTY_REVISION_REQUIRES_REPLACEMENT` | A disputed submitted revision must be replaced before resubmission. |
| `RETURN_PENALTY_WORKFLOW_REQUIRED` | A new damage/missing assessment must use the return workflow. |
| `Media entity not found.` | The entity is not in the caller's client. |
| `Support attachments use the support ticket routes.` | A generic media route was used for support evidence. |
