# App legal documents

The `AppLegalDocument` table holds immutable published text by client, app, user role, kind, locale, and version. A null `clientId` is a platform fallback; a client-specific document wins when both are available. `AppLegalAcceptance` records the authenticated user's acknowledgement, server timestamp, optional device timestamp, and the published content hash. Rider commercial offer terms and KYC consents remain separate.

After deploying the migration, run `pnpm --filter @evs-eye/api seed:legal` for local development (`yogmaya`). The seed publishes the user-supplied Rider Terms version `1.0.0`, effective 1 October 2026, and retires the previous development version while preserving its acceptance records. The seed rejects edits to an already published version. Publish changes under a new version outside development. Pink Rides staging and production seeding will follow after development validation.

Client Admins manage documents at `/client/legal`. They can create, edit, publish, preview, and soft-delete drafts for their client. Publishing locks a version: published documents cannot be edited or deleted, including soft deletion. To change published content, create a new version. The public current-document endpoint only serves published, non-deleted documents. Apply migration `20261008170000_app_legal_document_drafts` before using the management screen.

Endpoints use the `/api/v1` prefix:

- `GET /public/legal/current?companyCode=yogmaya&appCode=RIDER&role=RIDER&kind=TERMS_AND_CONDITIONS&locale=en` returns current text and metadata before login.
- `POST /legal/acceptances` requires an access token and `{ "documentId": "...", "contentHash": "...", "deviceAcceptedAt": "..." }`. It rejects a superseded document and is idempotent per user and version.
- `POST /legal/documents` publishes a new immutable version. Super admins may set `clientId` or omit it for a platform fallback. Client admins publish only for their own client. Body fields: `appCode`, `role`, `kind`, `locale`, `version`, `title`, `content`, and ISO `effectiveAt`.
- `POST /legal/documents/:id/retire` stops serving a version without erasing acceptance evidence.

The Rider Flutter app currently runs in development only, with `yogmaya` and local port 3000. `API_BASE_URL` can be overridden for emulators. Staging will use `pinkrides` with `https://api.staging.evseye.com`; production will use `pinkrides` with `https://api.evseye.com` after the development flow is complete. The app saves device acceptance before login; call its `syncAcceptance` helper after OTP succeeds, once the login flow is migrated.
