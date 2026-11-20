# Unified AutoPay — Flutter team handoff

Updated 21 November 2026: onboarding uses provider authorization, with no separate consent checkbox or enable call. Backend checkout contract updated in this change; rollout remains gated by server configuration. The user confirmed Flutter is updated and authorized removal of legacy routes. This does not replace staging device acceptance. Read alongside `unified-autopay-implementation-plan.md`. This is the authoritative AutoPay contract; the old wallet handoff is superseded. No message has been sent to the team.

## Product behavior

Expose one shared AutoPay state across onboarding, Payments and Wallet. Onboarding enrolls through checkout; later preference controls live in Payments/Wallet. Rentals links to the same control and shows status; it must not have a second rent debit setting. AutoPay adds money when available cash is below the server policy threshold; rent/approved deductions and settled earnings appear in the unified statement. Disabling AutoPay does not stop rent accounting or switch to direct rent debit.

Display server values, initially ₹550 threshold and ₹750 recharge. Exactly ₹550 does not trigger. Cash, restricted rewards, deposit and unpaid dues remain distinct. Do not implement debit scheduling or balance-trigger logic in Flutter. Funding is asynchronous and subject to the server-provided notice/cooldown. Manual Add Money remains available.

## Flutter scope

The local Flutter checkout is stale and was excluded. Apply this contract to the team's current onboarding checkout, shared payment repository and AutoPay state provider. No Flutter source was changed and no message was sent to the team.

## Implemented API contract

Prefix `/api/v1`, existing bearer/client context, `{ "data": ... }` envelope, decimal INR strings and UTC ISO timestamps.

- `GET /rider-app/autopay`: authoritative state and current terms.
- `PUT /rider-app/autopay`: standalone enrollment/later preference changes only, never required by onboarding. Enable/disable, with expected preference revision. Enable includes `mandateId` and `consentRevision`; disable requires no renewed financial consent. Use `expectedRevision` from GET `revision`; stale updates return HTTP 409.
- `POST /rider-app/autopay/mandates`: setup with email/method and stable Idempotency-Key.
- `POST /rider-app/autopay/mandates/:mandateId/verify`: provider verification after authorization/resume.
- `POST /rider-app/autopay/mandates/:mandateId/cancel`: distinct bank mandate cancellation, idempotent.
- `GET /rider-app/autopay/recharges`: paginated attempts. Pending summary is also available in the main resource.

Main resource contains: saved enabled preference; effective status; collection mode; policy threshold/rechargeAmount/consentRevision and timing terms; accepted consent revision; mandate summary including status/maximum/expiry; permitted actions; stable blocking reason; pending recharge summary; preference revision. Backend owns effective status; Flutter must not recompute it by combining independent booleans from three endpoints. The effective status names below are implemented wire values.

Capabilities v2 should contain only AutoPay support, supported enrollment entry points and a stable unavailable reason alongside existing necessary checkout capabilities. Terms, mandate details and rider state come from GET AutoPay. Do not render a settings panel from raw feature flags. Only capabilities v2 is supported; do not treat malformed/network-error responses as disabled.

## UI states and actions

- OFF: show Enable AutoPay; history remains available.
- SETUP_REQUIRED / AUTHORIZATION_PENDING: launch or resume mandate authorization and verify; no success banner yet.
- CONSENT_REQUIRED: terms changed or a later preference action needs current terms. This is not the normal onboarding path; refresh and use the standalone preference flow only for an explicit rider action.
- WAITING_FOR_ALLOCATION: setup saved, no funding before active allocation.
- ACTIVE: show one enabled control and funding terms.
- PAUSED_BY_CLIENT / MANDATE_ACTION_REQUIRED: show server reason and permitted recovery; retain user's saved preference.
- MIGRATION_BLOCKED: existing collection must resolve; do not create another payment.
- ACTION_REQUIRED: show failure/review explanation and manual top-up, with no blind automatic retry.

Request states remain distinguishable: CREATING, PENDING, UNKNOWN, REVIEW_REQUIRED, SUCCESS, FAILED, CANCELLED. UNKNOWN means payment outcome is not established. REVIEW_REQUIRED may follow an earlier credit; never remove that credit in UI. SUCCESS refreshes authoritative balance and statement. Unknown future enums show a safe pending/review message rather than success.

## Both entry points

Existing rider: fetch capabilities and unified resource -> present terms -> reuse adequate mandate or launch setup -> verify -> submit explicit consent/enable -> fetch authoritative status. If another invoice collection is pending, show the blocking reason and wait.

Onboarding uses provider authorization in the combined checkout; see the detailed onboarding flow below. No separate checkbox, consent payload or PUT enable call is required.

Suggested copy: “Automatically add ₹750 when my available cash is below ₹550. Bank confirmation is required. A submitted debit may still complete after I turn AutoPay off or add money manually.” Also display server notice/cooldown, mandate limit/expiry and applicable policy terms. Explain actual authorization charges from the setup response; do not call them wallet recharge or promise a refund.

Off and Cancel bank mandate are different actions. Off stops new funding requests. Neither action promises cancellation of an already-submitted debit. Show outstanding requests after turning off or returning the vehicle.

## Reliability and compatibility

Keep one idempotency key per setup/cancel attempt across retries; create a new key only for a genuinely new operation. Refresh on authorization return, app resume, notification tap and successful settlement. Poll visible pending states with bounded backoff and stop in background. Notifications prompt a fetch; SDK callbacks never credit the wallet.

On conflict, refresh policy/status and show the backend reason; do not auto-accept revised terms. Preserve manual checkout and its API contracts. Pending automatic debit must be disclosed before manual top-up. Reuse one shared AutoPay provider across Wallet, Payments, Rentals and onboarding to avoid stale conflicting displays.

Legacy mandate and wallet preference routes have been removed. Only the unified APIs are supported. Do not retry retired endpoints after errors. Old application builds must be upgraded before this backend cleanup is deployed.

## QA and release checklist

Test both enrollment paths; adequate existing mandate; wrong/expired/revoked mandate; app killed during authorization; changed consent terms; stale preference write; client-disabled policy; inactive allocation/return; low cash with high rewards/deposit; ₹550 boundary; recharge success/failure/unknown/review; late capture; manual top-up during pending; disable during pending; refund/reversal; pagination; all localizations and accessibility labels. Assert retired routes return 404 and that the supported Flutter build never calls them.

Staging QA build comes before production rollout. Capture app build, backend SHA, sanitized request/response fixtures and reconciliation evidence. Use the implemented payloads below and the updated OpenAPI operation inventory for integration; capture end-to-end fixtures during staging signoff. Production readiness requires full-cycle staging acceptance and a supported-app rollout plan; this backend release requires the updated Flutter app.

## Integration payloads and rollout

Negotiate the compact capability contract with `GET /api/v1/rider-app/payments/orders/capabilities?version=2`. No version also returns v2. Version 1 and unsupported versions return 400. V2 removes mandate methods from checkout purposes and exposes `autoPay.supported`, `enrollmentEntryPoints` and `reasonCode`. It is policy-based availability, not a live bank health check.

Standalone/later enable payload (not onboarding):

```json
{
  "enabled": true,
  "expectedRevision": 0,
  "mandateId": "local-mandate-id",
  "consentRevision": 1,
  "consentVersion": "unified-autopay-v1"
}
```

Disable payload is `{ "enabled": false, "expectedRevision": 1 }`. Both revisions are examples: always use GET values. GET returns `revision`, `effectiveStatus`, `reasonCode`, `actions`, `setupTerms`, `policy`, `mandate`, and the existing funding timing/balance fields. Policy revision is `policy.revision`. Authorization links are exposed as `mandate.authorization.url` while pending; setup and verify responses retain the existing mandate response shape. `setupTerms` contains package maximum and validity when available. Recharge history uses `{ items, page, hasMore }`, 30 per page; GET also includes the latest 30 attempts as `requests` for the current status screen.

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

3. Read the order's immutable response terms before opening the provider checkout. `data.autoPay.terms` contains `threshold`, `rechargeAmount`, `revision`, `validityDays`; amounts are decimal INR strings. `data.autoPay.maxAmount` and `expiresAt` describe the mandate. Show, for example: “Pay and enable AutoPay. Recharge ₹750 when your wallet falls below ₹550.” Render actual returned values, including maximum/expiry, rather than hard-coding the example. If creation returns different terms than the prior screen, show the updated terms before proceeding. Historic orders may have null `terms` fields; refresh status/support recovery rather than inventing amounts.
4. Launch using `data.checkout` exactly: Razorpay `orderId`, `keyId`, `amountPaise`, `customerId`, and `recurring: true`. Map these into the team's supported SDK keys. A non-recurring fallback cannot authorize a mandate. Confirm SDK/provider combined-flow support on staging devices.
5. Submit `{ "razorpayOrderId": "...", "razorpayPaymentId": "...", "razorpaySignature": "..." }` to `POST /rider-app/payments/orders/:paymentRequestId/verify`; use `POST /rider-app/payments/orders/:paymentRequestId/reconcile` when the SDK response is missing or the app resumes. Fetch order detail and `GET /rider-app/autopay` after verification. Provider callbacks are verified by the backend; app success alone is insufficient.
6. Display payment and AutoPay separately. Order `status: SUCCESS` confirms payment only (internal deployment payment status is `PAID`). `autoPay.status: AUTHORIZATION_PENDING` means authorization is still pending. `autoPay.status: ACTIVE` confirms the mandate, while main AutoPay `effectiveStatus` confirms whether wallet funding is active/awaiting allocation. Only show “AutoPay enabled” for `ACTIVE` or `WAITING_FOR_ALLOCATION`. If mandate is active but funding is still `OFF`, refresh with bounded backoff; after the waiting window show “Payment received; AutoPay setup needs attention” with a refresh/retry-status action, not a second payment or automatic PUT.
7. For rejected/cancelled/expired mandate, show payment success if payment succeeded and AutoPay setup failure separately. Do not charge the onboarding amount again just to retry AutoPay. Subsequent enrollment is the standalone setup flow. Preserve rider disable/cancel actions; background retries must never turn it back on.

Poll only while the screen is visible (for example 2, 4, 8, then 15-second intervals, bounded to two minutes); stop in background and refetch on resume. The backend retries missed activation every minute, but failures or changed terms can require rider/support action. Reuse the same request key/body for network retries of the same checkout; changing the request body under that key returns conflict.

### Onboarding QA acceptance

- No consent checkbox and no PUT enable request in the normal onboarding network trace.
- Confirmed payment plus confirmed mandate activates funding automatically.
- Paid payment with pending/failed mandate never shows AutoPay active.
- App termination before callback recovers through server reconciliation.
- Repeated callbacks/verification do not create another mandate or rewrite preference revisions.
- Later disable, existing preferences, cancelled mandate and changed policy cannot be overridden by delayed activation.
- Snapshot terms are shown before SDK launch, and SDK receives recurring/customer parameters.
- A subsequent wallet recharge credits the ledger once; it does not debit rent directly.

No database migration is needed. Deploy backend to staging first, then test the current Flutter build. Record backend SHA, app version, sanitized checkout/mandate IDs and final states before production promotion.


Operations must set both `UNIFIED_AUTOPAY_ENABLED=true` and the exact client UUID in `UNIFIED_AUTOPAY_CLIENT_IDS`, with the existing Razorpay/payment readiness prerequisites satisfied. Removing the client or switching the flag off blocks new unified funding; reconciliation and ledger settlement continue. Do not use the environment flag as an app-side feature decision.

Removed route families: `/rider-app/payments/autopay`, `/rider-app/wallet/autopay`, `/client/wallet-autopay-policy`, and `/client/deployment-autopay-policy`, including their child routes. There are no compatibility aliases. Admin recharge history/verification now uses `GET /client/autopay/recharges` and `POST /client/autopay/recharges/:id/verify`. Existing client operations history, payment webhooks and submitted-payment reconciliation remain available.
