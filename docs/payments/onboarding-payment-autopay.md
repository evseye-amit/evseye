# Onboarding payment with UPI AutoPay

## Scope and rollout

Combined checkout collects the server-priced DEPLOYMENT amount and requests a Razorpay UPI mandate for later invoice debits. The original registration-link flow remains supported. This does not enable wallet auto-recharge: that still requires its own policy and rider consent.

The backend defaults `RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED=false`. Staging explicitly enables it as a non-secret API environment variable in both Terraform and the staging deployment workflow. Production remains disabled by default. Do not also inject this flag through ECS `secrets`. Before enabling it in another environment:

1. Apply the `20261119090000_deployment_checkout_autopay` Prisma migration and deploy the backend together. Old attempts default to ordinary checkout.
2. Configure one active client Razorpay merchant with a retained configuration version. DEPLOYMENT and UPI_AUTOPAY must resolve to that same version/key/environment.
3. Enable `RAZORPAY_ENABLED`, `RAZORPAY_AUTOPAY_ENABLED`, and then `RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED` after merchant/account and app testing. Staging is enabled for Flutter integration validation; this does not certify the end-to-end authorization or later debit flow.
4. Keep the existing payment/order/token webhook subscriptions and payment automation workers running. Recovery uses saved merchant credentials even when new combined checkouts are disabled.
5. With the Flutter team, verify the authorization payment collects the actual onboarding amount and creates the expected token on Android and iOS. Use supported UPI Intent/Checkout flows. Do not promise a fixed number of PIN prompts until validated with supported PSP apps.
6. Test a subsequent debit with the existing 25-hour lead time, as well as cancellation, delayed callbacks, duplicate callbacks, and link-flow regression.

Razorpay reference: https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction/

## Planned Client Admin control (not implemented)

### Location and wording

Use the existing **Client Admin → Payments → AutoPay → Settings** screen
(`AutoPayWorkspace`). Add an **Onboarding AutoPay** card above the existing
wallet recharge settings. Keep wallet recharge independently configurable.

The card contains:

- Switch: **Offer AutoPay during onboarding payment**.
- Help: “Let riders pay their onboarding amount and authorize future invoice
  auto-debits in the same checkout. Riders must explicitly agree.”
- Effective status: **Available**, **Off**, or **Unavailable**, with the specific
  reason when unavailable: platform rollout disabled, Razorpay unavailable,
  merchant configuration missing, or AutoPay absent from the client package.
- Read-only terms: mandate limit, validity, gateway and environment, derived from
  the active package and merchant configuration. Do not expose environment
  variable names or credentials in the client-facing UI.
- **Save changes** and **Discard** actions, existing unsaved-change navigation
  protection, and last-updated actor/time with paginated change history.

Show the saved preference separately from effective availability. If the platform
disables rollout, retain an enabled preference but label it unavailable. Allow
turning it off; prevent enabling while prerequisites fail and explain why.
Disabling applies only to new combined checkout requests: existing attempts,
mandates, verification, reconciliation and agreed invoice debits continue.
This switch never supplies rider consent or changes the existing mandate limit.

### Backend implementation

1. Add a tenant-owned `ClientDeploymentAutoPayPolicy` with unique `clientId`,
   `enabled`, integer `revision`, `updatedAt` and `updatedBy`. New clients default
   to disabled. At migration, explicitly backfill eligible existing clients that
   already have effective combined checkout enabled, preserving current behavior.
   Do not make all clients enabled by default.
2. Add authenticated `GET` / `PUT /api/v1/client/deployment-autopay-policy` and
   `GET /api/v1/client/deployment-autopay-policy/history`. Require `CLIENT_ADMIN`
   and derive the client from the authenticated session. Never accept arbitrary
   client IDs from the request body.
3. GET returns the saved preference and revision, effective availability, reason
   codes, read-only terms, and last-updated metadata. PUT accepts `{ enabled,
   revision }`, validates prerequisites when enabling, uses optimistic concurrency
   (409 on stale revision), and writes policy plus audit history atomically.
4. Keep `RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED` as the platform-wide deployment
   control. Client Admin must not modify ECS configuration or Secrets Manager.
   The effective setting requires the global flags, client preference, matching
   Razorpay payment/AutoPay merchant, and package eligibility.
5. Centralize this availability calculation and use it in both
   `PaymentGatewayPolicyService.capabilities()` and
   `DeploymentAutoPayService.prepare()`. Enforce it server-side for new requests,
   including callers that submit `setupAutoPay: true` directly. Preserve retries
   and recovery of attempts already accepted under their saved terms.
6. Keep `UPI_AUTOPAY.enabled` independent: disabling combined checkout must not
   disable the separate mandate setup flow. The existing `DEPLOYMENT.autoPaySetup`
   boolean remains compatible with Flutter; additional reason fields are additive.
   Rider-specific checks, such as an existing open mandate, still run at creation.

### Acceptance and rollout

- Test two clients with different preferences; neither can view or modify the
  other's policy or history. Non-admin roles cannot update either.
- Test saved-on/global-off, missing merchant, ineligible package, enabled and
  disabled states, concurrent saves, audit history and accessible keyboard use.
- Verify capabilities agree with creation enforcement and disabling preserves
  ordinary payment, separate AutoPay, existing attempt verification and recovery.
- Implement schema/API and regression tests first, then the settings card and UI
  tests. Verify Android/iOS consent and combined checkout on staging before any
  production rollout. The current staging flag enablement does not ship this UI.

## Flutter integration contract

Flutter changes are owned by the Flutter team. This document is the backend handoff.

Read `GET /api/v1/rider-app/payments/orders/capabilities`. `data.purposes.DEPLOYMENT.autoPaySetup` is a policy/rollout capability, not proof of live gateway connectivity or rider eligibility. Read `GET /api/v1/rider-app/payments/autopay` for package configuration and any existing mandate. Package ineligibility may return an error; keep ordinary payment available.

For the combined option, show an unchecked consent box and email field. Display:

- The exact onboarding amount charged now.
- The mandate limit: the lower of `configuration.maxAmount` and INR 15,000 (our current implementation cap).
- The configured validity in days and that later invoice debits are on demand.
- That wallet auto-recharge is a separate opt-in.

Suggested English consent (translation owned by the product/Flutter team):

> I agree to pay ₹{onboardingAmount} now and authorize future invoice auto-debits up to ₹{maxAmount} per debit for {validityDays} days. Wallet auto-recharge requires separate consent.

Send only after explicit acceptance:

```http
POST /api/v1/rider-app/payments/orders
Idempotency-Key: <unique stable key, 8–120 letters/digits/colon/underscore/hyphen>
Content-Type: application/json
```

```json
{
  "purpose": "DEPLOYMENT",
  "allocationId": "<uuid>",
  "setupAutoPay": true,
  "email": "rider@example.com",
  "autoPayConsent": {
    "accepted": true,
    "version": "deployment-autopay-v1",
    "maxAmount": "15000.00",
    "validityDays": 365
  }
}
```

The backend verifies the displayed limit/validity against current settings, saves the actor and timestamp plus immutable terms, and uses the server's onboarding quote. The key must be reused with the same request body after a timeout. A changed allocation, mode, email or consent is a different request and requires a new key. Never create that replacement while the original outcome is uncertain.

For ordinary checkout omit `setupAutoPay`, `email` and `autoPayConsent`. Existing callers without an idempotency key remain supported. Using a key additionally enables stable deployment request replay.

When `checkout.recurring` is true, pass its `customerId` as `customer_id` and `recurring: "1"` to Razorpay Checkout alongside the existing order/key/amount. Prefill the accepted email and rider contact. Only open checkout when the backend returns a non-null `checkout` object. A successful SDK callback still requires backend verification.

Call the existing verify endpoint with the Razorpay signature and IDs. Keep the payment result separate from `autoPay`:

```json
{
  "data": {
    "paymentRequestId": "deployment:<uuid>",
    "purpose": "DEPLOYMENT",
    "status": "SUCCEEDED",
    "checkout": null,
    "autoPay": {
      "requested": true,
      "status": "ACTIVE",
      "mandateId": "<uuid>",
      "mandateNumber": "EVM-...",
      "maxAmount": "15000.00",
      "expiresAt": "<ISO timestamp>",
      "failureCode": null
    }
  }
}
```

`autoPay` is null for ordinary requests. Create/detail/verify/reconcile share this representation. Bound mandates expose their current status (including PAUSED); unbound setup uses NOT_STARTED, UNKNOWN, AUTHORIZATION_PENDING or FAILED. The expiry and limit are authoritative server values.

- Payment succeeded + ACTIVE: show payment complete and auto-debit enabled.
- Payment succeeded + UNKNOWN/AUTHORIZATION_PENDING: continue onboarding; show activation pending and reconcile the existing request. Do not open another payment.
- Payment succeeded + FAILED: continue onboarding. Offer separate mandate setup only after the previous authorization is definitively failed/cancelled and eligibility is checked again.
- PAUSED/CANCELLED/EXPIRED: reflect the current mandate state; do not label auto-debit enabled.
- Payment itself under review/refund: use existing payment handling. AutoPay must not override it.

`POST /orders/:paymentRequestId/reconcile` refreshes payment evidence and mandate setup. `GET /orders/pending` includes owned pending collections and deployments, including unresolved setup after payment. The endpoint returns up to 50 from each source, not an all-history report. Token webhooks and scheduled deployment/mandate reconciliation recover cases where the app closes.

## Errors and fallback

- `VALIDATION_FAILED`: fix the input; no automatic checkout replacement.
- `AUTOPAY_NOT_IN_PACKAGE`, `AUTOPAY_UNAVAILABLE`, `AUTOPAY_LIMIT_EXCEEDED`, `AUTOPAY_MANDATE_EXISTS`: preflight failures can offer ordinary payment after the rider chooses it. Existing payment-policy errors can also reject an unsupported merchant before an attempt is created.
- `AUTOPAY_TERMS_CHANGED`: reload and obtain consent for the new terms.
- `IDEMPOTENCY_CONFLICT`: the key belongs to another request body; reconcile the original request before replacing it.
- `RAZORPAY_ORDER_PROCESSING`, `RAZORPAY_ORDER_UNKNOWN`, provider/network timeout: retry/reconcile the same request. Do not fall back to a fresh charge.
- `RAZORPAY_PAYMENT_UNDER_REVIEW`: preserve the existing support/reconciliation flow.

## Recovery and accounting

The existing deployment settlement remains the sole owner of the onboarding financial posting. Mandate creation never writes a wallet, payment receipt or invoice allocation. It runs after settlement and cannot roll a successful onboarding payment back when the gateway is unavailable.

The database stores request identity, consent, customer, order-create claim, token and independent setup state. Order creation is claimed before the gateway POST. After an ambiguous result the backend searches by the saved receipt; it never blindly repeats the order POST. Uncertain CREATING attempts block mode switches.

Mandate binding rechecks the accepted capture and allocation under the allocation lock, then takes the same rider lock used by ordinary mandate creation. Competing mandates do not cause a second open mandate. Unbound tokens are cancelled and cancellation confirmation is retried; the capture retains token/cleanup evidence. Late duplicate tokens are handled separately so cleanup cannot revoke the accepted token. If a token already belongs to another managed mandate, cleanup stops for manual review.

A superseded combined checkout can still capture a payment through the existing financial recovery path, but its AutoPay authorization is cancelled instead of being enabled. Missing or inconsistent provider evidence remains UNKNOWN and requires recovery/review rather than an unsafe replacement charge.

## Operational checks

Investigate attempts with `autoPayStatus=UNKNOWN` and captures with `autoPayCleanupStatus=PENDING`. `AUTOPAY_RECOVERY_PENDING` denotes unresolved provider evidence; `AUTOPAY_MANDATE_EXISTS`, `AUTOPAY_SUPERSEDED`, and `AUTOPAY_CAPTURE_NOT_ACCEPTED` explain cancellation work. The existing scheduled deployment worker revisits captures; the mandate worker handles linked tokens. Persisted evidence is retained after cleanup.

Disabling the combined rollout flag stops new combined setup. It does not cancel existing mandates or stop their ordinary invoice debits. Use existing mandate cancellation/local-disable controls for that purpose.
