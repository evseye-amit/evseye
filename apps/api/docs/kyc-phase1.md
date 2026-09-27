# KYC verification platform — Phase 1 implementation

The provider-independent verification API lives alongside the older `RiderKyc` manual status workflow. A `KycVerification` is one business request; `KycVerificationAttempt` records each provider operation; `KycVerificationResult` stores only selected normalized fields. A verified PAN or Aadhaar outcome updates `RiderKyc` in the completion transaction, allowing existing onboarding reads to use the normalized result. The existing audit service records consent, requests, and OTP completion without PII. The existing `ClientFeature` entitlement is checked for PAN verification.

## Setup

1. Apply the Prisma migration `20260927190000_kyc_verification_platform` in a non-production environment and run the existing seed command.
2. Set `KYC_ENABLED=true`, `KYC_SANDBOX_ENVIRONMENT=TEST`, `KYC_SANDBOX_SECRET_REFERENCE=env:KYC_SANDBOX_TEST`, `KYC_SANDBOX_API_KEY`, `KYC_SANDBOX_API_SECRET`, and a unique random `KYC_FINGERPRINT_SECRET` of at least 32 characters in the backend runtime secret configuration. AWS Secrets Manager can inject the three secret values into the NestJS runtime environment through deployment configuration; the application does not fetch them directly. Never use `NEXT_PUBLIC_*` for these values. The seed is idempotent and creates the Sandbox provider, capabilities, and a safe credential reference. Re-run it after enabling KYC.
3. Enable the intended provider capabilities in the database through a controlled operational change. PAN and IFSC are seeded enabled when KYC is enabled. Aadhaar OTP remains disabled because Sandbox [marks verification of its OTP endpoint deprecated](https://developer.sandbox.co.in/api-reference/kyc/aadhaar/endpoints/verify_otp). Confirm contractual and compliance availability before enabling it. Bank is unsupported and disabled.

Phase 1 always uses `https://test-api.sandbox.co.in`. The TEST adapter cannot run when `NODE_ENV=production`. The secret reference is a backend-only pointer to runtime environment variables. AWS Secrets Manager retrieval is not implemented yet; a production-grade deployment must add it before promoting this integration.
The Phase 1 adapter uses one global EVsEye Sandbox account. The credential model reserves `clientId` for a future per-client account, but those records are not selected by this adapter.

## API

All routes use existing access-token and role guards. `CLIENT_ADMIN` and `KYC_OPERATOR` are allowed; client scope comes from the authenticated user, never a request parameter.

- `POST /kyc/verifications/consents`: record explicit accepted consent. The request includes rider ID, type, consent text hash/version, purpose, reason, and channel.
- `POST /kyc/verifications`: initiate a verification. Requires `Idempotency-Key` and rider ID, type, relevant identity fields, and consent ID for PAN, Aadhaar or bank. The same key within a client returns the existing business verification.
- `POST /kyc/verifications/:id/aadhaar-otp`: complete an OTP in an eligible state.
- `GET /kyc/verifications`: client-scoped list with status, type, and skip filters; 50 rows per page.
- `GET /kyc/verifications/:id`: client-scoped safe details, attempts, and normalized results.
- `GET /kyc/admin/overview`: client-scoped status counts.
- `GET /kyc/admin/providers`: safe provider/capability configuration without credential records.
- `GET /kyc/admin/providers/:id/health`: simple authentication availability check.

The Next.js client panel is at `/client/kyc` and calls these NestJS routes through the existing `/api/v1` session gateway. It includes overview, providers, verifications, safe detail view, and health.

## Security and resilience

PAN, Aadhaar and bank identifiers and the caller's idempotency key are HMAC-SHA-256 fingerprinted with a backend secret. Full values and OTP are never stored in the new verification models. Responses are allowlisted and masked; provider payloads are transient. Provider errors are translated into safe categories. Database transactions group local state changes, but no transaction remains open during a provider call. A unique `(clientId, idempotencyKey)` constraint prevents concurrent duplicate requests from generating multiple provider calls. OTP completion claims the `OTP_REQUIRED` state before calling Sandbox. The HTTP client has a configurable timeout, cached auth token, one authentication refresh, and a short circuit breaker after repeated technical failures. Automatic replay of paid verification calls after ambiguous timeouts is disabled to avoid duplicate charges.

The [Sandbox Penny-Less API](https://developer.sandbox.co.in/api-reference/kyc/bank/endpoints/penny_less) requires the full account number in a GET URL. This conflicts with the PII rule and [Sandbox's own guidance](https://developer.sandbox.co.in/guides/developer-resources/post_for_get) to keep sensitive identifiers out of URLs. Bank verification is therefore disabled and its outbound call is omitted until a compatible provider contract is available.

## Adding a provider

Implement the `VerificationProvider` interface, register it in `ProviderRegistryService`, add provider and capability rows, and configure credentials. The domain service and Next.js panel consume normalized data and do not depend on Sandbox DTOs. Cashfree could be added through this path in a later phase; this phase has no Cashfree adapter or multi-vendor routing strategy.

## Open Phase 1 gaps

AWS Secrets Manager resolution, formal provider cost reconciliation, retry policy, cross-client Super Admin operations, full integration/security test coverage, and live Sandbox TEST verification require further implementation. Aadhaar OTP is unavailable until the provider's deprecated endpoint is approved for use. Bank verification requires a URL-safe provider contract. The older `RiderKyc` initiation endpoint remains a manual workflow; new verifications use the dedicated API and synchronize verified onboarding status.

An interactive provider test console is intentionally absent: this repository does not have a dedicated permission for creating billable TEST verifications from the panel. Test calls can be made through the client-scoped API with explicit consent and an idempotency key once TEST credentials are configured.

Provider contracts were checked against Sandbox's [authentication](https://developer.sandbox.co.in/api-reference/authenticate), [PAN](https://developer.sandbox.co.in/api-reference/kyc/pan/endpoints/verify_pan_details), [Aadhaar OTP initiation](https://developer.sandbox.co.in/api-reference/kyc/aadhaar/endpoints/generate_otp), [Aadhaar OTP verification](https://developer.sandbox.co.in/api-reference/kyc/aadhaar/endpoints/verify_otp), [bank](https://developer.sandbox.co.in/api-reference/kyc/bank/endpoints/penny_less), and [IFSC](https://developer.sandbox.co.in/api-reference/kyc/bank/endpoints/ifsc_verification) references.
