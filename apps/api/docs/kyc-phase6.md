# Phase 6 KYC operations console

The client console is at `/client/kyc/operations`; the internal console is at `/platform/kyc`.
Client APIs are under `/api/v1/kyc/operations` and enforce the authenticated client's ID on every read.
Internal APIs are under `/api/v1/platform/kyc/operations` and require `SUPER_ADMIN`.

The command center aggregates verifications in PostgreSQL, with 1 hour, 24 hour and 7 day windows.
Verification, workflow, review, alert and audit lists use bounded 50 row pages. The read API exposes
safe identifiers and normalized statuses. Provider costs are selected only on the internal detail API;
raw provider response bodies and identity inputs are never selected.

Operational flags are derived from authoritative statuses and timestamps. The following startup-validated
environment variables tune classification and alert rules:

- `KYC_OPS_STUCK_PROCESSING_MINUTES` (default 10)
- `KYC_OPS_STUCK_PROVIDER_MINUTES` (default 5)
- `KYC_OPS_ACTION_REQUIRED_MINUTES` (default 1440)
- `KYC_OPS_REVIEW_SLA_MINUTES` (default 240)
- `KYC_OPS_ALERT_MIN_SAMPLES` (default 20)
- `KYC_OPS_ALERT_TECHNICAL_RATE_PERCENT` (default 25)

The alert scan runs every five minutes, observes bounded stuck/review/exhausted queues and per-capability
technical failure rates, and deduplicates by type, scope and entity. Internal operators can acknowledge
and resolve alerts. New observations reopen resolved alerts. The audit explorer returns only a small
allowlist of configuration fields from audit payloads because older audit data can contain sensitive values.

Manual review assignment, priority and resolution require a reason and expected version. The database
claim rejects stale changes; workflow resolution still runs through `KycWorkflowEngine`. A workflow resume
preview permits reconciliation of existing completed verification results through the engine, without a
new provider request or usage entry. Stateless technical retries require the client admin to resubmit
the exact original identity input. The backend compares its fingerprint, checks the latest attempt's
failure type, rechecks routing eligibility, and claims the verification using a version and idempotency
key. The retry uses the routing engine, appends attempts, and adds no client usage entry. The default
operational retry budget adds one technical retry to the routing policy's original attempt budget;
`KYC_OPS_MAX_TECHNICAL_RETRIES` can change that (0–3). Aadhaar OTP and workflow-linked verification
retries remain unavailable in this path: both need a provider-session-aware step restart that preserves
workflow execution history. Start a new, consented verification through the existing flow instead.

Internal provider and capability enable/disable actions require a reason and are audited. Registry
eligibility reads these flags on each route planning request. The console does not contain credentials.
Gridlines credentials supplied for testing have not been stored or used. A Gridlines adapter requires
confirmed API contract, enabled products and test response cases before it can safely join routing.
