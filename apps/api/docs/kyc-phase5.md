# KYC Phase 5: client policy and commercial usage

Phase 5 uses the existing EVsEye `Feature`, `PackageFeature`, `ClientSubscription`, `ClientFeature`, `FeatureCreditLot`, `FeatureUsageLedger`, `FeaturePricing`, and `ClientFeaturePricing` models. It does not create another package catalog. The KYC provider attempt cost stays on `KycVerificationAttempt`; client consumption and any client price snapshot stay on `FeatureUsageConsumption`, which has a unique verification ID.

```
Active subscription → ClientFeature entitlement → KycClientPolicy → quota/price
                                                           ↓
                                               one KycVerification
                                                           ↓
                                                 routing → attempts
```

The feature mapping is PAN → `PAN_VERIFICATION`, Aadhaar OTP → `AADHAAR_VERIFICATION`, bank account → `BANK_VERIFICATION`, and IFSC → `IFSC_VERIFICATION`. PAN and bank are existing catalog features. Aadhaar and IFSC are not currently configured as commercial features. The existing IFSC lookup remains an operational lookup without client consumption until an IFSC feature is explicitly configured; an active client policy can disable it. Aadhaar verification is unavailable unless its feature, package entitlement, and provider capability are configured. No package price or quota is hardcoded by KYC.

## Resolution and execution

An active client policy for the verification type overrides the default enable state, workflow definition assignment, routing policy assignment, validity, reverification flag, and overage behavior. An assignment must reference an active workflow or route visible to that client and valid for the verification type. Without an assignment, Phase 2 client/global workflow selection and Phase 3 client/global routing selection continue. Workflow executions retain their definition ID/version, routing decisions retain policy ID/version, and each consumption records its selected policy ID and recognition mode. A verification snapshots validity days and the reverification flag; a verified result receives `validUntil` when validity is configured. Automatic re-verification scheduling is not implemented.

For features in the commercial catalog, entitlement requires an active subscription and enabled effective `ClientFeature`. A package-sourced client feature also requires an included `PackageFeature`. Client overrides remain on `ClientFeature`; they do not modify base package records. Verification idempotency is checked before commercial consumption. A new verification and its consumption are committed in one transaction, before routing invokes a provider. If entitlement, quota, or paid pricing fails, no verification or provider attempt is created.

`ON_REQUEST` is the supported recognition mode and is the default. `ON_COMPLETION` and `ON_SUCCESS` are reserved in the schema and fail with `KYC_COMMERCIAL_CONFIGURATION_ERROR` if assigned, because completion-based reservation/finalization is not implemented. Under `ON_REQUEST`, a started provider request consumes one business verification even if the provider later returns a technical or business failure. A route with no eligible provider is rejected before consumption. This rule is explicit in `KycClientPolicy` and the consumption snapshot.

Quota consumes an existing package credit lot first, then an add-on credit lot. Unlimited client features use an explicit unlimited flag. With no credit and no unlimited entitlement, `BLOCK` returns `KYC_USAGE_LIMIT_EXCEEDED` before any provider call. `ALLOW_AND_CHARGE` and `ALLOW_WITH_WARNING` require an effective client or base feature price; a missing price returns `KYC_COMMERCIAL_CONFIGURATION_ERROR`. A current `ClientFeaturePricing` snapshot takes precedence; otherwise active feature-scoped `ClientPricingAdjustment` rows apply to `FeaturePricing`. The client price snapshot uses Prisma Decimal, preserves base, discount, effective price, currency, and pricing reference, and never changes `FeaturePricing`. A billing-period start/end is derived from the subscription's anchor date and billing cycle. The existing commercial maintenance job remains responsible for granting and resetting package credit lots.

Credit consumption is serialized per client and feature with a PostgreSQL transaction advisory lock, then locks a chosen credit lot. One unique consumption per verification prevents fallback or parallel attempts from multiplying client usage. A super administrator can reverse consumption with a reason. The reversal marks history, restores the consumed credit lot and add-on counters when applicable, appends an adjustment ledger entry, and records an audit event; it cannot run twice.

Example: one PAN business verification can time out at Sandbox and succeed at another eligible provider. It creates **one** `FeatureUsageConsumption`, **two** `KycVerificationAttempt` rows, and up to two provider cost snapshots. The client price follows EVsEye's feature entitlement, credits, and effective feature price. Provider attempt count does not set the client charge. Phase 4's second production vendor remains unselected, so this is demonstrated with test-only adapters.

## APIs and operations

Authenticated client administrators and KYC operators can read `/api/v1/kyc/admin/client-policies`, `/entitlements`, `/usage`, paginated `/usage/ledger`, and `/add-ons`. Client administrators can update `/client-policies/:type`; references are validated against their client scope. The Next.js KYC **Policy & Usage** tab shows effective entitlement, policy assignments, available credits, eligible and purchased add-ons, and business-verification usage without provider cost. Client-facing provider and verification endpoints omit vendor cost fields. Super administrators can read `/api/v1/platform/kyc/commercial/clients/:clientId/usage` and reverse `/clients/:clientId/usage/:verificationId/reverse` with a reason. Existing platform commercial APIs continue to manage package features, add-ons, subscriptions, pricing, and discounts.

The client policy editor exposes enable/disable, workflow and routing assignment, and overage selection. Validity and reverification are supported by the backend endpoint and shown in policy records; a fuller validity editor and commercial threshold events remain future operations work. The current IFSC lookup exception and the lack of a selected Provider #2 are explicit limitations. No Flutter files were inspected or modified.
