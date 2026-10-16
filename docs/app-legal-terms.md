# App legal documents

The `AppLegalDocument` table holds immutable published text by client, app, user role, kind, locale, and version. A null `clientId` is a platform fallback; a client-specific document wins when both are available. `AppLegalAcceptance` records the authenticated user's acknowledgement, server timestamp, optional device timestamp, and the published content hash. Rider commercial offer terms and KYC consents remain separate.

The main development seed imports all local legal templates and documents from `apps/api/prisma/catalog/legal-documents.mjs`. This consolidated catalog preserves locales, versions, content hashes, timestamps, active flags, and draft/publication/retirement/deletion states. Client references use company codes or slugs. It restores drafts as drafts, updates existing drafts, and preserves existing published content while rejecting a conflicting content hash. It does not generate additional client drafts. Publish later changes under a new version.

Client Admins manage documents at `/client/legal`. They can create, edit, publish, preview, and soft-delete drafts for their client. Publishing locks a version: published documents cannot be edited or deleted, including soft deletion. To change published content, create a new version. The public current-document endpoint only serves published, non-deleted documents. The restored Prisma migration chain includes this schema.

Endpoints use the `/api/v1` prefix:

- `GET /public/legal/current?companyCode=yogmaya&appCode=RIDER&role=RIDER&kind=TERMS_AND_CONDITIONS&locale=en` returns current text and metadata before login.
- `POST /legal/acceptances` requires an access token and `{ "documentId": "...", "contentHash": "...", "deviceAcceptedAt": "..." }`. It rejects a superseded document and is idempotent per user and version.
- `POST /legal/documents` publishes a new immutable version. Super admins may set `clientId` or omit it for a platform fallback. Client admins publish only for their own client. Body fields: `appCode`, `role`, `kind`, `locale`, `version`, `title`, `content`, and ISO `effectiveAt`.
- `POST /legal/documents/:id/retire` stops serving a version without erasing acceptance evidence.

The Rider Flutter app currently runs in development with `yogmaya` and local port 3000. `API_BASE_URL` can be overridden for emulators. A client code for staging and production will be selected when those environments are provisioned. The app saves device acceptance before login; call its `syncAcceptance` helper after OTP succeeds, once the login flow is migrated.
