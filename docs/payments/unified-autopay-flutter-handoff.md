# Unified AutoPay — Flutter team handoff

Prepared 21 November 2026. Backend contract implemented on `codex/unified-autopay`; rollout disabled by default. The user confirmed Flutter is updated and authorized removal of legacy routes. This does not replace staging device acceptance. Read alongside `unified-autopay-implementation-plan.md`. This is the authoritative AutoPay contract; the old wallet handoff is superseded. No message has been sent to the team.

## Product behavior

Expose one AutoPay control across onboarding, Payments and Wallet. Rentals links to the same control and shows status; it must not have a second rent debit setting. AutoPay adds money when available cash is below the server policy threshold; rent/approved deductions and settled earnings appear in the unified statement. Disabling AutoPay does not stop rent accounting or switch to direct rent debit.

Display server values, initially ₹550 threshold and ₹750 recharge. Exactly ₹550 does not trigger. Cash, restricted rewards, deposit and unpaid dues remain distinct. Do not implement debit scheduling or balance-trigger logic in Flutter. Funding is asynchronous and subject to the server-provided notice/cooldown. Manual Add Money remains available.

## Current code to change

Reviewed repo `/Users/amitgoyal/Documents/ChatGPT/rider_app`, revision `90039c1`:

- `apps/rider_app/lib/features/payments/data/payments_repository_impl.dart`: current setup maps mandate status and `autoDebitEnabled`; replace feature state mapping with the unified DTO.
- `features/payments/domain/entities/auto_pay_setup.dart`, `domain/payments_repository.dart`, `domain/usecases/auto_pay_usecases.dart`: separate funding preference/effective state from mandate lifecycle.
- `features/payments/presentation/pages/payments_page.dart`: current mandate verification can show AutoPay turned on; show enabled only after consent/activation is confirmed by backend. Reuse existing authorization-launch and app-resume handling.
- `features/payments/presentation/widgets/payments_widgets.dart`: extend state labels and localizations.
- `features/wallet/data/wallet_repository_impl.dart`, wallet overview/statement pages and providers: expose linked statement events, pending attempts and balance refresh.
- `features/rentals/presentation/widgets/rentals_widgets.dart`: replace rent-specific switch/status wording with the shared AutoPay state.

Feature paths after the first item are relative to `apps/rider_app/lib`. Trace `RiderPaymentsApi` through the shared packages before changing API adapters. Check fleet onboarding consumers in both mobile workspaces; do not edit generated localization files manually.

## Implemented API contract

Prefix `/api/v1`, existing bearer/client context, `{ "data": ... }` envelope, decimal INR strings and UTC ISO timestamps.

- `GET /rider-app/autopay`: authoritative state and current terms.
- `PUT /rider-app/autopay`: enable/disable, with expected preference revision. Enable includes `mandateId` and `consentRevision`; disable requires no renewed financial consent. Use `expectedRevision` from GET `revision`; stale updates return HTTP 409.
- `POST /rider-app/autopay/mandates`: setup with email/method and stable Idempotency-Key.
- `POST /rider-app/autopay/mandates/:mandateId/verify`: provider verification after authorization/resume.
- `POST /rider-app/autopay/mandates/:mandateId/cancel`: distinct bank mandate cancellation, idempotent.
- `GET /rider-app/autopay/recharges`: paginated attempts. Pending summary is also available in the main resource.

Main resource contains: saved enabled preference; effective status; collection mode; policy threshold/rechargeAmount/consentRevision and timing terms; accepted consent revision; mandate summary including status/maximum/expiry; permitted actions; stable blocking reason; pending recharge summary; preference revision. Backend owns effective status; Flutter must not recompute it by combining independent booleans from three endpoints. The effective status names below are implemented wire values.

Capabilities v2 should contain only AutoPay support, supported enrollment entry points and a stable unavailable reason alongside existing necessary checkout capabilities. Terms, mandate details and rider state come from GET AutoPay. Do not render a settings panel from raw feature flags. Only capabilities v2 is supported; do not treat malformed/network-error responses as disabled.

## UI states and actions

- OFF: show Enable AutoPay; history remains available.
- SETUP_REQUIRED / AUTHORIZATION_PENDING: launch or resume mandate authorization and verify; no success banner yet.
- CONSENT_REQUIRED: show current wallet funding terms with unchecked explicit acceptance.
- WAITING_FOR_ALLOCATION: setup saved, no funding before active allocation.
- ACTIVE: show one enabled control and funding terms.
- PAUSED_BY_CLIENT / MANDATE_ACTION_REQUIRED: show server reason and permitted recovery; retain user's saved preference.
- MIGRATION_BLOCKED: existing collection must resolve; do not create another payment.
- ACTION_REQUIRED: show failure/review explanation and manual top-up, with no blind automatic retry.

Request states remain distinguishable: CREATING, PENDING, UNKNOWN, REVIEW_REQUIRED, SUCCESS, FAILED, CANCELLED. UNKNOWN means payment outcome is not established. REVIEW_REQUIRED may follow an earlier credit; never remove that credit in UI. SUCCESS refreshes authoritative balance and statement. Unknown future enums show a safe pending/review message rather than success.

## Both entry points

Existing rider: fetch capabilities and unified resource -> present terms -> reuse adequate mandate or launch setup -> verify -> submit explicit consent/enable -> fetch authoritative status. If another invoice collection is pending, show the blocking reason and wait.

Onboarding: show the same terms and persist the accepted revision with the onboarding request. Reuse the deployment checkout mandate path where available; do not create a second bank mandate. Backend completes activation from verified mandate and saved consent, including recovery if the app closes. Show waiting-for-allocation until eligible. A successful onboarding payment alone must not imply AutoPay activation. If terms change during checkout, require renewed consent.

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

Enable payload:

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

Onboarding keeps the generic DEPLOYMENT checkout API. For an allowlisted unified client, send `autoPayConsent.version: "unified-autopay-v1"`, `accepted: true`, the reviewed `consentRevision`, `maxAmount` and `validityDays`. The backend saves the financial terms with checkout and recovers funding activation after verified mandate approval. If the rider disables after that consent, delayed recovery cannot re-enable funding. Do not reuse `deployment-autopay-v1` consent for wallet funding. Outside the rollout allowlist, new AutoPay enrollment is unavailable; ordinary deployment payment and recovery of existing attempts remain available.

Operations must set both `UNIFIED_AUTOPAY_ENABLED=true` and the exact client UUID in `UNIFIED_AUTOPAY_CLIENT_IDS`, with the existing Razorpay/payment readiness prerequisites satisfied. Removing the client or switching the flag off blocks new unified funding; reconciliation and ledger settlement continue. Do not use the environment flag as an app-side feature decision.

Removed route families: `/rider-app/payments/autopay`, `/rider-app/wallet/autopay`, `/client/wallet-autopay-policy`, and `/client/deployment-autopay-policy`, including their child routes. There are no compatibility aliases. Admin recharge history/verification now uses `GET /client/autopay/recharges` and `POST /client/autopay/recharges/:id/verify`. Existing client operations history, payment webhooks and submitted-payment reconciliation remain available.
