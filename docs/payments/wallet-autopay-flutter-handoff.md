# Wallet AutoPay — Flutter implementation handoff

Status: backend implementation on `codex/wallet-autopay-recharge`; not deployed or enabled by this change. Flutter implementation belongs to the Flutter team. All routes below use the existing `/api/v1` prefix, bearer authentication, client context and response envelope `{ "data": ... }`. Money is a decimal string in INR. Dates are ISO timestamps in UTC; display them in the rider's local timezone.

## Agreed behavior

- Default trigger: **available cash strictly below ₹550**. ₹550 itself does not trigger.
- Default automatic recharge: **₹750 per request**, configurable per client.
- Available cash excludes rewards and security deposits and accounts for holds/minimum cash reserve. Use `GET /rider-app/wallet/balance` → `cash.availableBalance`, not the combined wallet balance, to explain this rule.
- Requires explicit wallet AutoPay consent, a verified active Razorpay UPI mandate and an `ACTIVE` scooter allocation. New requests stop at `DEALLOCATION_INITIATED`.
- Backend evaluates after a committed rental deduction and runs a recovery scan every minute. The app never initiates debits based on its own balance checks.
- Only one unresolved automatic recharge per wallet. No automatic retry of an uncertain provider request. Definitive failure requires rider action.
- After success there is a 24-hour cooldown before another automatic recharge request. The client policy cannot bypass this limit.
- A debit is scheduled at least 25 hours ahead (currently 25 hours plus a five-minute submission buffer). This is an expected earliest debit time, not a completion guarantee. Processing can take longer.
- Wallet credit occurs only after verified captured payment. A mandate approval, SDK callback, order creation or `PENDING` state is not wallet credit.
- Manual Add Money remains available. A previously submitted automatic debit may still complete after manual recharge, disabling AutoPay or returning the scooter.

## 1. Read wallet AutoPay

`GET /rider-app/wallet/autopay`

Example with a pending automatic recharge:

```json
{
  "data": {
    "policy": {
      "enabled": true,
      "threshold": "550.00",
      "rechargeAmount": "750.00",
      "revision": 1
    },
    "balanceBasis": "AVAILABLE_CASH",
    "minimumLeadHours": 25,
    "cooldownHours": 24,
    "enabled": true,
    "actionRequired": false,
    "consentRequired": false,
    "mandateId": "mandate-local-uuid",
    "requests": [{
      "id": "recharge-local-uuid",
      "status": "PENDING",
      "amount": "750.00",
      "currency": "INR",
      "balanceAtTrigger": "289.00",
      "scheduledAt": "2026-11-16T10:05:00.000Z",
      "completedAt": null,
      "failureCode": null,
      "createdAt": "2026-11-15T09:00:00.000Z"
    }]
  }
}
```

`requests` contains the latest 30 requests, newest first. The regular wallet transaction list remains the source of settled wallet activity. `enabled` is the saved wallet preference; it is not proof the bank mandate is active. Combine it with `policy.enabled`, `consentRequired`, `actionRequired` and the existing mandate status. A disabled client policy blocks new requests without deleting consent/history.

## 2. Set up or verify the bank mandate

Reuse the existing mandate API rather than creating a second Razorpay integration in Flutter:

1. `GET /rider-app/payments/autopay` for availability, configured maximum and existing mandate.
2. If needed, `POST /rider-app/payments/autopay` with a stable `Idempotency-Key` and `{ "method": "UPI_AUTOPAY", "email": "rider@example.com" }`.
3. Open the returned `data.authorization.url` on the create/verify response (`data.mandate.authorization.url` when reading the current mandate) (hosted Razorpay authorisation) using the existing authorised-link handling. Inspect the existing mandate response envelope; do not assume wallet `mandateId` is a Razorpay token.
4. On return/resume, call `POST /rider-app/payments/autopay/:mandateId/verify` and re-read the mandate. Only verified `ACTIVE` can enable wallet funding.
5. If local mandate collection was disabled, use the existing `POST /rider-app/payments/autopay/enable` after the rider explicitly agrees. Paused bank mandates must be resumed in the UPI app, then verified.
6. Require a mandate limit at least equal to `policy.rechargeAmount`. A rejected, expired or inadequate mandate needs the existing setup flow. Backend requires a valid rider email for Razorpay recurring collection.

The existing bank mandate API also supports invoice collection. **Creating/activating a mandate alone does not opt the rider into wallet AutoPay.** Complete wallet consent below. During rollout, operations must avoid enabling direct rental invoice collection while riders are being moved into wallet funding. An already-pending invoice AutoPay debit blocks wallet opt-in until resolved.

The existing authorisation amount defaults to ₹1 unless configured otherwise. Display the actual setup terms from the existing API; do not describe that nominal authorisation as a ₹750 wallet recharge or promise it is refunded.

## 3. Obtain explicit consent and enable wallet funding

Suggested consent copy, substituting server policy values:

> While I have an active scooter, automatically add ₹750 when my available cash balance falls below ₹550. Each recharge is subject to my UPI mandate and bank confirmation. Debits need at least 25 hours' notice. Only one automatic recharge can be pending, and another request will not start within 24 hours after a successful recharge. A submitted debit may still complete after I disable AutoPay or recharge manually.

Show the mandate's maximum/expiry and existing wallet terms. Do not pre-check consent. Localise all UI copy in Flutter's supported languages.

`PUT /rider-app/wallet/autopay`

```json
{
  "enabled": true,
  "mandateId": "mandate-local-uuid",
  "consentRevision": 1
}
```

Use the local mandate ID and the exact `policy.revision` the rider reviewed. The response has the same shape as GET. The backend evaluates immediately after consent commits if eligible and already low; it may therefore return a newly pending request.

Changing client threshold/recharge amounts invalidates previous consent. If `consentRequired` is true, show the new terms and require explicit acceptance using the new revision. Never silently accept them in the background.

A 409 response can mean stale terms, inactive/inadequate mandate, disabled client policy or existing invoice collection. Show the server message, refresh both policy and mandate, and let the rider resolve the condition. Do not loop enable calls automatically.

## 4. Disable wallet funding

`PUT /rider-app/wallet/autopay`

```json
{ "enabled": false }
```

This stops new wallet requests. It does not cancel an already-submitted bank debit or revoke the bank mandate. Display this distinction before confirmation. Bank mandate cancellation continues through `POST /rider-app/payments/autopay/:mandateId/cancel` with the existing idempotency contract. Do not display bank cancellation as complete until provider verification confirms it.

After a definitive failed payment, show an action-required state. The rider may correct the bank/mandate issue and explicitly enable again; this rechecks current terms. An uncertain/review request continues to block another recharge even if enable is called again.

## 5. Display request state

- `CREATING`: preparing recharge; do not start another automatic payment.
- `PENDING`: debit/payment confirmation pending; display amount and expected earliest debit time.
- `UNKNOWN`: provider outcome is unconfirmed; do not describe this as failed or retry the charge. Money may still be deducted.
- `REVIEW_REQUIRED`: payment needs operations review; no automatic retry or assumed wallet credit. If `completedAt` is non-null, an earlier credit already exists and a later refund/duplicate-capture issue is under review.
- `SUCCESS`: payment verified and wallet credited; refresh wallet balance and transactions.
- `FAILED`: no verified success at present; show the action-required message and allow manual recharge. Late authoritative capture can still reconcile later.
- `CANCELLED`: stopped locally before submitting a debit because eligibility changed; not a claim of bank-side reversal.

Use server status rather than parsing `failureCode` into payment success. `failureCode` is diagnostic and may grow. Keep unknown future values safe and visible.

Poll GET on returning from authorisation, on screen refresh, and while viewing a pending request with bounded backoff (e.g. 5s, 10s, 30s, then 60s). Stop polling in background. Backend workers continue independently. Refetch on app resume and notification tap.

## 6. Notifications and manual recharge

The backend enqueues one action-required notification per request on failure/review or after 36 hours unresolved. It uses the existing notification inbox/push pipeline:

```json
{ "screen": "wallet", "rechargeId": "recharge-local-uuid" }
```

Existing notification infrastructure may add its standard metadata. Treat a notification as a prompt to fetch current server state, never proof of payment. Users without active push registration can still access the inbox.

Keep existing manual recharge endpoints unchanged:

- `POST /rider-app/payments/orders` with `purpose: TOP_UP`, amount and stable `Idempotency-Key`.
- Existing checkout, verify and status flow from `../rider-wallet-top-up-contract.md`.
- If an automatic recharge is pending/unknown, explain that manually adding money may be followed by the already-submitted automatic debit.

Successful automatic credits appear as wallet `transactionType: TOP_UP`, `status: POSTED`, `referenceType: WALLET_AUTO_RECHARGE`, with the local recharge ID as `referenceId`. Pending and failed automatic attempts are provided by the AutoPay GET endpoint; do not invent ledger credits for them.

## Flutter acceptance checklist

- Consent is explicit and uses server-returned amounts/revision.
- Existing bank mandate setup and verify flow is reused.
- ₹550 is not described as combined balance; cash/rewards/deposit distinction is clear.
- No optimistic wallet credit and no timer-based debit submission in Flutter.
- Pending, unknown, failed, consent-changed, disabled and bank-paused states are covered.
- Manual recharge remains available with pending-debit disclosure.
- Disable/return does not hide pending history or promise cancellation.
- App resume, notification tap and verified success refresh wallet data.
- Existing manual top-up and invoice payment flows remain usable under their existing contracts.
