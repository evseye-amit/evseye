# Adding another KYC provider

Provider #2 has not been selected for EVsEye. The provider codes in the database enum and test doubles are placeholders for possible integrations, not evidence that a vendor is approved or connected. Keep Sandbox as the only registered production adapter and leave its default routing policies unchanged until selection and validation are complete.

To begin an actual integration, obtain the selected vendor name, current official TEST/SANDBOX API documentation, test credentials delivered through backend secret management, implemented capability list, and webhook contract if a selected flow requires callbacks. Do not infer endpoints or response fields from another vendor's API.

## Onboarding checklist

1. Confirm the provider code and official test contract, including authentication, endpoints, response schemas, errors, rate limits, and supported environments.
2. Implement the existing `VerificationProvider` contract in a provider-specific adapter. Keep provider DTOs, HTTP, authentication, mapping, and error translation inside that adapter.
3. Normalize success, business failure, and technical failure into `ProviderResult`. Never pass vendor payloads into workflows or decision rules.
4. Register the adapter with `ProviderRegistryService` through backend dependency injection. The registry selects only registered, active providers with an enabled and supported capability and a valid credential reference.
5. Inject credentials only into the backend runtime from the approved secret store. Store only a reference in `KycProviderCredential`; never return it from an API. Registry eligibility prefers an active client reference, then an active global reference for the provider and environment. The new adapter must resolve and use that reference securely; the existing Sandbox adapter remains bound to its single `env:KYC_SANDBOX_TEST` runtime credential.
6. Configure the provider and each actually implemented capability. Leave unsupported capabilities disabled. Use capability cost and currency fields only with verified pricing; do not invent a price.
7. Add an inactive or non-default test routing policy for each intended capability. Verify priority, fallback in both directions, weighted selection, parallel agreement/disagreement, and hedging within the configured attempt budget. Keep chargeable parallel routing opt-in.
8. Verify provider and capability disable switches, health, circuit state, timeout behavior, and technical failure classification. A business failure must not trigger fallback.
9. For stateful Aadhaar OTP, keep completion pinned to the provider that started the session. A failed initiated session must be restarted with a new provider transaction rather than reusing its reference with another vendor.
10. If webhooks are required, verify signatures and timestamps, reject replay, correlate by attempt/provider reference, and test duplicate and out-of-order delivery under client isolation.
11. Add adapter unit tests, shared contract tests, routing and database integration tests, safe provider-approved test fixtures, and redaction checks. Run real calls only against TEST/SANDBOX.
12. Confirm the generic Providers, routing policy, health, and verification detail screens show the adapter through database configuration. No provider credential may reach Next.js.

Current operations endpoints include a client-scoped provider list, provider health, capability health, routing policies, and per-verification routing traces. Provider health delegates to the registered adapter. The capability health API scopes attempt statistics to the authenticated client, while the routing engine uses cross-client operational health for its provider availability decision.
