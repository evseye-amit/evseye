# Client-controlled application updates — Flutter handoff

## Ownership and rollout boundary

The EVsEye backend and super admin web UI own update policies. The Flutter team owns all mobile code, package metadata extraction, update screens, lifecycle checks, and store navigation. No Flutter source is changed by this implementation.

Supported applications: `RIDER_APP`, `FLEET_MANAGER_APP`. Platforms: `ANDROID`, `IOS`. Channels: `PRODUCTION`, `TEST`. Policies are scoped by **client + appCode + platform + applicationId + channel**. There is no global fallback: missing, unpublished, and disabled policies return `allowed`. Drafts never affect mobile checks.

This first rollout is compatibility-preserving. Authenticated requests carrying all six mobile metadata headers are checked server-side. Requests carrying none remain compatible; requests with only some, or malformed metadata, fail validation. Headers are client-reported, not attested. Omitting metadata or reporting another application/channel can bypass this cooperative gate; do not describe this as a security boundary or use it to protect an API vulnerability. Existing installed apps cannot show the update screen until the Flutter team releases the integration. Strict legacy-build blocking requires a separate rollout decision and a reliable server-side mobile-session identifier.

## Release identifiers

Read the installed package's actual version and build metadata, not a hardcoded flavor version.

- `version`: exactly three numeric components, such as `1.10.0`. No prerelease suffix or leading zeroes. Each component is at most nine digits.
- Android `build`: positive integer `versionCode`, at most `2100000000`, serialized as a string. **Ordering uses build code only.** The version is a display label; even a higher version name with a lower build code is blocked.
- iOS `build`: one to three numeric components, such as `120` or `120.1.2`, with no leading zeroes and each component at most ten digits. At least one component must be positive. Ordering first compares the three version components numerically, then the build components. Missing trailing build components equal zero (`120` equals `120.0`). Build numbering can restart on a new version.
- `applicationId`: Android package ID or iOS bundle ID of the installed application. Exact, case-sensitive match.
- `channel`: compile-time release configuration; do not infer from the API hostname or let end users switch it.

Minimum and latest are independent thresholds. Below minimum is `required_update`; at/above minimum but below latest is `optional_update`; at/above latest is `allowed`. Minimum and latest can be equal, producing mandatory updates without optional prompts for supported releases.

## Before login: public check

`POST /api/v1/public/app-updates/check` — no bearer token required; HTTP 200 on success; `Cache-Control: no-store`.

```json
{
  "companyCode": "yogmaya",
  "appCode": "RIDER_APP",
  "platform": "ANDROID",
  "applicationId": "com.example.rider",
  "channel": "PRODUCTION",
  "installed": { "version": "1.0.0", "build": "10" }
}
```

The package ID is illustrative; use the actual store package/bundle ID. Resolve the client from the configured company code for branded apps. Universal apps check after company selection. The backend resolves the company code to an active client and checks consistency with any host-based client context. Unknown/unavailable clients return 404; a company/host mismatch returns 403. Do not send `x-client-host` or gateway secrets from Flutter.

## After login: authenticated check

`POST /api/v1/app-updates/check` with `Authorization: Bearer <accessToken>` — same body **without companyCode**, HTTP 200. The client comes from the authenticated account, not a caller-supplied client ID. Extra properties are rejected. This endpoint remains accessible to outdated versions.

Example response for either endpoint:

```json
{
  "data": {
    "clientId": "resolved-client-id",
    "appCode": "RIDER_APP",
    "platform": "ANDROID",
    "applicationId": "com.example.rider",
    "channel": "PRODUCTION",
    "installed": { "version": "1.0.0", "build": "10" },
    "policyRevision": 2,
    "checkedAt": "2026-11-23T00:00:00.000Z",
    "decision": "required_update",
    "minimum": { "version": "1.2.0", "build": "20" },
    "latest": { "version": "1.3.0", "build": "30" },
    "title": "Update available",
    "message": "Please update your app to continue.",
    "releaseNotes": "Reliability improvements.",
    "storeUrl": "https://play.google.com/store/apps/details?id=com.example.rider",
    "cacheMaxAgeSeconds": 300
  }
}
```

No published policy: `policyRevision` is null; decision is `allowed`; minimum, latest, title, message, releaseNotes, and storeUrl are null. A disabled policy also returns these null values but retains its published revision. An enabled policy returns its release/message fields even when the decision is `allowed`; only the decision controls the screen. `policyRevision` is scoped to one policy identity, not globally ordered.

## Headers and protected API enforcement

Send these six headers together on authenticated mobile API requests, in addition to the bearer token:

```http
X-App-Code: RIDER_APP
X-App-Platform: ANDROID
X-App-Id: com.example.rider
X-App-Channel: PRODUCTION
X-App-Version: 1.0.0
X-App-Build: 10
```

Use the API service base URL. The web panel's same-origin cookie gateway is for browsers; it does not forward mobile metadata.

For an outdated app, the server rejects the request **before the endpoint handler executes**, with HTTP **426**:

```json
{
  "error": {
    "code": "APP_UPDATE_REQUIRED",
    "message": "Please update your app to continue.",
    "issues": [
      {
        "clientId": "resolved-client-id",
        "appCode": "RIDER_APP",
        "platform": "ANDROID",
        "applicationId": "com.example.rider",
        "channel": "PRODUCTION",
        "installed": { "version": "1.0.0", "build": "10" },
        "policyRevision": 2,
        "checkedAt": "2026-11-23T00:00:00.000Z",
        "decision": "required_update",
        "minimum": { "version": "1.2.0", "build": "20" },
        "latest": { "version": "1.3.0", "build": "30" },
        "title": "Update available",
        "message": "Please update your app to continue.",
        "releaseNotes": "Reliability improvements.",
        "storeUrl": "https://play.google.com/store/apps/details?id=com.example.rider",
        "cacheMaxAgeSeconds": 300
      }
    ]
  },
  "requestId": "request-id"
}
```

The first `error.issues` element contains the same decision object as a check response's `data`. Handle this centrally, deduplicate simultaneous 426 responses, stop retry loops, and retain the session. Do not treat 426 as token expiry or log the user out. Do not automatically replay failed writes after an update.

The update-check endpoint, logout, and token refresh remain available. Public endpoints (including login), browser/legacy requests without metadata, and platform accounts without a client are outside this gate. Authentication and authorization failures may occur before update enforcement. Malformed/partial metadata returns 400 (`APP_METADATA_INVALID` for header shape/DTO errors); platform build-range errors also return 400. Policy lookup failures return the normal service error, never a fabricated `allowed` result for a protected operation.

## Flutter behavior to implement

1. Check on launch once client context is available, after login, after client selection/switching, and on foreground resume. Debounce duplicate checks; refresh at least when the five-minute cache expires. Keep the update check network path independent of any UI gate.
2. For `required_update`, show a full-screen, non-dismissible gate with title, message, optional release notes, Update Now, and Retry. Block back-navigation into the app. Preserve login/session state. Keep logout or company selection available where needed to recover a universal app's client context.
3. Open the supplied HTTPS store URL. Backend permits only the matching Google Play package URL or an Apple App Store numeric app listing. Mobile code should also allowlist the matching platform's store host. If navigation fails, keep Retry available and show a clear error.
4. Recheck on returning from the store; do not assume that opening the store installed an update. Resume normal use only after a successful allowed/optional decision or the documented offline cache expiry behavior.
5. For `optional_update`, show Update Now and Later. Suggested Later cooldown: 24 hours, keyed by the full policy identity and published revision. A newer mandatory policy always overrides dismissal.
6. Cache decisions separately by client ID, app, platform, package, channel, **and installed version/build**. Discard on client change/logout or installed-version change. Ignore late responses from a previous client/check generation. Keep cached restrictions for at most `cacheMaxAgeSeconds` from successful local receipt; prefer monotonic elapsed time within a process to avoid clock-change issues.
7. On a network timeout with no valid cache, allow normal startup and retry later; existing API authorization/offline behavior still applies. Within the cache lifetime, retain a cached mandatory gate with Retry. After expiry, do not trap the user indefinitely on a stale policy; retry and permit the normal offline/error path. A reachable server can still reject protected operations with 426. Never translate an explicit 426 into an allowed result.
8. Render server messages as plain text. This release stores one message per policy; it does not provide localized variants. Machine codes and decisions are stable identifiers.

## Acceptance checklist for the Flutter team

- Both applications, Android/iOS, branded and universal client selection.
- Below minimum, equal to minimum, between thresholds, equal to latest, and newer installed builds.
- Android build `9` versus `10`; iOS version `1.9.0` versus `1.10.0`; iOS build reset on a newer version.
- Recheck after returning from store without installing; invalid/unavailable store navigation.
- Cold start offline, cached mandatory policy online/offline, cache expiry, emergency server disable, and policy rollback.
- Client switch while a request is in flight; no cached policy leaks to another client.
- Central 426 handling across concurrent calls; no logout, repeated modal stack, token-refresh loop, or write replay.
- Public check works before login; authenticated check and logout remain accessible while blocked.
- Optional dismissal cooldown does not suppress a later mandatory update.

## Delivery sequence

Deploy backend migration/API and admin UI first; no policies are seeded. Flutter team integrates this contract and ships a metadata-capable release. Validate optional prompts for a pilot client, then verify the latest store release is available to **all** affected regions and rollout groups before publishing a mandatory minimum. Existing pre-integration builds remain outside reliable enforcement.
