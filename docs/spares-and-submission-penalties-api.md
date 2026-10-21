# Spares catalogue and submission penalties

## Ownership and defaults

Super Admin owns `/api/v1/platform/spares`: part code, name, base reference rate, GST percentage, HSN code, unit, vehicle-type applicability and active status. Monetary rates are INR; GST is reference metadata and is not automatically added to a rider penalty. Codes are stable/immutable, uppercase and unique in the master. HSN stays a string (4–8 digits); rates allow two decimal places.

Client copies use the existing `ReturnPenaltyPrice` catalogue with `isSpare=true`, `masterSpareId` and `sourceVersion`. The source link is informational: client penalty amount, evidence requirement and enabled status belong to Client Admin. Master creation never creates a client penalty amount. New copies have `penaltyConfigured=false`, `isActive=false`, zero placeholder storage and `evidenceRequired=true`. Configured penalty amounts must be positive; blank/null means unconfigured and cannot be enabled.

`POST /platform/clients` and `POST /platform/clients/drafts` copy active masters atomically during creation. Draft completion does not recopy them. Copies and their initial history are inserted in bulk. Importing again is idempotent.

Client Admin can create private spares with the same reference fields and its own penalty settings. Their `masterSpareId` remains null. Part codes are unique across all of that client's catalogue, including copied spares and non-spare penalties. Another client cannot see, update or charge them. Creating an equivalent master later does not link or overwrite a client-created spare.

Master updates require explicit review/application. They preserve client penalty amount, enabled status and evidence settings. Master deactivation flags copies for review; it does not silently disable a client's configured penalty. Code conflicts on import are returned for review while unrelated missing items are imported. Client-created spares are never overwritten.

All changes create immutable `SpareCatalogueRevision` records. Referenced records are deactivated rather than deleted. Existing non-spare penalties remain available and are not automatically converted to spares.

## Administration APIs

Responses use `{data:...}`. Lists inside this envelope return `{items,total,page,limit}`. Query: `page` (default 1), `limit` (25, max 100), `search`, `status` (`ALL|ACTIVE|INACTIVE|UNCONFIGURED`, the last is client-only), and client `origin` (`ALL|MASTER|CLIENT|NON_SPARE`). Search includes name/code/HSN.

Super Admin:

- `GET /api/v1/platform/spares`
- `POST /api/v1/platform/spares`
- `PATCH /api/v1/platform/spares/:id`
- `GET /api/v1/platform/spares/:id/history`

Master creation:

```json
{
  "code": "PANEL_MODEL_A",
  "name": "Model A body panel",
  "baseRate": "120.00",
  "gstPercent": "18.00",
  "hsnCode": "12345678",
  "unit": "PIECE",
  "vehicleTypeIds": [],
  "isActive": true
}
```

The values above are illustrative, not a seeded price/tax catalogue. Use operator-approved real rates and HSN values. Empty vehicleTypeIds means all types. PATCH excludes code and requires `expectedVersion` and nonblank `reason` along with changed reference fields/status.

Client Admin:

- `GET /api/v1/client/spares`
- `POST /api/v1/client/spares`: reference fields/code plus optional `penaltyAmount` (string or null), `evidenceRequired` (true), `isActive` (false). Creates a client-owned spare.
- `PATCH /api/v1/client/spares/:id`: `expectedVersion`, `reason`, optional `penaltyAmount`, `evidenceRequired`, `isActive`. Client-owned spares also allow reference-field changes; master copies do not.
- `GET /api/v1/client/spares/:id/history`
- `POST /api/v1/client/spares/import-missing`: `{data:{imported,conflicts:[{masterId,code}]}}`.
- `GET /api/v1/client/spares/master-updates`: before/after reference fields and expected client/master versions.
- `POST /api/v1/client/spares/master-updates/apply`: `{reason,items:[{priceId,expectedVersion,masterVersion}]}`. At most 100 selections, applied atomically; stale previews return 409.

Example client settings:

```json
{
  "expectedVersion": 1,
  "reason": "Approved client damage tariff",
  "penaltyAmount": "200.00",
  "evidenceRequired": false,
  "isActive": true
}
```

Existing `POST/PATCH /api/v1/client/return-penalty-prices` remains available for non-spare operational penalties. Its updates advance configuration versions and record history. Spare-linked prices must be managed through the spares API. The legacy return-penalty-case workflow accepts only non-spare penalties; use the unified vehicle-submission reports for spare charges.

## Fleet Manager App catalogue

`GET /api/v1/client/return-penalty-prices?page=1&limit=25&search=panel&submissionId=<uuid>`

Allowed roles: Client Admin, Operations Manager and Fleet Manager. Only the current client's enabled, configured entries are returned, including master copies, client-created spares and existing operational penalties. No administrator write permission is granted to Fleet Managers.

- Pagination is required to fetch the complete list: `{data:[...],meta:{page,limit,total,totalPages}}`.
- Optional `search`, `submissionId`, `vehicleTypeId` filters.
- submissionId verifies Fleet Manager hub access and derives vehicle applicability from the submission's actual fleet; its vehicle type takes precedence over a supplied type.
- Each item includes `id`, `code`, `name`, `category`, `amount`/`penaltyAmount`, `currency`, `configurationVersion` (also `version`), `evidenceRequired`, `allowedFindingTypes`, origin, part metadata and vehicleTypeIds.
- Spare entries allow `DAMAGE` or `MISSING_ITEM`, using one configured amount. Operational penalties retain their existing category.

An unfiltered list is client-wide reference data. Saving/imposing always verifies access to the actual submission/hub.

## Save, edit and impose selected penalties

Existing creation route:

`POST /api/v1/client/vehicle-submissions/:submissionId/reports`

Requires a stable `Idempotency-Key`. New reports use `stage: "BASIC"` together
with the mechanic, safety, checksComplete and report evidence fields. Historical
DEEP reports remain readable in report and invoice history but are read-only.
Selected items now support:

```json
{
  "priceId": "<catalogue-item-uuid>",
  "configurationVersion": 2,
  "findingType": "DAMAGE",
  "findingId": "<optional-stable-finding-uuid>",
  "quantity": 2,
  "details": "Left and right body panels damaged",
  "evidencePhotoIds": []
}
```

New spare entries require configurationVersion. Non-spare callers may omit it for backward compatibility; new app integrations should always submit the returned version. Amount, GST, HSN and evidence rules are read from server configuration; request DTOs do not accept arbitrary amounts. Backend validates quantity (integer 1–20), applicability, client, hub, enabled status and evidence before calculating `quantity × configured unit penalty`.

A changed version or disabled/unconfigured penalty returns HTTP 409 with `PENALTY_CATALOGUE_CHANGED`; refresh the list and show the revised amount/rules before resubmitting. Unknown/foreign items are rejected. Every item requires nonblank details. Any supplied evidence must belong to this submission inspection. Required-evidence penalties need proof; required-evidence missing-item penalties need RETURN_CHECKLIST proof. Optional-evidence items can omit item photos, including missing items.

**Allocation photos, required submission photos and mechanic-report evidence remain mandatory.** Optional item proof does not waive them.

Saving a report creates a DRAFT and no financial debit. The returned items contain immutable-pricing snapshots for that report revision: part name/code/origin/source version, reference rate/GST/HSN/unit, configuration version, unit penalty, quantity/amount, evidence rule and proof IDs. Later catalogue changes do not silently reprice a saved report.

- Reopen: `GET /api/v1/client/vehicle-submissions/:submissionId` returns reports and saved items/digests.
- Edit: `PATCH /api/v1/client/vehicle-submission-reports/:reportId` with full report body and `If-Match: <current-digest>` (raw 64-character digest). Only DRAFT reports can be edited; stage cannot change. Repeated identical edits are safe, stale conflicting edits return 409, and edits are audited.
- Impose: `POST /api/v1/client/vehicle-submission-reports/:reportId/impose`. Freezes the report, posts one rider charge/invoice and returns `paymentRequest`, with `paymentRequiredToCompleteSubmission:false`. Retry returns the same invoice and never adds another debit. Supplied/report evidence is revalidated before the financial action.
- Final confirmation: existing OTP/bypass and `.../:reportId/confirm` process remains. It reuses the existing charge/invoice; it does not charge twice or wait for payment.
- Draft cancellation remains available with a reason. A report already carrying a financial charge cannot be cancelled/edited; correct it through the existing financial adjustment process. Zero-amount reports containing no penalty items retain normal submission behavior.

Duplicate findings are detected within/across reports even without photos. A stable findingId identifies a physical finding across retries. Reusing the same part/evidence, or the same part/type/normalized remarks without evidence, cannot create a duplicate charge by changing findingId. Historical finding and charge records remain unchanged.

Replacing an inspection photo preserves COMPLETE photos referenced by imposed/posted reports. The evidence and the corresponding financial snapshot remain usable for review and confirmation.

## Rider payment and outstanding amounts

Existing rider APIs continue:

- `GET /api/v1/rider-app/submission-penalties?page=1&limit=25&status=PENDING`
- `GET /api/v1/rider-app/submission-penalties/:invoiceId`
- Existing billing invoice pay endpoint returned as paymentRequest.payEndpoint.
- Operations: `GET /api/v1/client/vehicle-submissions/:submissionId/penalties`.

The existing notification worker queues the rider payment notification after imposition. Invoice breakdown includes the saved spare items. Payment settles the existing wallet/ledger balance, not a second debit. Missing/uninstalled apps do not prevent the debt from being recorded. Unpaid penalties still block the next handover; Client Admin's reasoned exception remains available. Submission confirmation never depends on payment completion.

## Panel and rollout

Super Admin → Vehicle Management → **Spares**. Client Operations → Vehicle Management → **Spares & Penalties** (Client Admin only). Both provide lists/search/status filters, pagination, create/edit dialogs and history. Client additionally provides origin filters, import conflicts and selected master-update review/application.

Apply `20261018090000_spares_penalty_catalogue`, regenerate Prisma Client and deploy API/panel together. It adds metadata/history and permits unconfigured disabled spare copies without altering existing non-spare prices. No invented production spare catalogue or rates are seeded. The operator enters actual master/client parts through the panel. Client fleet operating mode remains unchanged.

Flutter source is not in this repository. The backend contracts are ready for the Fleet Manager App's catalogue picker, draft save/edit, imposition and rider payment UI integration.

## Panel table and CSV bulk upload

Super Admin spares uses `PlatformDataTable`, the same component as OEM and other
platform catalogues. Client spares uses the shared `ClientDataTable`. Both provide
table-wide search, searchable column filters, sorting and 10/25/50/100 rows per page. The panel loads every API
page before applying table filters, so searches cover the whole catalogue.
Adding/editing a spare and reviewing reference updates/history remain available.

Use **Bulk upload** to download the CSV template, add records, inspect saved import
history and download row failures. Required columns: `code,name,baseRate,gstPercent,hsnCode`.
Optional master columns: `unit,vehicleTypeIds,isActive`. Client uploads also accept
`penaltyAmount,evidenceRequired`. Boolean cells use `true`/`false`; vehicle type UUIDs
are separated by semicolons. GST is percentage points (for example `18`). Uploads
accept CSV files up to 5 MB with 1–100 records. Client-created uploads follow the
same validation as the add form; an enabled spare needs a positive penalty amount.

- `POST /api/v1/platform/spares/bulk` (Super Admin)
- `POST /api/v1/client/spares/bulk` (Client Admin)

Body: `{ "filename": "spares.csv", "rows": [ /* normal create bodies */ ] }`.
Response `data` contains `id`, `createdAt`, `status`, `totalRows`, `passedRows`,
`failedRows`, and `failures` (`row`, `code`, `message`, original `record`). Row numbers
include the CSV header. Each valid row commits with its initial catalogue revision;
invalid/duplicate rows are reported individually. Existing codes are never overwritten.
Client CSV uploads create client-owned parts. To copy master entries, use the existing
**Import missing master spares** action instead.

`GET /api/v1/{platform|client}/spares/imports` returns the latest 100 import summaries.
`GET /api/v1/{platform|client}/spares/imports/:id/failures` returns failure details.
Import history is persisted in audit records, scoped to the platform or the current
client. No database migration is required. Interrupted imports retain their progress;
review the catalogue before retrying, since already saved codes will be duplicates.
