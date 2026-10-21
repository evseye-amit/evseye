# Payment transactions and receipt images

## Scope

Client Admin has a **Payment Transactions** menu in Client Operations. The list combines allocation payments (`DEPLOYMENT`), checkout collections (`COLLECTION`), AutoPay debits (`AUTOPAY`) and standalone recorded payments (`RECEIVED`). Financial receipts already represented by a collection, AutoPay debit or allocation payment are not listed twice. Internal wallet ledger movements and refunds retain their existing screens/APIs.

Only submitted manual allocation payments are reviewed here. Provider-verified payments retain automatic verification. Uploading an image never credits a balance, settles an invoice or advances allocation. Allocation approval calls the existing commercial verification service, including deposit handling and ledger posting.

## Rider API

All routes below start with `/api/v1/rider-app/billing/payment-transactions`:

- `GET /`: paginated payment history belonging to the signed-in rider.
- `GET /:source/:id`: payment details, completed receipts and submission/review history.
- `POST /:source/:id/receipts/upload-intent`: create a Photo and return `{ photo, uploadUrl }` through the existing media/storage flow.
- `POST /:source/:id/receipts/:photoId/complete`: validate and seal the uploaded image; retries are safe.
- `GET /:source/:id/receipts/:photoId/download-url`: return a temporary private viewing URL.

`source` is one of `DEPLOYMENT`, `COLLECTION`, `AUTOPAY`, `RECEIVED`. `id` is that source's **payment ID**, not the rider, allocation, invoice or ledger ID. An allocation payment ID is returned by the existing `GET /api/v1/mobile-deployments/:allocationId/payment`; this response now also includes `source: "DEPLOYMENT"` and `receipts`.

Upload body:

```json
{"fileName":"payment-receipt.jpg","mimeType":"image/jpeg","sizeBytes":123456}
```

Upload the file bytes to `uploadUrl` using PUT and the matching Content-Type, then call complete with the returned `photo.id`. Supported images: JPG/JPEG, PNG and WebP, up to 5 MiB. Images are optional, private and retained across rejection/resubmission. Each upload has its own Photo slot; a new receipt does not overwrite an earlier one. Completed bytes are copied to a server-only key so a previously issued upload URL cannot change reviewed evidence. The generic `/media` routes cannot access payment receipts.

The Flutter application should wire its camera/gallery selector to these APIs and show the returned rejection reason when a payment is rejected. Flutter source is not in this repository.

## Client Admin API

Base: `/api/v1/client/payment-transactions` (CLIENT_ADMIN only).

- `GET /`: global search, status/source/date filtering and server pagination.
- `GET /:source/:id`: details, receipts and review history.
- `POST /DEPLOYMENT/:id/approve`: `{ "expectedVersion": 1 }`.
- `POST /DEPLOYMENT/:id/reject`: `{ "expectedVersion": 1, "reason": "Reference does not match received funds" }`.
- `GET /:source/:id/receipts/:photoId/download-url`: temporary image URL for existing clients.
- `GET /:source/:id/receipts/:photoId/content`: authenticated private image bytes, used by the panel for viewing/downloading.

List query: `page` (1–10000), `limit` (1–100), `search`, `source`, `status`, ISO `from`/`to`, `sortBy` (`createdAt`, `riderName`, `mobile`, `amount`, `status`, `reference`, `source`, `method`, `purpose`) and `sortDirection` (`asc`/`desc`). Response: `{ data: { items, total, page, limit } }`. Rows include `receiptCount`, `submissionVersion`, `rejectionReason`, and `canReview`.

The panel uses the shared ClientDataTable with an optional server mode; existing tables keep their local search/filter/sort/pagination behavior. Payment review reloads the current filtered page, without remounting the table or resetting pagination.

## Review rules

- `PENDING → SUBMITTED → PAID`, or `SUBMITTED → REJECTED → SUBMITTED`.
- Rejection requires 3–1000 non-whitespace characters and leaves allocation at `PAYMENT_PENDING`.
- Each new submission increments `submissionVersion`; Admin must echo it as `expectedVersion`.
- An outdated version returns conflict. Simultaneous approval/rejection is serialized with the allocation lock. Retried approvals do not double-credit deposits or the ledger.
- Rejected references, reason, reviewer and receipt IDs are preserved in audit history. Current rejection fields clear on resubmission; history remains.
- Paid payments cannot be rejected. Use the existing refund/reversal flow when money has already been recorded.

Fleet Managers retain `POST /api/v1/mobile-deployments/:allocationId/payment/verify` (optionally send `expectedVersion`) and gain `POST /api/v1/mobile-deployments/:allocationId/payment/reject` with required reason/version. They can read the rider payment-detail and receipt-URL endpoints above for allocation payments only in their assigned active hubs. Rider uploads remain restricted to the owning rider.

## Deployment and verification

Apply migration `20261019020000_payment_receipts_and_reviews`, regenerate Prisma and restart API/panel. No seed changes are required.

Tests cover reason/file validation, ownership and generic-route bypass attempts, immutable upload completion, rejected evidence/history preservation, resubmission, stale reviews, concurrent Admin/Fleet Manager approvals, simultaneous approval/rejection, source de-duplication and server pagination.

## Allocation Pay Now: UPI return and receipt submission

Manual verification remains limited to allocation/onboarding (`DEPLOYMENT`). This does not introduce manual review for rental, wallet, penalty, collection or AutoPay payments.

### App sequence

1. Fetch `GET /api/v1/mobile-deployments/:allocationId/payment`. Retain the allocation ID and returned payment `id` before opening UPI. Amount/currency are server-owned.
2. Launch the existing UPI intent. On return, prefill the reference/UTR if supplied by the UPI app, otherwise let the rider enter it. Cancelled/failed UPI attempts should not be automatically submitted.
3. Offer an optional receipt screenshot from camera/gallery. An external UPI app does not supply the image through this API.
4. For a selected image, use the existing `DEPLOYMENT/:paymentId/receipts/upload-intent`, PUT bytes to the returned signed URL, then call `.../receipts/:photoId/complete`. Finish the upload before submitting its ID. File size/type and private storage rules above apply.
5. Submit using the **allocation ID**, not the payment ID:

```http
POST /api/v1/mobile-deployments/:allocationId/payment/submit
```

```json
{
  "provider": "UPI",
  "providerReference": "123456789012",
  "receiptPhotoIds": ["<completed receipt Photo UUID>"]
}
```

`receiptPhotoIds` is optional (omit it or send `[]` when no screenshot is chosen), unique and limited to 20 IDs. Each ID must belong to a completed upload by this rider for this exact client/payment. Unknown, foreign, pending and wrong-source receipts are rejected before submission. Existing clients sending only provider/reference remain compatible. Completed receipts are already attached by payment ID; passing their IDs explicitly verifies that the intended uploads finished. All completed rider receipts are included in the response/audit snapshot.

### Resume states

Both GET payment and POST submit preserve their existing payment fields and return:

- `source: "DEPLOYMENT"`
- `receipts`: completed image metadata; obtain viewing URLs from the existing receipt download endpoint.
- `receiptOptional: true`
- `canSubmit`: true only for a pending/rejected payment while the workflow is `PAYMENT_PENDING`.
- `nextAction`:
  - `SUBMIT_PAYMENT_DETAILS`: collect UTR/reference and optional screenshot.
  - `AWAITING_VERIFICATION`: show the existing submitted reference and pending approval message.
  - `CORRECT_PAYMENT_DETAILS`: show `rejectionReason`, allow correction and resubmission.
  - `PAYMENT_COMPLETE`: refresh/continue the existing allocation flow.
  - `CONTACT_SUPPORT`: payment cancelled/failed or workflow no longer accepts submission.

A submission records a claim as `SUBMITTED`; it does not credit the wallet, settle money or advance allocation. Existing Fleet Manager/Client Admin verification is still required. Do not mark a payment paid from a client-side UPI success callback.

### Retry and concurrency rules

- Persist payment/allocation IDs, entered UTR, selected local image path and pending upload Photo ID in the Flutter app before leaving the screen. These local lifecycle/network handlers are outside this repository.
- On app resume/restart, fetch GET payment and render `nextAction`; completed receipts remain available on the server.
- Retry an interrupted PUT/complete using the retained upload while its signed URL remains valid. If expired, create a fresh upload intent; pending uploads are never shown as accepted proof.
- Retry POST submit with the same trimmed provider/reference after a lost response. It returns the existing submitted **or approved** payment without another ledger entry or submission-version increment.
- A corrected reference can be submitted only from PENDING/REJECTED. An already submitted reference must be reviewed before changing it.
- Receipt completion is idempotent. For DEPLOYMENT it uses the same allocation lock as approval, and a newly completed receipt on a SUBMITTED payment increments `submissionVersion`. A stale Admin/Fleet Manager review must reload; repeating completion does not increment the version or duplicate the upload audit.
- Optional receipts may still be attached after payment approval. They do not reopen or settle the payment again.

No new migration or seeds are required for this extension. The Flutter source is not present here; the app must implement the UPI-return screen, manual UTR entry, gallery/camera picker and local retry state using these contracts.

## Panel receipt delivery

The panel fetches `/api/v1/client/payment-transactions/:source/:id/receipts/:photoId/content` through its same-origin authenticated gateway, then opens the returned image in the existing dialog and offers download. The API checks Client Admin access, authenticated client scope, payment ownership, receipt source/payment association and COMPLETE status before reading the sealed object using the internal storage client. Only JPEG, PNG and WebP receipts up to 5 MiB are returned. Responses have a private/no-store cache policy. Reads have a strict byte limit, close storage streams and return useful missing-image/unavailable-storage errors without exposing object URLs or credentials.

This avoids direct cross-origin browser reads of signed S3/MinIO URLs, including on tenant and custom domains. The mobile signed-download API remains unchanged. No migration or seed changes are required.
