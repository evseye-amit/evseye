# Onboarding payment with unified AutoPay

Onboarding and existing-rider enrollment use the same AutoPay policy and wallet-funding consent. There is no separate onboarding enable switch. Client Admin → Payments → AutoPay → Settings uses `GET/PUT /api/v1/client/autopay/policy`; audit history is `/history` beneath that path.

## Capability and consent

Read `GET /api/v1/rider-app/payments/orders/capabilities` (contract v2, also accepts `?version=2`). `data.autoPay.supported` and `enrollmentEntryPoints` describe policy availability, not live gateway connectivity. The old `DEPLOYMENT.autoPaySetup`, UPI_AUTOPAY/ENACH checkout purposes and capabilities v1 have been retired. Explicit `?version=1` returns 400.

Read `GET /api/v1/rider-app/autopay` for financial terms, consent revision, package setup terms, current mandate, actions and effective status. Creating a mandate is not sufficient to enable wallet funding.

Use the common DEPLOYMENT order API and stable Idempotency-Key. When requesting combined setup, include:

```json
{
  "purpose": "DEPLOYMENT",
  "allocationId": "allocation-uuid",
  "setupAutoPay": true,
  "email": "rider@example.com",
  "autoPayConsent": {
    "accepted": true,
    "version": "unified-autopay-v1",
    "consentRevision": 1,
    "maxAmount": "15000.00",
    "validityDays": 365
  }
}
```

The numeric values above are examples: use current server terms. Never pre-check consent or accept changed terms in the background. The actual onboarding payment remains server-priced. Approval may use the onboarding amount; do not promise a nominal ₹1 charge or a refund.

Backend recovery binds the verified mandate and applies the saved wallet consent after authorization. An active allocation is still required before funding. Changed terms, pending legacy collection or a later rider disable prevent automatic activation. Resume the same payment request after app restart; never start a replacement charge because an SDK callback was lost.

## Rollout and recovery

New setup requires the unified platform flag, explicit client allowlist, all Razorpay rollout prerequisites, a valid package and one active saved merchant configuration. The mandate must cover the configured recharge and notice period. Both onboarding and standalone paths use the wallet policy master switch.

Keep signed webhooks, saved merchant versions, pending-payment reconciliation and historical audit records. Removing the old onboarding API does not cancel bank mandates or erase earlier attempts. Already-submitted legacy consent snapshots remain available for recovery, but new clients must use unified consent.

See [Flutter contract](unified-autopay-flutter-handoff.md), [operations](wallet-autopay-operations.md) and [migration/runbook](unified-autopay-implementation-plan.md). Staging device and bank-flow acceptance is required before production enablement.
