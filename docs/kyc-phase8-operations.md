# KYC Phase 8 operations

Phase 8 intelligent routing is disabled by default. The `KycIntelligentRoutingControl` row with scope `GLOBAL` starts disabled. Only Super Admin can create or activate policies and change controls. The console is at `/platform/kyc/intelligent-routing`; the API is under `/api/v1/platform/kyc/intelligent-routing`.

## Rollout

1. Confirm the provider adapter, credential, capability, price, and static routing policy for each verification type. The current registry has one Sandbox adapter; another provider must be integrated before a multi-provider rollout.
2. Review `/readiness`, provider health, Phase 7 costs and SLA data, and the metric snapshot freshness. Snapshot generation runs every five minutes. Unknown costs use neutral scoring or exclusion according to policy; mixed currencies cannot be compared.
3. Create a `SHADOW` draft and activate it. Shadow records the hypothetical choice without calling the alternate provider. Compare `GET /shadow` against actual outcomes.
4. Create a `SCORED` draft referencing the shadow policy, set a small deterministic rollout percentage and technical failure/P95 guardrails, then activate. The activation API requires enough shadow decisions. Increase rollout only after reviewing outcome and cost data.
5. Enable the scoped control and then `GLOBAL` with an audit reason. A disabled global, type, or client control forces static routing. Recheck readiness before each expansion.

## Incident actions

- Disable `GLOBAL`, `TYPE:<verification type>`, or `CLIENT:<client UUID>` via `PATCH /controls` with a reason. In-flight attempts may finish; new executions recheck controls. Pause the active policy to prevent new intelligent decisions.
- The canary guardrail checks active policies every five minutes and pauses them after the minimum sample size when configured technical failure or P95 limits are breached. Inspect the `KYC_CANARY_GUARDRAIL` operational alert and audit event before reactivation.
- Three consecutive technical failures within 60 seconds open the shared provider/type circuit. It excludes the provider from fresh routing. A non-billable adapter health probe begins after 30 seconds and three healthy probes close it. Business rejections do not open the circuit. Inspect `KycProviderCircuitState` and provider health before recovery.
- Technical retry requires the client to resubmit the original identity input; the server intentionally does not store replayable identity input. OTP continuations stay pinned to the original provider. Do not retry business rejections with another vendor.
- Disagreement between a verified and business-failed provider response goes to manual review. Review the conflicting attempt and result records before resolution.

## Current go-live gaps

The second vendor adapter, production credentials/contracts, provider status lookup and webhook contracts, distributed concurrency/rate budgets, and credential rotation workflow are not implemented. Do not treat the readiness endpoint as a production certification. No production traffic should be enabled until those integrations and operational exercises are complete.
