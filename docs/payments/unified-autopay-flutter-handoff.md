# Unified AutoPay — Flutter team handoff

Updated 22 November 2026: both standalone setup and onboarding activate wallet funding after verified provider authorization, with no separate consent checkbox or enable call. Backend checkout contract updated in this change; rollout remains gated by server configuration. The user confirmed Flutter is updated and authorized removal of legacy routes. This does not replace staging device acceptance. Read alongside `unified-autopay-implementation-plan.md`. This is the authoritative AutoPay contract; the old wallet handoff is superseded. No message has been sent to the team.

## Product behavior

Expose one shared AutoPay state across onboarding, Payments and Wallet. Onboarding enrolls through checkout; later preference controls live in Payments/Wallet. Rentals links to the same control and shows status; it must not have a second rent debit setting. AutoPay adds money when available cash is below the server policy threshold; rent/approved deductions and settled earnings appear in the unified statement. Disabling AutoPay does not stop rent accounting or switch to direct rent debit.

Display server values, initially ₹550 threshold and ₹750 recharge. Exactly ₹550 does not trigger. Cash, restricted rewards, deposit and unpaid dues remain distinct. Do not implement debit scheduling or balance-trigger logic in Flutter. Funding is asynchronous and subject to the server-provided notice/cooldown. Manual Add Money remains available.

## Flutter scope

The local Flutter checkout is stale and was excluded. Apply this contract to the team's current onboarding checkout, shared payment repository and AutoPay state provider. No Flutter source was changed and no message was sent to the team.

## Implemented API contract

Prefix `/api/v1`, existing bearer/client context, `{ "data": ... }` envelope, decimal INR strings and UTC ISO timestamps.

- `GET /rider-app/autopay`: authoritative state and current terms.
- `PUT /rider-app/autopay`: optional explicit Off/On control only. Body is `{ "enabled": true | false, "expectedRevision": n }`. Never call it automatically after setup or payment. The backend chooses an eligible wallet-funding mandate. Use `expectedRevision` from GET `revision`; stale updates return HTTP 409. Removed `mandateId`, `consentRevision` and `consentVersion` input fields are rejected.
- `POST /rider-app/autopay/mandates`: setup with `{ "email": "rider@example.com" }` and a stable Idempotency-Key (8–120 letters, digits, colon, underscore or hyphen).
- `POST /rider-app/autopay/mandates/:mandateId/verify`: provider verification after authorization/resume.
- `POST /rider-app/autopay/mandates/:mandateId/cancel`: distinct bank mandate cancellation, idempotent.
- `GET /rider-app/autopay/recharges`: paginated attempts. Pending summary is also available in the main resource.

Main resource contains: saved enabled preference; effective status; collection mode; policy threshold/rechargeAmount/consentRevision and timing terms; accepted consent revision; mandate summary including status/maximum/expiry; permitted actions; stable blocking reason; pending recharge summary; preference revision. Backend owns effective status; Flutter must not recompute it by combining independent booleans from three endpoints. The effective status names below are implemented wire values.

Capabilities v2 should contain only AutoPay support, supported enrollment entry points and a stable unavailable reason alongside existing necessary checkout capabilities. Terms, mandate details and rider state come from GET AutoPay. Do not render a settings panel from raw feature flags. Only capabilities v2 is supported; do not treat malformed/network-error responses as disabled.

## UI states and actions

- OFF: show Enable AutoPay; history remains available.
- SETUP_REQUIRED / AUTHORIZATION_PENDING: launch or resume mandate authorization and verify; no success banner yet.
- ACTIVATION_PENDING: bank mandate is approved; wallet activation is pending/retrying. Show “Finishing AutoPay setup” and a Check status action. Refresh with bounded backoff; never automatically send PUT. A later rider disable suppresses recovery and returns OFF.
- Older fixed-policy enrollments can require ACTION_REQUIRED after policy changes; do not invent a consent checkbox or silently upgrade their authorization.
- WAITING_FOR_ALLOCATION: setup saved, no funding before active allocation.
- ACTIVE: show one enabled control and funding terms.
- PAUSED_BY_CLIENT / MANDATE_ACTION_REQUIRED: show server reason and permitted recovery; retain user's saved preference.
- MIGRATION_BLOCKED: existing collection must resolve; do not create another payment.
- ACTION_REQUIRED: show failure/review explanation and manual top-up, with no blind automatic retry.

Request states remain distinguishable: CREATING, PENDING, UNKNOWN, REVIEW_REQUIRED, SUCCESS, FAILED, CANCELLED. UNKNOWN means payment outcome is not established. REVIEW_REQUIRED may follow an earlier credit; never remove that credit in UI. SUCCESS refreshes authoritative balance and statement. Unknown future enums show a safe pending/review message rather than success.

## Both entry points

Existing rider: fetch capabilities and unified resource → display `setupTerms.description`, configured amounts, maximum and expiry → POST mandates with email and a stable key → display the returned `walletFundingTerms` and mandate limits before opening authorization → provider approval → POST verify → GET authoritative status. No consent payload or PUT. If another invoice collection is pending, show the blocking reason and wait. An existing OFF wallet enrollment may use explicit PUT On. A historical mandate without wallet scope is not automatically enabled; cancel/re-enroll through the supported flow.

Onboarding uses provider authorization in the combined checkout; see the detailed onboarding flow below. No separate checkbox, consent payload or PUT enable call is required.

Suggested copy: “Automatically add ₹750 when my available cash is below ₹550. Bank confirmation is required. A submitted debit may still complete after I turn AutoPay off or add money manually.” Also display server notice/cooldown, mandate limit/expiry and applicable policy terms. Explain actual authorization charges from the setup response; do not call them wallet recharge or promise a refund.

Off and Cancel bank mandate are different actions. Off stops new funding requests. A confirmed physical vehicle return turns AutoPay off when the rider has no other active allocation; requesting a return or exchanging a vehicle does not. The mandate remains stored. Neither action promises cancellation of an already-submitted or uncertain debit. Show outstanding requests after turning off or returning the vehicle.

## Reliability and compatibility

Keep one idempotency key per setup/cancel attempt across retries; create a new key only for a genuinely new operation. Refresh on authorization return, app resume, notification tap and successful settlement. Poll visible pending states with bounded backoff and stop in background. Notifications prompt a fetch; SDK callbacks never credit the wallet.

On conflict, refresh policy/status and show the backend reason; do not repeatedly submit preference writes. Preserve manual checkout and its API contracts. Pending automatic debit must be disclosed before manual top-up. Reuse one shared AutoPay provider across Wallet, Payments, Rentals and onboarding to avoid stale conflicting displays.

Legacy mandate and wallet preference routes have been removed. Only the unified APIs are supported. Do not retry retired endpoints after errors. Old application builds must be upgraded before this backend cleanup is deployed.

## QA and release checklist

Test both enrollment paths; adequate existing mandate; wrong/expired/revoked mandate; app killed during authorization; policy changes within/above the mandate maximum; stale preference write; client-disabled policy; inactive allocation/return; low cash with high rewards/deposit; ₹550 boundary; recharge success/failure/unknown/review; late capture; manual top-up during pending; disable during pending; refund/reversal; pagination; all localizations and accessibility labels. Assert retired routes return 404 and that the supported Flutter build never calls them.

Staging QA build comes before production rollout. Capture app build, backend SHA, sanitized request/response fixtures and reconciliation evidence. Use the implemented payloads below and the updated OpenAPI operation inventory for integration; capture end-to-end fixtures during staging signoff. Production readiness requires full-cycle staging acceptance and a supported-app rollout plan; this backend release requires the updated Flutter app.

## Integration payloads and rollout

Negotiate the compact capability contract with `GET /api/v1/rider-app/payments/orders/capabilities?version=2`. No version also returns v2. Version 1 and unsupported versions return 400. V2 removes mandate methods from checkout purposes and exposes `autoPay.supported`, `enrollmentEntryPoints` and `reasonCode`. It is policy-based availability, not a live bank health check.

Optional explicit later On action (not part of either enrollment flow):

```json
{
  "enabled": true,
  "expectedRevision": 0
}
```

Disable payload is `{ "enabled": false, "expectedRevision": 1 }`. Preference revisions are examples: always use GET values. GET returns `revision`, `effectiveStatus`, `reasonCode`, `actions`, `setupTerms`, `policy`, `mandate`, and the existing funding timing/balance fields. Policy revision is `policy.revision`. Authorization links are exposed as `mandate.authorization.url` while pending; setup and verify responses retain the existing mandate response shape. `setupTerms` contains package maximum/validity when available and the variable-policy description. Display the description: the company can change threshold/recharge values within the approved mandate maximum; debit notice and cancellation protections remain. Standalone setup responses return immutable `walletFundingTerms` (policyTerms, description, threshold, rechargeAmount, revision). Historic mandates may have null terms. Internal accepted policy revision fields remain audit information, not fields the app must send. Recharge history uses `{ items, page, hasMore }`, 30 per page; GET also includes the latest 30 attempts as `requests` for the current status screen.

Onboarding uses the combined flow below. Outside the rollout allowlist, new AutoPay enrollment is unavailable; ordinary deployment payment and recovery of existing attempts remain available.

### Onboarding: implement this flow

1. Read capabilities v2 and `GET /rider-app/autopay`. Use the server's supported onboarding entry point and configured values; do not show a separate AutoPay checkbox/switch.
2. Create the combined order with a stable key. All requests use the existing rider authentication/client context.

```http
POST /api/v1/rider-app/payments/orders
Idempotency-Key: onboarding-autopay-<stable-uuid>
Content-Type: application/json
```

```json
{
  "purpose": "DEPLOYMENT",
  "allocationId": "<allocation-uuid>",
  "setupAutoPay": true,
  "email": "rider@example.com"
}
```

**Omit `autoPayConsent` entirely. Do not send a synthetic `accepted: true`. Do not call `PUT /rider-app/autopay` after success.** The old optional consent payload remains accepted/validated for compatibility; new builds must use the payload above.

3. Read the order's immutable response terms before opening the provider checkout. `data.autoPay.terms` contains `threshold`, `rechargeAmount`, `revision`, `validityDays`, `policyTerms`, `description`; amounts are decimal INR strings. `data.autoPay.maxAmount` and `expiresAt` describe the mandate. Show, for example: “Pay and enable AutoPay. Recharge ₹750 when your wallet falls below ₹550.” Render actual returned values, including maximum/expiry, rather than hard-coding the example. If creation returns different terms than the prior screen, show the updated terms before proceeding. Historic orders may have null `terms` fields; refresh status/support recovery rather than inventing amounts.
4. Launch using `data.checkout` exactly: Razorpay `orderId`, `keyId`, `amountPaise`, `customerId`, and `recurring: true`. Map these into the team's supported SDK keys. A non-recurring fallback cannot authorize a mandate. Confirm SDK/provider combined-flow support on staging devices.
5. Submit `{ "razorpayOrderId": "...", "razorpayPaymentId": "...", "razorpaySignature": "..." }` to `POST /rider-app/payments/orders/:paymentRequestId/verify`; use `POST /rider-app/payments/orders/:paymentRequestId/reconcile` when the SDK response is missing or the app resumes. Fetch order detail and `GET /rider-app/autopay` after verification. Provider callbacks are verified by the backend; app success alone is insufficient.
6. Display payment and AutoPay separately. Order `status: SUCCESS` confirms payment only (internal deployment payment status is `PAID`). `autoPay.status: AUTHORIZATION_PENDING` means authorization is still pending. `autoPay.status: ACTIVE` confirms the mandate, while main AutoPay `effectiveStatus` confirms whether wallet funding is active/awaiting allocation. Only show “AutoPay enabled” for `ACTIVE` or `WAITING_FOR_ALLOCATION`. If mandate is active and `effectiveStatus` is `ACTIVATION_PENDING`, refresh with bounded backoff; after the waiting window show “Payment received; AutoPay setup needs attention” with a refresh/retry-status action, not a second payment or automatic PUT.
7. For rejected/cancelled/expired mandate, show payment success if payment succeeded and AutoPay setup failure separately. Do not charge the onboarding amount again just to retry AutoPay. Subsequent enrollment is the standalone setup flow. Preserve rider disable/cancel actions; background retries must never turn it back on.

Poll only while the screen is visible (for example 2, 4, 8, then 15-second intervals, bounded to two minutes); stop in background and refetch on resume. The backend retries missed activation every minute, but persistent failures or an inadequate mandate can require rider/support action. OFF reflects a saved rider choice; do not treat it as permission to auto-enable. Reuse the same request key/body for network retries of the same checkout; changing the request body under that key returns conflict.

### Onboarding QA acceptance

- No consent checkbox and no PUT enable request in the normal onboarding network trace.
- Confirmed payment plus confirmed mandate activates funding automatically.
- Paid payment with pending/failed mandate never shows AutoPay active.
- App termination before callback recovers through server reconciliation.
- Repeated callbacks/verification do not create another mandate or rewrite preference revisions.
- Later disable or another preference revision cannot be overridden by delayed activation.
- Explicit new setup can replace a preference attached to a cancelled mandate. Retries retain the original timestamp/revision and activate once.
- For new variable-policy enrollments, policy changes within the mandate maximum do not ask for fresh consent. Above-limit changes show MANDATE_ACTION_REQUIRED; pending debits keep their original policy revision guard.
- Snapshot terms are shown before SDK launch, and SDK receives recurring/customer parameters.
- A subsequent wallet recharge credits the ledger once; it does not debit rent directly.

Apply additive migration `20261122090000_autopay_setup_activation` before deploying the backend to staging, then test the current Flutter build. It adds durable setup/activation tracking and does not backfill or automatically enable historical mandates. Record backend SHA, app version, sanitized checkout/mandate IDs and final states before production promotion.


Operations must set both `UNIFIED_AUTOPAY_ENABLED=true` and the exact client UUID in `UNIFIED_AUTOPAY_CLIENT_IDS`, with the existing Razorpay/payment readiness prerequisites satisfied. Removing the client or switching the flag off blocks new unified funding; reconciliation and ledger settlement continue. Do not use the environment flag as an app-side feature decision.

Removed route families: `/rider-app/payments/autopay`, `/rider-app/wallet/autopay`, `/client/wallet-autopay-policy`, and `/client/deployment-autopay-policy`, including their child routes. There are no compatibility aliases. Admin recharge history/verification now uses `GET /client/autopay/recharges` and `POST /client/autopay/recharges/:id/verify`. Existing client operations history, payment webhooks and submitted-payment reconciliation remain available.

### Standalone QA acceptance

- Email-only POST → provider approval → verify → GET yields ACTIVE or WAITING_FOR_ALLOCATION; network trace has no PUT.
- Closing the app after approval is recovered by provider reconciliation and the every-minute activation job.
- Disable while authorization/activation is pending remains OFF after delayed callbacks and retry.
- Repeated verify/recovery increments the preference revision only once.
- A new mandate replaces an older cancelled mandate only if the original preference revision still matches.
- Client/rollout pause, unresolved legacy debit, cancelled/expired/wrong-currency/undersized mandate never activates funding.
- GET is read-only. Persistent ACTIVATION_PENDING offers Check status/support, not another charge or automatic enable.
