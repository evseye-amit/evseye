# Flutter team handoff — payment contract v1.3

Latest UPI delivery: [UPI backend and Flutter handoff](upi-flutter-handoff.md). This addition requires its own migration and release; the verified staging baseline below does not yet include it.

Previous update: [Phase 2 payment reliability](phase2-flutter-handoff.md), including home-screen fields and wallet transaction identity.

Phase 1 update (2026-11-14): [payment reliability handoff](phase1-flutter-handoff.md) supersedes the capability restrictions below after its backend release. Flutter implementation remains owned by the Flutter team.

Backend contract: [mobile-payment-api-contract-v1.md](mobile-payment-api-contract-v1.md). Revision: payment-contract-v1.3, 2026-11-14. Flutter implementation is owned entirely by the Flutter team. The backend work does not change Flutter source or dependencies.

## Backend delivery

- Existing create/detail/verify routes remain; additive capabilities and callbackless reconcile routes are implemented.
- Provider selection is enforced by client policy. The Phase 1 backend adds Razorpay top-up, outstanding, security-deposit and non-rental invoice checkout. Enable only purposes returned by the deployed server capabilities.
- Cashfree checkout returns its saved environment, or null on older rows where no reliable snapshot exists. Null means no SDK launch; support/status recovery remains available.
- Capability eligibility is not a credential/connectivity test. Handle creation errors even after enabled:true.
- Only server SUCCEEDED is a successful checkout. Wallet-only success does not need an SDK.

## Mobile implementation tickets

1. MOB-01/02: typed provider dispatch. Razorpay uses returned key/order/paise; Cashfree uses returned order/session/environment. Reject unsupported providers and contradictory payloads.
2. MOB-03: native platform/SDK availability plus server capability eligibility; remove build-time key as the payment availability gate.
3. MOB-04/08: add supported invoice/outstanding/deposit/top-up requests and screens. Obtain IDs from server-owned invoice/deposit listings; never calculate payable totals from cached UI.
4. MOB-05: persist exact create body plus one idempotency key before sending. Reuse on uncertain transport response; never silently create a new logical request.
5. MOB-06: persist request ID before SDK launch, scope it to user/client/API environment, and resume via reconcile after restart. Serialize duplicate taps. Stop old-session callbacks after logout/client switch.
6. MOB-09: SDK cancel/error/timeout is not financial failure. Restore UI and recover from backend evidence. Bound polling and provide manual Check status.
7. MOB-07: support Razorpay hosted and Cashfree subscription authorization. Reuse mandate creation keys and verify server mandate status after return.

## AutoPay route reference

All paths use the existing API base and RIDER Bearer authentication:

- GET /rider-app/payments/autopay — current setup and mandate.
- POST /rider-app/payments/autopay — {method:"UPI_AUTOPAY",email:"..."}; stable Idempotency-Key required.
- POST /rider-app/payments/autopay/:mandateId/verify — server provider fetch after authorization.
- POST /rider-app/payments/autopay/:mandateId/cancel, /pause, /resume — stable Idempotency-Key required per management action.
- GET /rider-app/payments/autopay/upcoming and /debits — authoritative scheduled payments/history.

Only verified ACTIVE establishes authorized AutoPay. Pause/cancel must be confirmed from returned server state. Shared Cashfree environment must not be switched with unresolved mandates; versioned client Cashfree remains a later phase.

## Acceptance checklist (Flutter team)

Final payment testing is owned by the Flutter team on the mobile app, per the 2026-11-14 handoff decision. The temporary browser login/capabilities check is not mobile payment acceptance. Backend support supplies test fixtures and verifies server-side accounting/webhook evidence; it does not replace device testing.

### Two-merchant sandbox acceptance (Android and iOS)

Run separately for Pinkrides and Yogmaya using their distinct Razorpay TEST merchants. Obtain rider login access and unpaid test invoice/allocation IDs securely; do not use production credentials or real payments.

- [ ] Select an unpaid rental invoice or deployment payment for each rider and record its server-issued ID and expected amount/currency.
- [ ] Create checkout through the common payment API. Verify the returned provider, merchant key, order ID and amount belong to the selected client; launch the SDK with these returned values.
- [ ] Complete the sandbox payment in the mobile app. Confirm server SUCCEEDED, updated invoice/allocation state and exactly one financial posting, with backend evidence.
- [ ] Confirm the correct merchant webhook reaches staging and settles the correct client's request. Repeat callbacks/webhook delivery with backend support; no duplicate payment, allocation or ledger posting may result.
- [ ] Test duplicate taps and retries using the same create body/idempotency key. Confirm one logical payment and no second charge.
- [ ] Lose the SDK callback or close the app after payment, then restart and reconcile the saved request without callback fields. Confirm the original payment recovers without creating another order.
- [ ] Switch client/rider and attempt detail, verify and reconcile for the other client's request. All must reject access without exposing payment data or changing either client's accounting.
- [ ] Record client, Android/iOS build, device/OS, backend revision, request/order IDs, expected/actual results and redacted evidence for each case. Never include OTPs, tokens or merchant secrets.
- [ ] Flutter QA signs off both clients and platforms; backend support confirms webhook/accounting evidence. Any failures remain open release blockers.

### Additional mobile compatibility and recovery

- [ ] Existing deployment/penalty calls still work with additive checkout fields.
- [ ] Correct provider launches; unsupported capability launches no SDK.
- [ ] Wallet-only SUCCEEDED refreshes balances without verify.
- [ ] Invoice, partial payment and top-up amounts come from the authoritative backend contract.
- [ ] Duplicate taps create at most one logical payment.
- [ ] Kill app after debit; restart recovers the existing request.
- [ ] Offline verification, lost callback, SDK cancellation and launch exception retain recovery state.
- [ ] 409/503 do not trigger a different key or another gateway.
- [ ] Legacy Cashfree environment:null cannot launch checkout.
- [ ] REVIEW_REQUIRED, REFUND_PENDING and REFUNDED render distinct guidance.
- [ ] Logout/client switch cannot verify another account's pending request.
- [ ] Razorpay/Cashfree mandate return is followed by server verification.
- [ ] Android and iOS device scenarios recorded against the deployed backend revision.

## Backend release checklist

- [x] Staging URL: `https://api.staging.evseye.com`; API image commit `e4676d02fc6061b7243fb3f5aee119bf46f0d37a`, ECS revision 204, verified by ECS DescribeServices/DescribeTaskDefinition on 2026-11-14. This is the baseline before v1.3 changes.
- [x] Merchant-version table and successful migration record verified 2026-11-14. Historical credential recovery still requires its separate sandbox test below.
- [ ] Configure sandbox merchant webhook URLs and test old/new credential recovery.
- [ ] Provide two-client test accounts, supported capabilities and test invoice/deposit/allocation IDs securely.
- [ ] Flutter team runs sandbox checkout/AutoPay flows on mobile; backend team supports webhook, credential-recovery and accounting verification.
- [ ] Flutter team records device results and acceptance; release owner approves staged rollout after outstanding backend gates close.

Local regression results and remaining operational work are recorded in [implementation-plan.md](implementation-plan.md). No live credentials are included in this handoff.

## Phase 6 additive refund acceptance

After deploying the Phase 6 backend, collection detail includes `refundedAmount` as a decimal string. Complete refunds return REFUNDED; active refund requests return REFUND_PENDING; completed partial refunds retain the successful collection state with a nonzero refundedAmount. Never relaunch checkout for an already collected request merely because it was refunded.

- [ ] For Pinkrides and Yogmaya, coordinate an admin-initiated sandbox invoice/penalty refund and verify pending, successful partial and successful full refund presentation on Android/iOS.
- [ ] Verify refund callback duplication/app restart does not create a payment or refund request from the mobile app.
- [ ] Backend support supplies evidence of exactly one rider/wallet reversal and the correct reopened invoice balance for PAYMENT_REVERSAL.
- [ ] Confirm AutoPay history and invoice balances refresh after an admin refund; do not infer mandate cancellation from a refund.


## Optional Cashfree merchant rollout acceptance — 2026-11-14

No Flutter source was changed. Cashfree is optional and is not a release blocker while no client uses it. For the current staging release, verify existing Razorpay checkout/AutoPay/capabilities work with zero Cashfree client configuration. Do not offer Cashfree based solely on SDK availability; honor server capabilities and the checkout provider/environment.

When Cashfree sandbox configuration is available, the Flutter team owns Android/iOS acceptance for two distinct client merchants: checkout and subscription authorization; provider callback plus authoritative backend reconciliation; cancelled/failed/unknown outcomes; duplicate and delayed webhook recovery; isolation across tenants; and refund status display. Rotate credentials after starting a payment/mandate, then confirm reconciliation and refunds still use the original merchant and launch environment. A disabled/newly unavailable merchant must prevent new work without switching an existing payment to another gateway. Retain the existing Phase 4 two-merchant tests.

Settlement ingestion, bank evidence, external-refund adoption and alert assignment are web/admin workflows. Their implementation details and current supported sources are documented in [Phase 7 operations](phase-7-cashfree-and-operations.md).
