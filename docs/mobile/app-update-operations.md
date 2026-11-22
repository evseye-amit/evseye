# App update policies — implementation and operations

## Scope and implementation plan

Completed scope: backend policy storage and checks, super admin controls, and Flutter integration handoff. Flutter implementation is owned by the mobile team; neither Flutter workspace is modified.

Implementation order:

1. Add client-scoped policy and immutable revision history tables with no seeded restrictions.
2. Add draft, preview, publish, disable, and restore APIs guarded by SUPER_ADMIN.
3. Add public/authenticated decision APIs and authenticated metadata enforcement.
4. Add App Updates to active-client actions in the super admin dashboard.
5. Verify version boundaries, tenant isolation, stale/concurrent edits, publication confirmation, response envelopes, and UI workflows.
6. Deliver [Flutter handoff](app-update-handoff.md); deploy with no enabled policies and coordinate mobile rollout before enforcement.

## Super admin workflow

Open **Platform dashboard → Clients → active client's App Updates**.

Create a policy by choosing Rider/Fleet Manager, Android/iOS, the installed package/bundle ID, and Production/Test. The identity cannot be edited after creation; create a separate policy to change it. Configure minimum/latest releases, store link, title/message, and optional notes. Policies start disabled in the form.

Save Draft does not affect mobile checks. Use Preview to evaluate an installed release against the current form, including unsaved changes. Review Publication uses the **saved draft** and requires confirmation that the target release is available to affected users. Publication replaces the live snapshot atomically and clears the draft.

Disable Live Policy immediately publishes a disabled copy of the live policy. It retains any saved draft; republishing that enabled draft will re-enable the policy. Mobile server enforcement is uncached; the next protected metadata request sees the change. Offline/mobile UI caches can delay recovery by at most the contract's five-minute TTL.

History shows the latest 50 changes with actor name/time and release thresholds. All historical revisions remain stored. Restore Revision stages that historical snapshot as a draft, replacing an existing draft. It does not change live behavior until published separately. Unsaved form edits must be saved or discarded before switching, publishing, restoring, or disabling.

Changes carry `expectedRevision`. New policies use 0; existing policies use the current row revision. Stale edits return 409 `APP_UPDATE_POLICY_CONFLICT`; reload before retrying. Audit and history writes are in the same transaction as policy changes. A lost response can follow a committed write; the UI requires reload rather than blindly retrying.

## Management API

All paths below are prefixed `/api/v1/platform/clients/:clientId/app-updates`. Require a SUPER_ADMIN bearer token (browser UI uses the existing authenticated cookie gateway).

- `GET /`: list policies with their draft/live snapshots and latest 50 history entries.
- `PUT /draft`: `{ appCode, platform, applicationId, channel, expectedRevision, settings }`; creates or replaces the draft for the exact identity.
- `POST /preview`: `{ appCode, platform, applicationId, channel, installed, settings }`; read-only decision preview, HTTP 200.
- `POST /:id/publish`: `{ expectedRevision, releaseAvailable }`; publishes saved draft. `releaseAvailable: true` is required for enabled policies.
- `POST /:id/disable`: `{ expectedRevision }`; disables the published snapshot, retaining any draft.
- `POST /:id/restore`: `{ expectedRevision, sourceRevision }`; copies history to draft.

`settings` contains `enabled`, `minimum: { version, build }`, `latest: { version, build }`, `storeUrl`, `title`, `message`, and `releaseNotes` (empty string permitted). Response envelope is `{ data: ... }`. Writes follow existing Nest defaults: PUT 200, POST 201 except preview/check endpoints (200). No scheduling, bulk publication, app-store availability verification, global fallback, per-version adoption telemetry, custom APK distribution, or localization variants are included.

Validation requires ordered release thresholds, bounded numeric metadata, nonblank title/message, and HTTPS store URLs. Android URLs must point to the configured package ID. Apple URLs must point to a numeric App Store listing; the server cannot verify the listing's bundle ID or release availability. The admin must verify both.

## Deploy and recover

Migration: `apps/api/prisma/migrations/20261123090000_app_update_policies/migration.sql`.

Use the normal target-environment deployment pipeline to apply `prisma migrate deploy`, generate the Prisma client, build/deploy the API, and build/deploy the web panel. Apply the migration before routing traffic to the new API. This change does not auto-run migrations against a developer or production database.

No pre-existing data is changed and no policies are seeded. Existing requests without mobile metadata continue working. For application rollback, leaving the additive policy tables in place is safe; do not drop revision history as part of emergency rollback. Disable a live policy from the admin UI for immediate server-side recovery.

The global update interceptor runs after authentication/authorization guards and before handlers. It does not change refresh/logout/public login behavior. Update checks are uncached and return `Cache-Control: no-store`. Metadata requests perform one indexed policy lookup. Any future cache must include the complete identity and provide prompt cross-replica invalidation on publish/disable.

The database migration includes client FK, unique identity, enum-like checks, and policy revision uniqueness. Policies use compare-and-swap revision updates so conflicting publication/edit operations cannot silently overwrite each other.

See [Flutter handoff](app-update-handoff.md) for the exact response schema, six request headers, 426 envelope, offline behavior, limitations, and mobile acceptance criteria.

## Verification performed

- 41 policy, validation, controller, interceptor, and error-envelope unit tests passed.
- Four HTTP boundary tests passed using Fastify injection, including SUPER_ADMIN authorization, nested request validation, public access, and the 426 payload.
- Four integration tests passed against a dedicated temporary PostgreSQL instance using the actual migration: lifecycle/tenant isolation, concurrent edits, concurrent first creation, and transactional rollback when audit recording cannot complete.
- Swagger regression test passed, including public check authentication and management endpoint tagging.
- API TypeScript checks and production build passed. Web TypeScript/build, focused component lint, and the 25 existing web tests passed.
- Full API suite: 1,534 passed in the sandbox; four existing HTTP/TLS tests initially could not bind localhost and all four passed when rerun with localhost access. Environment-dependent integration suites were skipped in that broad run; the four app-update database tests were run separately as described above.
- Browser smoke test against the actual new component with mocked API responses passed: create/save, preview, publication confirmation, publish, disable, restore, dirty-edit protection, 409 recovery, closing after save, and narrow-screen overflow checks.

Run the focused backend tests from `apps/api` with `pnpm exec vitest run test/app-updates test/swagger.spec.ts`. Set `APP_UPDATE_TEST_DATABASE_URL` only to a disposable localhost database named `app_update_test_*` on a nondefault port to enable the database tests. Without it, those four tests skip. They create a minimal Client/User/AuditLog baseline and apply the new migration in that isolated database; never point them at an application database.

Deployment remains pending. Verification did not modify the running application database or either Flutter workspace.
