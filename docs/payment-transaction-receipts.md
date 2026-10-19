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
- `GET /:source/:id/receipts/:photoId/download-url`: temporary image URL.

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
