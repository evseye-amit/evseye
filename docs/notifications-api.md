# Firebase push notifications and app inbox

The API supports Rider and Fleet Manager push registrations, a persistent inbox
for every client user, client broadcasts, and notifications from business code.
All routes below have the `/api/v1` prefix and return `{ data }`. Authentication
uses the existing EVsEye bearer token; Firebase Authentication is not required.

## Configuration

Set the following server environment variables:

```dotenv
PUSH_ENABLED=true
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
PUSH_BATCH_SIZE=100
PUSH_TOKENS_PER_SECOND=100
PUSH_MAX_ATTEMPTS=6
PUSH_TTL_SECONDS=86400
```

Enable the Firebase Cloud Messaging HTTP v1 API in the project. The credential
needs Firebase Cloud Messaging sending permission. Google Application Default
Credentials are supported, including workload identity where available. For
Docker, mount the service-account file read-only at the configured **container**
path. Never commit that file or expose it to the web frontend. Both mobile apps
must be registered in this Firebase project; configure APNs for iOS.

Push is disabled by default. Without Firebase setup, messages still create inbox
entries. Device deliveries show `WAITING_FOR_CONFIGURATION` until configured or
the push lifetime expires. Expiration affects push only; inbox entries remain.
Enabling push later can send unexpired queued messages, so review pending messages
before enabling it in a real environment.

The worker uses a shared PostgreSQL dispatch lease and rate gate across API
instances. It processes at most 500 devices per Firebase SDK batch, with a
configurable lower batch size and rate. This is a device limit, not an audience
size limit. A user can have multiple devices. Manual phone input is separately
limited to 2,000 entries; All Users/Riders/Fleet Managers have no such UI list cap.

## Register, refresh and unregister an installation

`PUT /app/push-devices`:

```json
{
  "installationId":"<persisted-installation-uuid>",
  "appCode":"RIDER_APP",
  "platform":"ANDROID",
  "token":"<FCM-registration-token>"
}
```

`appCode` is `RIDER_APP` or `FLEET_MANAGER_APP`, matching the authenticated role.
`platform` is `ANDROID` or `IOS`. The server takes account/client/session identity
from the access token, never from the request body.

Generate and persist an installation UUID in the app. Call this API after login,
on Firebase token refresh, and periodically when the app opens. A registration
refresh updates its timestamp. Changed tokens or accounts increment the device
version; identical registrations are idempotent. Multiple installations per user
are supported. One active FCM token can belong to only one installation.

For account switching on the same installation, register under the new account;
the old binding and its pending deliveries cannot target the new account. For
logout, unregister with `DELETE /app/push-devices/:installationId` and call the
existing `/auth/logout`. Server logout also deactivates devices for that login
session. Authentication refresh transfers bindings to the newly rotated session;
apps do not need to re-register just because the access token refreshed.

An in-flight push cannot be recalled after logout/account switching. The app must
check `userId` and `clientId` in incoming push data against the current account
before handling/displaying it where platform behavior allows. Sensitive messages
should use generic notification text and retrieve details through authenticated
APIs. Clear old account notification UI on logout.

## Inbox and read status

- `GET /app/notifications?limit=20&cursor=<opaque-nextCursor>`
- `GET /app/notifications/unread-count`
- `PATCH /app/notifications/:id/read`
- `POST /app/notifications/read-all` with `{}` or `{"throughId":"<inbox-id>"}`

A list response contains `items` and `nextCursor`. Each item has `id`, `messageId`,
`title`, `body`, `data`, `source`, `createdAt` and `readAt`. The inbox ID is also the
push `notificationId`. Use the returned cursor unchanged. Pagination orders by
creation time and ID, newest first; newly arriving entries do not shift pages.

Read status is account-wide across devices. `throughId` marks that entry and
older entries read, preserving unread status for more recent arrivals. Ownership
and client checks apply to every read/update, including cursor anchors.

Users without devices receive inbox entries. One user gets one inbox entry even
when a notification is sent to several of their devices.

## Admin sending API

Client admins and operations managers can use these APIs and the **Notification**
menu after Support Tickets in the client operations panel. All targeting is
restricted to the authenticated client and active, non-deleted user accounts.
“All Riders” includes rider accounts still onboarding if their account is active;
it does not target unlinked rider profiles without login accounts.

`POST /client/notifications/preview`:

```json
{"audience":"PHONE_NUMBERS","phoneNumbers":"9876543210, +919123456789"}
```

Audiences: `ALL_USERS`, `ALL_RIDERS`, `ALL_FLEET_MANAGERS`, `PHONE_NUMBERS`.
All Users includes the client's active rider and staff accounts; platform admins
and other clients are excluded. Preview returns user/device counts, users without
devices, invalid entries, duplicates, unmatched numbers and `pushConfigured`.
Phone numbers accept canonical and legacy Indian formats, normalize/deduplicate,
and match existing users only. Sending rejects invalid or unmatched numbers;
preview lets the admin correct them before sending.

`POST /client/notifications`, with a stable `Idempotency-Key` of 8–150 characters:

```json
{
  "audience":"ALL_RIDERS",
  "title":"Hub service update",
  "body":"Please visit your assigned hub for the scheduled vehicle check."
}
```

Returns HTTP 202 with the saved broadcast. The audience is captured transactionally
at send time. Retrying with the same key and content returns that broadcast;
reusing the key for different content returns a conflict. Preview counts may
change before send because accounts/devices can change.

Title: 150 characters maximum. Body: 2,000 maximum. Combined content and custom
string data: 3,500 UTF-8 bytes, leaving room for server metadata under FCM's
4,096-byte payload limit. Multilingual content is counted in bytes as well as
characters. Data keys `notificationId`, `messageId`, `userId`, `clientId` and
Firebase-reserved prefixes are protected. Manual UI supports title/body; business
code can also supply navigation data using app-supported action names.

- `GET /client/notifications?limit=20&cursor=...` — paginated history and counts.
- `GET /client/notifications/:id` — content, counts and up to 100 recent failed,
  retrying or skipped device attempts, with user identity and safe error codes.

Statuses: `QUEUED`, `PROCESSING`, `WAITING_FOR_CONFIGURATION`, `COMPLETED`,
`PARTIAL`, `FAILED`. Counts distinguish inbox recipients, users/devices accepted
by Firebase, pending devices, failures, skipped attempts, no-device recipients and
inbox reads. COMPLETED with zero devices means inbox processing completed; it
must not be shown as confirmed device delivery. Firebase acceptance is not a
read/display receipt.

## Business service integration

Import `NotificationModule` where needed and inject `NotificationService`:

```ts
await notifications.sendToUsers(clientId, [userId], {
  title: 'Document review completed',
  body: 'Open the app to view the review result.',
  data: { action: 'DOCUMENT_REVIEW' },
}, `document-review:${reviewId}`, 'DOCUMENT_REVIEW');
```

For atomic business events, use `enqueueForUsers(tx, clientId, userIds, content,
eventKey, source)` inside the existing Prisma transaction. Use a stable event key
and uppercase source. This writes inbox/work records only; Firebase calls happen
later. Every supplied user must be active and belong to the client. Business
calls support up to 10,000 explicit IDs per event; use smaller event groups for
larger explicit lists. Manual group audiences are resolved directly in PostgreSQL.

The implementation provides the shared infrastructure; individual business
workflows can opt in through these methods rather than sending unsolicited
notifications from every existing event.

## Reliability and mobile handling

- Persistent work survives API restarts; expiring leases recover crashed workers.
- Failed/unregistered tokens are disabled. A late failure for an old token cannot
  disable a newly refreshed token.
- Temporary failures retry with backoff/jitter; accepted devices are not retried.
- Quota throttling delays the shared project queue; permanent failures are shown
  without repeated retry. Retries are bounded by attempts, one hour from the first
  attempt, and push expiration.
- A 45-second send timeout bounds a worker call. A network timeout can leave the
  Firebase outcome uncertain, so duplicate pushes remain possible. Deduplicate
  by `notificationId` in app handlers; Android tags and APNs collapse IDs help.
- The app should display the title/body once, fetch the inbox after receiving or
  opening a notification, and mark it read when the user opens it. Avoid a second
  local alert when the OS already displayed a background notification.

Tokens, credential material and raw Firebase error payloads are not included in
admin history. The worker records safe error codes instead.

## Verification

Use a **disposable** PostgreSQL database whose name contains `_test_`, apply all
migrations, then set `NOTIFICATION_TEST_DATABASE_URL` and run the notification
integration spec. It uses a fake Firebase provider and never sends real pushes.
The tests cover audiences, isolation, idempotency, token replacement/account
switching, 601-device batching, retry/throttling, invalid-token cleanup, inbox
pagination/read ownership, concurrent workers, lease recovery and expiration.
Real Android/iOS delivery still needs project credentials and device tokens.

Firebase references: [Admin SDK sending](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk),
[quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas),
[token management](https://firebase.google.com/docs/cloud-messaging/manage-tokens),
[error handling](https://firebase.google.com/docs/cloud-messaging/error-codes).
