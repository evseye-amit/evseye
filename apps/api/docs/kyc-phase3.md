# KYC Phase 3: provider routing

Phase 3 routes Phase 1 verification requests through a policy selected by client and verification type. Phase 2 workflows still call `VerificationService`; they do not choose providers. Production has one registered adapter, Sandbox. A second provider is registered only in tests, so multi-provider policies are ready for later integrations without implying that another vendor is live.

## Policy and execution

`KycRoutingPolicy` and its ordered `KycRoutingProvider` rows hold a versioned, client-specific or global policy. The newest active default client policy wins; otherwise the newest active default global policy applies. A verification records the chosen policy ID, version, strategy, and selected provider codes in `KycRoutingDecision` before making provider calls. Policies used by a decision cannot be edited in place; create a new version. The seed creates global Sandbox-only PAN and IFSC priority policies. When no policy exists, the legacy single Sandbox path remains available.

The registry filters providers by registered adapter, active configuration, enabled capability, credential reference, and circuit state. The routing engine then excludes unavailable capability health. An OTP continuation stays pinned to the provider that initiated the challenge. Routing uses only normalized provider results and bounded attempts; no raw identity input or provider response enters routing decisions or audit metadata.

- `PRIORITY`: call the first eligible configured provider once.
- `FALLBACK`: retry the next eligible provider only for a configured technical category. Business failure ends the route.
- `WEIGHTED`: sample one eligible provider proportional to positive configured weights; weights need not total 100.
- `PARALLEL`: call up to the policy budget concurrently, then arbitrate their normalized results.
- `HEDGED`: start the primary; after the configured delay, start one secondary if the primary has not returned an acceptable result. The current implementation waits for both started calls before final arbitration, which preserves conflict evidence but does not reduce response latency when the slower call remains in flight.

`LOWEST_COST`, `LOWEST_LATENCY`, and `SMART` are reserved strategy values and rejected for active policies. Parallel and hedged routing are rejected for Aadhaar OTP. Policy validation and PostgreSQL checks cap attempts and providers at five; per-provider timeout must be at least one second. Parallel and hedged use explicit opt-in policy flags. The policy's provider and attempt limits cap potential chargeable calls.

## Results and resilience

Every started call has one numbered `KycVerificationAttempt` and sanitized `KycVerificationResult`. Attempt reason identifies primary, fallback, health failover, weighted selection, parallel, or hedge. Technical failures are classified separately from business failures. The recent capability health snapshot derives technical failure rate and latency percentiles from stored attempts and includes adapter circuit state; business rejection does not degrade provider health. A newly unavailable capability is skipped during planning. There is no Redis dependency.

Arbitration modes are `FIRST_VERIFIED`, `FIRST_TERMINAL`, `MAJORITY`, `ALL_MUST_AGREE`, and `MANUAL_REVIEW_ON_CONFLICT`. Conflicting verified and business-failed results create `KycProviderConflict` records. A manual review resolution uses the existing verification review status and Phase 2 workflow decision path. Attempts completing after the chosen result are marked late. An audit trail records routing start, skips, selections, fallback, conflicts, and completion without raw PII.

## Operations

The client-scoped, authenticated administration API exposes `GET /api/v1/kyc/admin/routing-policies`, `GET /api/v1/kyc/admin/routing-policies/:id`, `GET /api/v1/kyc/admin/provider-capability-health`, and `GET /api/v1/kyc/admin/routing-trace/:verificationId` to client administrators and KYC operators. The web KYC page shows policies, capability health, selected route, attempt reasons, conflicts, and routing timeline. Policies are read only in this phase; edits are made through versioned database records. No Flutter changes are included.

Apply migrations, then run `node prisma/seed-kyc.mjs` to populate idempotent defaults. The seed does not add provider credentials or a second production adapter. Database integration tests use a disposable PostgreSQL instance and a test-only provider to cover fallback and conflict arbitration.
