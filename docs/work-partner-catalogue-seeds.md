# Work partner catalogue seeds

Source: `EVsEye_WorkPartnerMaster.xlsx`, WorkPartnerMaster rows 2–42 (41 entries).

- Platform data and seeder: `apps/api/prisma/catalog/work-partners.mjs`.
- Independent Yogmaya copies and seeder: `apps/api/prisma/client/yogmaya/work-partners.mjs`.
- Both are called by `apps/api/prisma/seed.mjs` after the client records exist.
- Apply `20261019010000_work_partner_logo_category` before running these seeds.

`WorkPartnerCategory` includes FOOD_DELIVERY, QUICK_COMMERCE, ECOMMERCE,
PARCEL_LOGISTICS, ON_DEMAND_LOGISTICS, PHARMACY_HEALTHCARE, SPECIALTY_DELIVERY
and OTHER. Existing rows default to OTHER; no existing client settings are changed.

Both tables retain logo, category, work type and website,
in addition to code, name, legal name and status. Legal names omit verification/operator annotations from the source; other catalogue
fields are retained.

Seeds add missing codes only and never overwrite admin edits. Client rows use portable
master-code lookups for their source relationship; database IDs are not embedded in seeds.
Client rows remain independent after creation. Regular API create/edit/list/copy flows
carry the same metadata. Logos accept controlled `/logos/work-partners/<filename>` asset
paths (SVG, PNG, JPG/JPEG or WebP), and may be cleared with null.

The workbook contains logo references but no image files. Actual assets must be supplied
under `apps/web/public/logos/work-partners/` using those names. Logos are stored as metadata but are not shown in the table. No invented or downloaded logo artwork is included.

## Bulk upload

Both panels provide **Bulk upload**, a CSV template, persisted import history and
failure downloads. Required columns: `code,name,legalName`. Optional columns:
`category,status,logo,workType,website`. Blank category defaults to OTHER and blank
status to ACTIVE. Uploads accept CSV up to 5 MB and 1–100 rows. Duplicate codes
are reported, never overwritten. Client uploads create independent client-owned entries.
The Super Admin row action **Copy to client** and its dialog are removed.

For Super Admin, use `POST /api/v1/platform/work-partners/bulk`; for Client Admin,
use `POST /api/v1/client/work-partners/bulk`. Body: `{ "filename": "partners.csv",
"rows": [ /* normal create bodies */ ] }`. Response `data` contains `id`,
`createdAt`, `status`, `totalRows`, `passedRows`, `failedRows` and `failures`.
Each failure includes its CSV row number (header included), code, message and original record.

`GET /api/v1/{platform|client}/work-partners/imports` returns the latest 100 uploads.
`GET /api/v1/{platform|client}/work-partners/imports/:id/failures` returns the failures.
These audit-backed endpoints are scoped to the platform or current client and require
its administrator role. Valid rows commit independently; interrupted uploads retain
progress. No new database migration or seed run is required for bulk import.
