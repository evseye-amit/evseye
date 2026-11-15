# Automatic PAN verification implementation

## Scope and current delivery

Backend only. Do not edit either Flutter workspace. Sandbox is the first adapter;
onboarding must depend on the verification service rather than a vendor API.

The backend now fixes PAN commercial feature resolution (`PAN_VERIFICATION`
verification type -> `VERIFY_PAN` catalog feature), provider environment selection,
adapter-owned credentials, login-consent reuse, onboarding triggering, allocation
gating, stale-result protection, and transactional outbox execution. Flutter remains
unchanged.

## Configuration

- `KYC_ENVIRONMENT` selects the routing environment for all providers. When absent,
  the existing `KYC_SANDBOX_ENVIRONMENT` remains the compatibility fallback.
- `KYC_SANDBOX_ENVIRONMENT` describes the account used by the Sandbox HTTP adapter.
- An omitted `KYC_SANDBOX_SECRET_REFERENCE` derives `env:KYC_SANDBOX_TEST` or
  `env:KYC_SANDBOX_PRODUCTION` from the Sandbox environment. Explicit references
  must match that environment.
- Production Sandbox requires an explicitly configured HTTPS API URL; the default
  test endpoint is rejected. Operators must use the provider-approved production URL.
- Enabled KYC requires a fingerprint secret. Each adapter independently determines
  whether its credentials are available; another vendor must not require Sandbox keys.
- The Sandbox adapter currently resolves one environment-backed account. Arbitrary
  tenant secret references are rejected rather than silently using the global account.
  Multi-account secret resolution remains future work.
- Existing production provider/credential database rows must match the selected
  environment and reference. No deployed configuration or database was changed here.
- Legacy `PAN_VERIFICATION` feature rows/credit lots, if present in a deployed database,
  require an audited migration into `VERIFY_PAN`; do not delete historical usage or
  automatically duplicate balances. This increment makes the supplied catalog canonical.

## Remaining phases and acceptance gates

1. Complete foundation: immutable capability/input contracts, readiness states,
   execution-budget policy, consent policy, and explicit activation/allocation rules.
2. Onboarding identity: link verification and consent to the onboarding user before
   Rider creation; retain submission versions; validate canonical inputs and redact
   identity fields in audit events. Never infer KYC consent from generic terms.
3. Eligibility: combine independent document review and identity verification states;
   propagate all outcomes; support correction, expiration, audited override, and
   activation/allocation gating. Apply vendor costs per attempt and client usage per
   logical verification according to an explicit billing policy.
4. PAN documents remain an optional manual-review artifact for now. Automatic
   verification uses the typed PAN, rider name, and date of birth; uploading a PAN
   document does not trigger OCR or extract identity fields.
5. Release: apply the outbox migration, run real-catalog integration tests,
   database-backed concurrency and recovery tests, provider contract validation,
   isolated production check, client rollout, monitoring, kill switch, and separately
   authorized/backed-up historical backfill.

Primary routing should launch with Sandbox only. Sequential fallback is eligible
for configured technical failures, not a way to overturn definitive identity
mismatches. Parallel/consensus verification stays disabled until conflict and cost
policies are defined. Future adapters implement their own credential compatibility
and normalized results; registry code must not special-case their vendor name.

## Flutter team handoff (planning; endpoints not yet implemented)

Existing Flutter code is unchanged. Publish the final API schema and examples when
backend contracts land; do not treat this planning list as an implemented API.

- Capture explicit, versioned PAN-verification consent for the authenticated rider.
- Display waiting-for-input/consent, processing, verified, correction-required,
  temporary-unavailability, and manual-review states with safe next actions.
- Support PAN/name/DOB correction after onboarding, with bounded status polling or
  an agreed refresh mechanism. Do not call vendors or choose routing from the app.
- Send the known `fieldCode` in document completion requests instead of relying on
  subject inference. Backend compatibility for old clients must remain tested.
- Include tenant isolation, old-app compatibility, consent declined, provider outage,
  duplicate submission, and failed number-only PAN correction in acceptance tests.

Consent/correction UI can be a rollout dependency. Until the backend has sufficient
recorded consent and validated inputs, it must not initiate a chargeable check.
