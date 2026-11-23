# Flutter push notification integration

Status: Phases 1–13 implemented/locally validated: catalog, Firebase routing, inbox relevance, authenticated preferences, installation lifecycle, topic reconciliation, web composer/topic controls, platform catalog administration, scheduling, allocation/return event producers, administrator test sends and release hardening. Deploy migrations/API before integration; Flutter implementation and device acceptance remain outstanding.

Flutter implementation is owned by the Flutter team. No Flutter source changes are part of this workstream.

## Available after the foundation migration and catalog seed

`GET /api/v1/app/notification-catalog?application=RIDER`

Requires the existing access-token bearer authentication and an authenticated client context. Supported notification application values: `RIDER`, `FLEET_MANAGER`, `TEAM_LEADER`, `ADMIN`.

The API checks application compatibility against the authenticated role. `TEAM_LEADER` maps to the existing `TEAM_LEAD` account role. `ADMIN` denotes the dashboard application, not a new account role or a privilege grant.

Response example (abbreviated):

```json
{
  "data": {
    "catalogVersion": 1,
    "application": "RIDER",
    "groups": [{
      "code": "PG01",
      "name": "General & Communication",
      "categories": [{
        "code": "PG01_GENERAL_NOTIFICATIONS",
        "name": "General Notifications",
        "description": "Notifications about general notifications.",
        "defaultPriority": "NORMAL",
        "defaultDelivery": "TOPIC_ELIGIBLE"
      }]
    }]
  }
}
```

`catalogVersion` identifies the response contract, not a revision or caching token. Only active groups/categories with an allowed mapping are returned. Empty groups are omitted. TOPIC_ELIGIBLE is policy metadata: it does not authorize a client to subscribe itself or promise topic delivery. No automatic subscriptions are implemented in Phase 1.

Errors use the existing API error envelope: invalid application is 400; missing/expired authentication is 401; incompatible role or unavailable client context is 403. Use existing authentication refresh behavior. Do not interpret a temporarily empty catalog before seeding as permission to manufacture category codes.

## Existing contracts preserved

- `PUT /api/v1/app/push-devices`: installationId, appCode (`RIDER_APP`, `FLEET_MANAGER_APP`, or `TEAM_LEADER_APP`), platform (`ANDROID` or `IOS`), token. Requires an authenticated session.
- `DELETE /api/v1/app/push-devices/:installationId`: unregister the current session's installation.
- `GET /api/v1/app/notifications`: cursor-based inbox pagination.
- `GET /api/v1/app/notifications/unread-count`.
- `PATCH /api/v1/app/notifications/:id/read`.
- `POST /api/v1/app/notifications/read-all`.

The new catalog application values do not replace the existing device appCode values. Team Leader registration requires the TEAM_LEAD role (added in Phase 2).

Current FCM payloads retain title/body and string data containing notificationId, messageId, userId and clientId. The submission penalty producer also uses route=SUBMISSION_PENALTY_PAYMENT and invoiceId; wallet attention uses screen=wallet and rechargeId. Treat current payload navigation gaps as Flutter handoff work, not as a newly implemented route contract.

## Planned next contracts — do not integrate yet

Still pending: anonymous marketing consent/history/delivery and versioned action adoption across legacy producers. Phase 10 defines schemaVersion/action for allocation and return events. Phase 6 below implements authenticated topic reconciliation/status. Authenticated preferences are specified in Phase 4; enrollment, claim and token/permission updates in Phase 5 below.

Requirements for those phases:

- Scoped installation credentials for anonymous requests; installation UUID/FID/token alone are not authorization.
- Logged-out registered installations are not new users.
- No cross-account history or consent inheritance.
- Backend owns tenant, role, audience and topic decisions.
- Durable registration retry, token rotation, APNs readiness and permission-change handling.
- Foreground/background/terminated navigation, deduplication and safe unknown-action fallback.
- Per-flavor Android/iOS Firebase configuration; never ship service-account credentials.
- Device acceptance matrix covering two clients/projects, account switching, offline refresh, denied permission and consent withdrawal.

Backend contract tests do not replace Android/iOS testing. Flutter team must provide device-test evidence before end-to-end release sign-off.

## Phase 2 — per-client Firebase binding (implemented in source)

Device registration additionally accepts optional `applicationId` (Android package name / iOS bundle ID). Existing clients can omit it only when the authenticated client/app/platform/environment has at most one active binding. Multiple matches return 400 and require this field; an explicitly supplied unknown ID returns 400. Environment and project are server-controlled and cannot be selected in the request.

`TEAM_LEADER_APP` is now accepted for authenticated `TEAM_LEAD` users. Other roles cannot use it.

The registration response adds `pushBindingStatus: BOUND | UNCONFIGURED`. Existing unconfigured clients may register for compatibility, but are not sent through global Firebase credentials. BOUND indicates an eligible binding, not confirmed OS permission or successful FCM delivery. The API increments the device version on binding/platform changes, preventing delivery attempts queued for the old binding from using its replacement.

Flutter must re-register after the backend's client/app binding is provisioned. Existing unbound installations are not guessed or silently reassigned. Firebase app configuration on the device must match the project's registered package/bundle. Declaring applicationId is routing metadata, not cryptographic app attestation.

Enrollment and preferences are implemented in Phases 4–5 below. Phase 6 below implements authenticated topic reconciliation.

## GET notification API relevance design (implemented in Phase 3 below)

Current `GET /api/v1/app/notifications` already reads recipient rows using both authenticated client ID and user ID. It does not return all broadcasts or trust a user ID supplied by the caller. Phase 3 implements authenticated recipient relevance below. Installation lifecycle and authenticated preferences are implemented in Phases 4–5; anonymous marketing delivery remains future work:

- One server-side eligibility query is shared by list, unread count, single mark-read and mark-all-read. Apply visibility in the database before cursor pagination, never after fetching a page.
- Every message has immutable audience/app/category metadata and a visibility classification: personal history, operational/current-access, or general announcement. Existing recipient rows remain the first ownership boundary.
- Personal invoices, payments, penalties and rewards remain available to their owner after a hub/vehicle change, subject to client/account authorization. Do not remove financial history simply because current audience membership changed.
- Operational notices require current role/hub/fleet access where the message's visibility policy requires it. Removed staff assignments lose access to protected operational message content, not only its deep link.
- An optional app filter is validated against authenticated roles and allowed app mappings. It can narrow results, never grant a different application's notifications. Legacy requests without the filter retain authorized user-scoped history.
- Topic subscription alone never gives inbox access. Broadcasts resolve authorized recipients or visibility rules on the server. Joining a group later does not automatically expose old messages unless a specific announcement is intentionally published as available to current members.
- `visibilityExpiresAt` / withdrawal is distinct from push TTL. Push expiry does not erase inbox history. Catalog deactivation stops new sends and is not an automatic deletion of historical messages.
- Marketing consent/preference changes prevent future/queued marketing dispatch and update subscriptions. Historical visibility follows an explicit retention/withdrawal policy, not an accidental side effect of preferences.
- Deep-link access is independently authorized by the domain API even when the notification is readable. Payloads include only the data appropriate for the recipient.
- Logged-out/anonymous history will require a scoped installation credential and excludes previous authenticated-account notifications. Account switches never transfer history or consent.
- Mark-read on an ineligible/non-owned notification returns the existing not-found behavior. Mark-all-read updates only eligible rows up to a stable cursor/anchor.

Acceptance scenarios: another user/client; Rider versus Fleet Manager; role revoked; hub changed; returned/exchanged fleet; personal invoice retained; expired/withdrawn announcement; category deactivated; account switch; application filter tampering; stable pagination; unread count equals eligible unread rows; mark-all-read cannot affect hidden messages.

## Phase 3 — targeting and relevant inbox (implemented in source)

No Flutter code was changed. Deploy the targeting migration and API together before integrating these additions.

### App API changes

- GET /api/v1/app/notifications and GET /api/v1/app/notifications/unread-count accept optional application=RIDER|FLEET_MANAGER|TEAM_LEADER|ADMIN.
- PATCH /api/v1/app/notifications/:id/read accepts the same optional query parameter.
- POST /api/v1/app/notifications/read-all accepts optional application alongside existing throughId in its JSON body.
- Use the same application scope for list, badge count and read actions. A scope incompatible with the user's current database role returns 403.
- Inbox entries add nullable categoryCode and application. Existing cursor and response envelopes are preserved.
- FCM data includes categoryCode and application when present. These keys are server-owned; unknown/absent values require a safe client fallback.

All four inbox operations now share a database visibility predicate applied before pagination. Recipient ownership, tenant/account status, withdrawal and visibility expiry are always enforced. Hidden or non-owned rows return 404 for mark-read and cannot be changed by mark-all-read. An ineligible throughId also returns 404.

New manual notifications default to OPERATIONAL and recheck current audience membership; GENERAL announcements recheck application/role applicability too. Internal system events default to PERSONAL so invoices and payments remain readable after hub, fleet or role changes. Existing messages are migrated as PERSONAL because their original dynamic scope cannot be safely reconstructed. Push TTL does not expire inbox history.

### Sender API additions

POST /api/v1/client/notifications/preview and POST /api/v1/client/notifications accept audience values ALL_EMPLOYEES, ALL_TEAM_LEADERS and FILTERED in addition to existing audiences. Optional application, roles, hubIds, cities, fleetIds, vehicleTypeIds, oemIds and selectedUserIds narrow recipients. Values within a dimension are OR; dimensions combine with AND. IDs, not mutable display names, identify hubs, vehicles and OEMs; cities use trimmed case-insensitive matching.

Fleet/type/OEM filters apply to allocated riders. Hub/city uses the allocated fleet's current hub (home hub fallback); staff and unallocated riders use UserHub. ACTIVE and DEALLOCATION_INITIATED allocations qualify. All vehicle dimensions must match the same allocation.

Send additionally accepts categoryCode (requires an application and an allowed active catalog mapping), visibilityPolicy=OPERATIONAL|GENERAL and optional future visibilityExpiresAt. GENERAL rejects scoped role/location/vehicle filters. PERSONAL is reserved for internal event producers.

Fleet managers are limited to assigned hubs; their history/details expose their own broadcasts. Client admins retain tenant-wide access. POST /api/v1/client/notifications/:id/withdraw allows the original sender or client admin to withdraw a message, with audit and irreversible withdrawal. Content and targeting remain immutable.

Recipients are captured at send time. Joining a group later does not expose earlier broadcasts. Queued delivery rechecks current visibility and application/device compatibility before provider dispatch. Topic membership is not inbox authorization.

Phases 4–5 below add authenticated consent/preferences and installations. Phase 6 adds authenticated topic synchronization. Phase 7 below adds composer enhancements and topic controls. Anonymous delivery remains pending; Phase 8 below adds catalog administration. These additions do not replace device acceptance testing.


## Phase 4 — authenticated preferences and marketing consent (implemented in source)

Apply migration `20261123150000_notification_preferences` after the earlier notification migrations and deploy the API/generated Prisma client together. No Flutter code is included in this phase.

### Read preferences

`GET /api/v1/app/notification-preferences?application=RIDER`

Requires the normal access token. Application is required: `RIDER`, `FLEET_MANAGER`, `TEAM_LEADER`, or `ADMIN`. Authorization uses the current database role and active tenant/account, not a caller-provided user ID. The response is:

```json
{
  "data": {
    "application": "RIDER",
    "marketingEnabled": false,
    "categories": [
      { "categoryCode": "PG11_OFFERS", "mandatory": false, "pushEnabled": true, "effectivePushEnabled": false },
      { "categoryCode": "PG06_INVOICE", "mandatory": true, "pushEnabled": true, "effectivePushEnabled": true }
    ]
  }
}
```

The actual categories are the active, allowed catalog mappings for this application. `pushEnabled` is the category preference; `effectivePushEnabled` also includes marketing consent. It does not indicate OS permission, token readiness or confirmed delivery.

### Update preferences

`PUT /api/v1/app/notification-preferences`

```json
{
  "application": "RIDER",
  "marketingEnabled": true,
  "categories": [
    { "categoryCode": "PG01_APP_UPDATES", "pushEnabled": false }
  ]
}
```

The response has the same shape as GET. Only supplied fields/categories are changed; omitted preferences remain unchanged. Nulls and string booleans are invalid. Duplicate categories, unavailable mappings and attempts to disable essential categories return 400 without partial writes. Wrong application, user role or tenant scope returns 403; missing/invalid authentication follows the existing 401 behavior.

- Marketing defaults to **off**. Flutter must obtain affirmative user consent before submitting `marketingEnabled: true`; never set it automatically on login or registration.
- Consent and preferences belong to tenant + user + application. They are shared across that user's devices for the same application. Account switching must reload preferences; do not copy cached consent to another account/application.
- PG11 categories require consent even when their category preference is enabled. Per-category opt-out still wins after marketing opt-in.
- Essential policy currently covers PG06 finance, PG09 safety/compliance and PG02 account security, login alerts, mobile verification and OTP pending. Render these as mandatory, using the server response rather than a duplicated Flutter list.
- Preference changes are audited. Queued token delivery rechecks preferences and consent immediately before dispatch. A request already handed to Firebase cannot be recalled. Previously skipped messages are not automatically replayed after re-enabling.
- Preferences affect push delivery only. Inbox list, unread counts and read state retain their existing visibility/ownership rules and history.
- Existing uncategorized notifications retain existing behavior. Promotional producers must use a PG11 category and application; text content is not automatically classified. Existing audience preview counts describe audience/device reach, not consent-adjusted delivery guarantees.

Phase 5 below implements enrollment/claim and OS permission reporting. Phase 6 below implements authenticated topic reconciliation. User preferences are distinct from installation credentials and do not subscribe devices to Firebase topics.

## Phase 5 — installation enrollment and authenticated claim (implemented in source)

Apply `20261123160000_notification_installations` after the preceding four migrations. This introduces an installation record independent of a Firebase token and user account, while retaining the existing PushDevice delivery mechanism. Existing clients can continue authenticated device registration without enrollment; newly enrolled IDs require their installation credential. No Flutter implementation is included here.

### 1. Enroll before login

`POST /api/v1/app/notification-installations` (no access token)

```json
{
  "bindingId": "<configured notification app binding UUID>",
  "permission": "NOT_DETERMINED",
  "firebaseInstallationId": "<optional Firebase installation ID>",
  "token": "<optional FCM token>"
}
```

`bindingId` is public per-flavor configuration supplied during app provisioning. The backend derives tenant, app, platform, project and environment from the active binding. A suspended tenant/inactive or wrong-environment binding is unavailable (404). The binding ID is not an authentication secret or app attestation.

Response: `{ "data": { "installationId": "<server UUID>", "installationCredential": "<opaque secret>", "appCode": "RIDER_APP", "permission": "NOT_DETERMINED", "lifecycle": "UNREGISTERED" } }`.

Store the ID and credential together in platform secure storage. The server stores only the credential hash and returns the credential only at creation. Do not put it in analytics, URLs or logs. FCM token, Firebase installation ID and installation UUID alone never authorize access. Each successful enrollment creates a new record; retrying after a lost creation response creates another installation. Persist the successful response before using it. There is no secret-recovery endpoint; if secure storage is lost, enroll again and re-register after login. These routes use the existing IP rate limiter (20 requests/minute).

### 2. Read or update before login

`GET /api/v1/app/notification-installations/:id`

`PATCH /api/v1/app/notification-installations/:id`

Use `Authorization: Bearer <installationCredential>` on these routes, **not** a user access token. PATCH accepts optional token, firebaseInstallationId, permission and onboardingState. Omitted fields remain unchanged; nulls are invalid. Permission values: `NOT_DETERMINED`, `DENIED`, `AUTHORIZED`, `PROVISIONAL`. Onboarding values: `REGISTRATION_STARTED`, `REGISTRATION_INCOMPLETE`; these are client-reported progress, not account authorization.

Response exposes only installationId, appCode, permission and lifecycle. It never returns tokens, secret hashes, user IDs, inbox messages or consent. A previously claimed installation becomes `LOGGED_OUT` when its session is revoked/expired, account unavailable or it is explicitly unregistered. It cannot revert to a new-user lifecycle. Registration state is computed from current account/session validity rather than a stale stored status.

Registered installations must use authenticated APIs for updates (anonymous PATCH returns 409). Unknown/revoked installation or wrong/missing credential returns 401. DTO errors return 400.

### 3. Claim immediately after login, even without an FCM token

`POST /api/v1/app/notification-installations/:id/claim`

Use the **user access token** as Authorization. Body:

```json
{
  "installationCredential": "<securely stored credential>",
  "permission": "DENIED"
}
```

Permission is optional. Claim requires both installation proof and an active login session with the correct tenant/app role. It returns `{ "data": { "installationId": "...", "lifecycle": "REGISTERED", "permission": "DENIED", "pushRegistrationRequired": true } }`.

Claim records registration without depending on Firebase/APNs readiness. Changing account/session disables any previous device registration; claim never transfers an earlier account's token or preferences. Retrying claim for the same account/session preserves registration unless reporting denied/not-determined permission, which disables dispatch. `pushRegistrationRequired` instructs the client to complete/refresh device registration when a token is available; claim alone never enables delivery. Auth token refresh carries the installation association to the rotated session.

### 4. Register or refresh the authenticated device

Continue `PUT /api/v1/app/push-devices` with user access token. For enrolled installations include installationCredential and report permission along with the existing fields:

```json
{
  "installationId": "<enrollment ID>",
  "installationCredential": "<enrollment credential>",
  "appCode": "RIDER_APP",
  "platform": "ANDROID",
  "applicationId": "com.example.rider",
  "permission": "AUTHORIZED",
  "token": "<current FCM token>"
}
```

This also claims the installation atomically, so a separate claim can be skipped when a token is already available. Binding/platform/app must match enrollment exactly (403 on mismatch). Enrolled IDs cannot use the legacy credential-free path. Responses add lifecycle and permission for enrolled installations. Omitted permission preserves enrollment permission; legacy registrations retain their prior behavior when omitted.

Denied/not-determined permission deactivates push delivery. Authorized/provisional permission permits dispatch subject to all existing eligibility, consent and credential checks. Re-registration updates the token, binding and session; ownership/token/active-state changes invalidate queued work via device version. Flutter should call after login, token rotation and permission changes; when no token exists, use claim to report permission instead. Report OS permission accurately; this API does not request OS permission itself.

### 5. Logout, account switching and revocation

Use existing `DELETE /api/v1/app/push-devices/:installationId` with user access token before logout when possible. It now detaches enrolled ownership even for permission-disabled devices. Normal auth logout/revocation also makes the installation LOGGED_OUT through session validity. Keep the installation credential on ordinary logout so the same physical installation can later be claimed again. A new account must claim/register and reload its own preferences; neither history nor consent is inherited.

`DELETE /api/v1/app/notification-installations/:id` with the installation credential permanently revokes that enrollment, clears its token/Firebase ID/account association and disables/increments the corresponding device version. Subsequent credential access or claim returns 401. Revocation does not delete financial/inbox history. After revocation, use a new enrollment.

Anonymous installations are **not yet delivery recipients**. Anonymous marketing consent/history remain pending. Phase 6 below adds subscription APIs and reconciliation for authenticated devices. Do not subscribe to topics directly based on these lifecycle responses. Device acceptance still requires offline retries, cold-start/APNs readiness, denied permission, session expiry, account switching and two-tenant/two-project evidence.

## Phase 6 — backend-owned topic subscriptions (implemented in source)

Apply `20261123170000_notification_topics` after all preceding notification migrations, then deploy the generated Prisma client and API together. The feature has no entitlement/environment enable flag; PUSH_ENVIRONMENT remains the deployment namespace. Existing authenticated legacy registrations are reconciled too. Anonymous installations without an authenticated PushDevice are not subscribed by this phase.

### Ownership and names

Flutter must **not** call subscribeToTopic/unsubscribeFromTopic itself or manufacture topic names. The backend derives membership from current user role, active account/session/device, binding, allocation, preferences and consent. Topic definitions are created lazily in the database; Firebase creates a topic when the first subscription succeeds.

Logical groups include all_users, all_employees, all_riders, all_fleet_managers, all_team_leaders and rider-specific all_hub_<id>_riders, all_city_<normalized-city>_riders, all_vehicle_type_<id>_riders and all_oem_<id>_riders. Hub/vehicle/OEM IDs remain stable across renames. City values are trimmed and lowercased. Current/home-hub resolution and unallocated-rider UserHub fallback match recipient targeting. Values within the same dimension can produce multiple memberships when the underlying data contains multiple active allocations.

Physical names have the form `evseye_v1_<scope-hash>_<logical-key-hash>`. Scope includes environment, tenant, app code and exact app binding (including its platform/flavor). iOS and Android bindings therefore have separate physical topics even when the logical key is the same. This deliberately prevents cross-tenant/app/project collisions and does not expose display names in FCM topic names.

Category topics are limited to active allowed **PG01 general communication and PG11 marketing** mappings. PG11 requires explicit user/application marketing consent; category opt-out removes the corresponding category topic. Finance, safety, account-security and other transactional categories continue using token delivery. Broad role/location groups are not permission to send promotions: a future topic sender must enforce category consent as well as audience. This release adds no topic-send endpoint and does not change the existing token-based composer delivery.

### App status and synchronization

Both routes require the ordinary user access token and an existing device registration owned by that user and session:

- `GET /api/v1/app/notification-subscriptions/:installationId?appCode=RIDER_APP`
- `POST /api/v1/app/notification-subscriptions/:installationId/sync`, body `{ "appCode": "RIDER_APP" }`

appCode accepts RIDER_APP, FLEET_MANAGER_APP and TEAM_LEADER_APP. POST schedules durable desired membership and returns current local state; it does not wait for Firebase acceptance. Requests are rate-limited to 10/minute under the existing throttler. A missing/non-owned registration returns 404; a tenant mismatch returns 403. An installation credential alone cannot call these endpoints.

```json
{
  "data": {
    "installationId": "<UUID>",
    "appCode": "RIDER_APP",
    "subscriptions": [
      { "logicalKey": "all_riders", "state": "PENDING", "lastError": null, "lastAppliedAt": null }
    ],
    "synchronization": "EVENTUAL"
  }
}
```

States are PENDING, RETRYING or SYNCED. SYNCED means the last requested subscription operation was accepted by Firebase; it is not a device-delivery guarantee or a live remote membership query. The list contains desired memberships for the current token/binding/device version. Removal jobs and old-token cleanup can still be pending even when they are absent from this list. Tokens, physical topic names and credentials are not returned.

After successful device registration, Flutter can call sync once and read status when useful. Automatic reconciliation also runs without this call. Do not block login or app startup waiting for synchronization. Continue to re-register token/permission changes and use normal logout APIs; do not transfer one account's state into another account's cache.

### Reconciliation and failure behavior

The worker scans up to 50 due devices every 10 seconds, normally revisiting each at least once its last check is older than 60 seconds; backlog can extend this interval. Registration, preference changes, installation claim/revocation and topic activation mark affected registrations for early reconciliation. Role, hub/allocation, catalog, account and session changes are detected by the periodic scan. There is no instantaneous membership-revocation guarantee.

Topic operations are persisted before SDK calls. Database leases prevent concurrent ownership of the same operation; failed/crashed calls can be replayed. A desired-state change during a provider call remains pending after that call completes. Error backoff respects provider retry-after hints; missing credentials defer without consuming attempts. Invalid-token responses deactivate only matching token/binding registrations, so an old token failure does not disable a replacement token.

Token rotation, logout, permission denial, disabled bindings/projects, revoked installations and topic deactivation create unsubscription work using the original token and project binding. Retain the original project credential until cleanup completes. Disabled bindings remain usable for unsubscription, never for new subscriptions. Orphaned device memberships also get removal work. A revoked/invalid token can no longer be contacted; Firebase acceptance is still not proof of OS delivery.

Applied state is periodically reasserted every 15 minutes to repair uncertain or externally changed subscriptions. Removal records retain their token snapshots and are periodically reasserted too; automated retention/pruning is deferred rather than dropping cleanup evidence prematurely. The worker currently uses bounded single-token SDK calls; bulk tuning and a production-scale backlog/retention policy remain operational follow-up.

### Tenant administration

CLIENT_ADMIN only:

- `GET /api/v1/client/notification-topics` returns `{ data: { items, nextCursor } }`, up to 100 definitions. Pass `?after=<nextCursor>` for the next page. Items contain id, bindingId, logicalKey and isActive.
- `PATCH /api/v1/client/notification-topics/:id`, body `{ "isActive": false }`, disables a tenant-owned definition and schedules removal. Re-enabling allows eligible devices to rejoin. Changes are audited. Cross-tenant/unknown topic IDs return 404.

Phase 7 below implements the web composer and topic controls; Phase 8 below adds platform catalog editing. No direct arbitrary-topic creation or subscription editing is exposed to mobile users.

### Topic security and release checks

Topics are suitable for public announcements, not confidential authorization. Firebase clients can subscribe to existing names themselves; hashed/scoped names are collision isolation, not access control. Sensitive content and exact consent/eligibility enforcement continue through the token-targeted path and server-authorized inbox. Do not use Firebase console topic sends for confidential content or assume that audience topics enforce marketing consent.

References: [Firebase topic guidance and limits](https://firebase.google.com/docs/cloud-messaging/topic-messaging), [Admin SDK subscription management](https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions). FCM allows up to 2,000 topics per app instance and 1,000 tokens per subscription request; this implementation caps computed membership at 500 per device and uses one token per call.

Before rollout, test on real devices: login, app restart, current hub/vehicle changes, token rotation, permission denial/re-enable, logout, account switching, consent withdrawal, disabled bindings, two tenants sharing a project, and two independent Firebase projects. Verify both joins and removals. Anonymous delivery/consent/history, scheduling and event producer work remain pending. Phase 8 below adds catalog administration. Phase 7 below implements the composer and topic controls.

## Phase 7 — web sender UI integration

No Flutter code or mobile request contract changed in this phase. The web sender now uses the implemented application/category targeting, current-audience visibility, optional expiry and withdrawal APIs. A new staff-only `GET /api/v1/client/notifications/options` supplies active category mappings and tenant/sender-scoped hub, vehicle-type and OEM choices. It is not a mobile enrollment or topic-membership endpoint.

Web notifications default to OPERATIONAL visibility and include categoryCode/application. Continue using the Phase 3 inbox contract: a notification may disappear after assignment changes, visibility expiry or sender withdrawal. Do not reconstruct the inbox solely from cached push payloads. Financial events created by internal producers retain their existing PERSONAL policy.

Client admins can activate/deactivate groups through the web UI. Group changes reconcile asynchronously; Flutter should continue reading subscription status rather than directly joining topics. Topic list items now include binding appCode/platform/applicationId for sender-side display. Physical topic identifiers and tokens remain unexposed to the mobile subscription APIs.

The composer preview is an audience estimate, not a guaranteed push count. Marketing consent/preferences are still checked at dispatch. Scheduling, test-send workflow and anonymous delivery/history remain future phases. Phase 8 below adds catalog editing.

## Phase 8 — configurable platform catalog

No Flutter source changes are included. The existing mobile catalog response now includes `catalogRevision`, a deterministic SHA-256 digest of its visible groups/categories. `catalogVersion: 1` still denotes the response schema, not the latest administrator edit. Refresh the catalog at appropriate app entry/preferences flows and compare catalogRevision; do not assume version 1 means the contents never change.

Platform administrators can now change category names/descriptions, activity and allowed applications, or disable a whole parent group. New categories have stable codes within the existing PG01–PG12 groups. Flutter must handle unfamiliar category codes safely, render supplied labels and avoid hardcoding the seeded category list. A mapping change does not grant a role or consent.

Deactivated categories/mappings disappear from applicable catalog/preferences choices and leave category topics through normal reconciliation. Existing inbox history is not automatically deleted; a specific message's ownership, visibility expiry and withdrawal still determine readability. Already queued token messages may still be delivered under their existing policy. Parent reactivation does not reset individual category settings or user preferences.

Platform API contract (SUPER_ADMIN only, never an installation credential):

- GET `/api/v1/platform/notifications/catalog`: all groups, categories and explicit application mappings, including inactive rows and updatedAt values.
- POST `/api/v1/platform/notifications/catalog/categories`: code, parentCode, name, description, isActive, applications. Example code `PG11_SEASONAL_OFFERS` must match parentCode `PG11`. Applications is an explicit list of RIDER, FLEET_MANAGER, TEAM_LEADER and/or ADMIN; an empty list disables targeting for all applications. New categories use NORMAL priority and TOKEN delivery.
- PATCH `/api/v1/platform/notifications/catalog/categories/:code`: name, description, isActive, applications and expectedUpdatedAt copied from the reviewed row. Code, parent and delivery policy cannot be changed.
- PATCH `/api/v1/platform/notifications/catalog/groups/:code`: isActive and expectedUpdatedAt. Child category/mapping settings are retained.

Missing rows return 404, invalid fields return 400, stale edits/duplicate code or parent-scoped names return 409, unauthorized roles return 403. On a stale edit, reload and review the current record; do not blindly overwrite with a fresh timestamp. Changes are audited globally and apply to all clients. These administration routes are not needed in the Flutter apps.

## Phase 9 — scheduled notifications (backend and web)

Flutter does not schedule local notifications for these messages. The backend releases scheduled messages into the existing push/inbox flow at or after their release time. Existing push payload and inbox contracts remain compatible.

- Future messages are absent from inbox, unread counts, read and read-all APIs. Do not infer future messages from sender history or fabricate local inbox entries.
- Recipients are captured when the sender schedules the message. Joining a group later does not add the user; current relevance and push consent/preferences are rechecked.
- Inbox creation timestamps represent release time for scheduled messages. Push TTL starts then. OS/Firebase/worker delays can make delivery later.
- Withdrawal hides the message and stops unsent work. Previously displayed OS notifications cannot be recalled.
- Reuse existing foreground, background, cold-start and inbox refresh behavior. No client topic subscription or local timer is required.
- Acceptance: verify no early inbox/count/push, release after restart/offline reconnect, recipient hub/role change before release, consent withdrawal, expiry and cancellation.

Sender API (web/admin): optional `scheduledFor` ISO timestamp with timezone, one minute–90 days ahead; `visibilityExpiresAt` must be later. History/details include `scheduledFor` and SCHEDULED status. Existing withdrawal cancels; schedule editing is unsupported. Apply migration `20261123180000_notification_scheduling` before releasing the updated backend.

## Phase 10 — allocation and return events

Backend now produces rider-only notifications for REQUESTED, ACTIVATED, RETURN_STARTED and RETURN_COMPLETED. ACTIVATED is emitted from both handover implementations. Return completion does not mean billing or deposit settlement is complete.

These messages use PG04_VEHICLE_ALLOCATION, PG03_VEHICLE_HANDOVER or PG03_VEHICLE_RETURN and PERSONAL inbox history. Existing per-user/application authorization and dispatch preferences remain enforced. Existing historical allocations are not backfilled.

New event data (all FCM data values are strings):
```json
{
  "schemaVersion": "1",
  "action": "ALLOCATION_DETAILS",
  "event": "ACTIVATED",
  "allocationId": "<allocation-id>"
}
```

The existing notificationId/messageId/userId/clientId fields remain supplied by the dispatcher. Flutter should handle this action after authentication in foreground/background/cold-start flows, using the current account's authorized allocation data. Do not trust a push ID or clientId as authorization. If historical allocation details are unavailable, open notification history; unknown versions/actions should also fall back safely. Deduplicate using notificationId.

Device acceptance: initiation, handover from both supported workflows, return start/completion, duplicate event retries, category opt-out, disabled category, offline delivery and account switching. No local notification scheduling or direct topic subscriptions are needed. Other producers still use legacy navigation fields; this versioned action applies only to the new allocation/return events.

## Phase 11 — administrator test notifications

Web administrators can send an immediate test to one registered device. Tests use the ordinary push/inbox delivery flow; Flutter needs no test-send API integration.

- Title begins with [Test]. Data includes testNotification='true' and an opaque testDeviceId, alongside the existing notification/message/user/client IDs.
- The push goes only to the selected registration/version. The inbox entry belongs to the user and is visible on that user's other authorized sessions as normal.
- Permission denial, logout/session expiry, token rotation, category preferences and marketing consent still apply. A test does not bypass these checks.
- No navigation action is supplied; use the existing notification-history fallback.
- Sender confirmation means queued, not displayed. Device acceptance should check foreground, background and terminated states on Android/iOS. Verify that only the selected device receives the push, and that tests cannot cross tenant/app/account boundaries.

This feature does not send a broadcast, apply broadcast scheduling, or register a new device. Repeating an uncertain request uses the same key; the web sender explicitly starts a new test when another notification is intended.

## Phase 12 — release hardening

No Flutter API change is required. Sender history may now show EXPIRED when an active message's push TTL elapsed without any Firebase-accepted delivery. Push expiry alone does not erase the user's authorized inbox history. Withdrawn messages remain hidden as before.

Worker stages and project failures are isolated; stale topic planning is retried after a short delay. These changes do not promise immediate delivery or replace real-device acceptance. Use docs/runbooks/push-notification-release.md for the shared staging/device acceptance matrix. Production release remains pending full-schema/PostGIS, project credential, deployed API/browser and Android/iOS validation.

## Phase 13 — local release validation completed

The full-schema/PostGIS notification release gate now passes 201 tests with zero skips. All 35 repository migrations, the dedicated catalog seed and the web production build succeeded in a disposable local environment. This supersedes the Phase 12 local fixture/PostGIS blocker; no mobile contract changed.

Flutter implementation and real Android/iOS acceptance are still required. Production-data migration rehearsal, real Firebase/APNs configuration, deployed API/browser validation and sustained load testing remain separate gates.
