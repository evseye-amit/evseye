# Flutter team handoff — payment contract v1.1

Backend contract: [mobile-payment-api-contract-v1.md](mobile-payment-api-contract-v1.md). Revision: payment-contract-v1.1, 2026-11-13. Flutter implementation is owned entirely by the Flutter team. The backend work does not change Flutter source or dependencies.

## Backend delivery

- Existing create/detail/verify routes remain; additive capabilities and callbackless reconcile routes are implemented.
- Provider selection is enforced by client policy. Razorpay client capabilities are deployment, rental invoice, penalty and UPI AutoPay. Do not expose outstanding/deposit/top-up for a Razorpay client.
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

- [ ] Supply staging URL and deployed commit/build identifier; this document's revision is not a deployment ID.
- [ ] Apply and verify merchant-version migration; retain historical secret references.
- [ ] Configure sandbox merchant webhook URLs and test old/new credential recovery.
- [ ] Provide two-client test accounts, supported capabilities and test invoice/deposit/allocation IDs securely.
- [ ] Run real sandbox checkout/AutoPay flows with the Flutter team.
- [ ] Record device results and approve staged rollout.

Local regression results and remaining operational work are recorded in [implementation-plan.md](implementation-plan.md). No live credentials are included in this handoff.
