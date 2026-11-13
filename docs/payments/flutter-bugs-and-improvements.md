# Flutter payment bugs and improvements

Status: Flutter-team implementation backlog. The backend contract is now documented in [mobile-payment-api-contract-v1.md](mobile-payment-api-contract-v1.md), revision v1.1; deployment and device acceptance remain release gates. See [flutter-team-handoff.md](flutter-team-handoff.md). Scope reviewed: rider_app/apps/rider_app and rider_app/packages/evseye_core. Flutter implementation belongs exclusively to the mobile team; all tickets below remain mobile work.

| ID | Priority | File relative to Flutter monorepo | Current behaviour | Required improvement / acceptance |
|---|---|---|---|---|
| MOB-01 | High | apps/rider_app/lib/core/payments/online_payments.dart | Always opens Razorpay | Dispatch by backend provider; unsupported provider shows unavailable without launching wrong SDK |
| MOB-02 | High | packages/evseye_core/lib/src/api/payment_orders_api.dart | Checkout requires keyId and amountPaise | Parse typed Razorpay and Cashfree payloads; Cashfree paymentSessionId survives parsing |
| MOB-03 | High | apps/rider_app/lib/core/payments/razorpay_checkout.dart | Availability uses build-time flavor key | Consume backend capability when delivered; use returned key for checkout |
| MOB-04 | High | packages/evseye_core/lib/src/api/payment_orders_api.dart | Deployment/penalty constructors only | Add invoice, outstanding, deposit and top-up flows after capability validation |
| MOB-05 | High | packages/evseye_core/lib/src/api/payment_orders_api.dart | No creation idempotency header parameter | Persist one key per logical request; reuse on network retry |
| MOB-06 | High | apps/rider_app/lib/core/payments/online_payments.dart | Callback verify only; no persisted recovery | Persist request ID; fetch status on resume/restart; never mark paid from SDK alone |
| MOB-07 | Medium | apps/rider_app/lib/features/payments/data/payments_repository_impl.dart | Setup allowed only for Razorpay | Implement Cashfree authorization once contract is final |
| MOB-08 | Medium | apps/rider_app/lib/features/payments/presentation/pages/payments_page.dart | Rental dues shown without checkout | Wire invoice payment, status recovery and refreshed balances |
| MOB-09 | Medium | apps/rider_app/lib/core/payments/razorpay_checkout.dart | SDK launch has no explicit exception recovery | Restore UI after launch errors; cancellation does not prove payment failure |

Dependencies: typed checkout payloads, policy capabilities, client routing and callbackless reconciliation are implemented locally. Use the versioned contract and confirm the deployed revision before enabling them. Policy capability eligibility does not certify merchant connectivity. Do not enable payment purposes solely because a constructor exists.

Device acceptance: success, cancel, decline, app kill after debit, offline callback verification, duplicate tap, expired checkout, review/refund state, unsupported provider, client switch and logout with pending payment. Only server SUCCEEDED permits success UI. Refresh authoritative financial balances after success. Bound foreground polling with backoff and a manual check action; retain unresolved attempts for later recovery.
