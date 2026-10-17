# Rider KYC from document approval

## Rules

The active published rider onboarding configuration determines which upload fields participate.
Disabled/excluded fields and superseded document versions do not participate.

- `VERIFIED`: every required upload exists and every submitted participating document is approved.
- `PENDING`: a required upload is missing or a submitted document awaits approval.
- `FAILED`: a current participating document is rejected.
- `NOT_STARTED`: no participating documents have been submitted and no required uploads are missing.

An unsubmitted optional document does not block verification. A submitted optional document needs approval.
`kycVerifiedAt` is the latest participating approval timestamp; it clears when KYC is no longer verified.
For workspaces without configured document uploads, existing provider KYC records remain the fallback:
all existing checks must be verified, any failed check means failed, otherwise pending.
No records means not started, never automatically verified.

## API and persistence

`Rider.kycStatus` and `Rider.kycVerifiedAt` store the overall document review outcome.
The common `/rider-documents/:id/approve` and `/reject` endpoints update the document and rider
atomically, and return `kycStatus` / `kycVerifiedAt` alongside the document.
This applies to both dashboard and fleet manager clients without changing request bodies.
Replacement document uploads clear the previous verified state in the same transaction.
Approvals before onboarding completion are retained; rider creation synchronizes the result.
Per-user row locks serialize concurrent approvals, uploads and onboarding completion.

Rider list/detail and rider-app onboarding responses expose the overall KYC status.
Rider list/detail derive it from current documents, so historical approvals and changed configurations
are reflected even before persisted fields are backfilled. Dashboard queries use this same rule,
counting each nondeleted rider once within the authenticated client.

`GET /dashboard` returns rider counts in `kyc`.
`GET /kyc/admin/overview` adds `riderKyc: { total, byStatus }` and retains existing provider-request metrics.
The KYC overview displays rider counts separately from provider verification requests.

Existing `RiderKyc` Aadhaar/PAN/bank records and provider verification results remain provider checks;
manual document approval does not fabricate successful provider checks.

## Deployment

1. Apply migrations, including `20261018010000_rider_document_kyc_status`.
2. Build the API.
3. With the intended `DATABASE_URL`, run from `apps/api`:
   `node scripts/backfill-rider-kyc.mjs`.
4. Deploy the API and frontend together.

The backfill is repeatable and recalculates existing linked riders using the same service.
It does not change individual document decisions or provider verification records.

## Tests

`RIDER_KYC_TEST_DATABASE_URL` must point to a migrated disposable database whose name includes `_test_`.
Run `vitest run src/riders/rider-kyc-status.integration.spec.ts` to verify approval from either role,
replacement/rejection/reapproval, concurrent approvals, historical approvals, deletion and client isolation.
