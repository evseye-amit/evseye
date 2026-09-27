# KYC Phase 2: workflow and decisions

Phase 2 uses the Phase 1 `VerificationService` and provider registry. The workflow and decision services never call Sandbox directly. Existing verification records remain independent; a `KycWorkflowStepExecution` links one verification to a particular workflow step.

## Persisted journey

`KycWorkflowDefinition` is a versioned template. Its ordered `KycWorkflowStep` rows describe verification type, action mode, required status, and failure behavior. A `KycWorkflowExecution` pins the definition ID and version; step execution rows and decisions remain as history. Seeded definitions and rules are read only in the administration UI. PostgreSQL triggers prevent changing a definition, its steps, or its rules after the definition has an execution. To change a live policy, insert a new definition version and steps.

```
Rider → WorkflowExecution → StepExecution → KycVerification → Phase 1 provider registry
                          ↘ ReconciliationResult
                          ↘ Decision history
```

One active workflow per client and rider is enforced by a partial PostgreSQL unique index. Terminal workflows are retained. Starting again after a terminal outcome creates a new execution linked through `previousWorkflowExecutionId`. An `Idempotency-Key` may be supplied to return the same execution for retries.

The seeded `RIDER_DEFAULT_KYC` v1 has one required, user action PAN step. Aadhaar OTP and bank account verification are disabled in the Phase 1 seed; IFSC lookup does not verify a rider's bank account. They must be enabled and added in a **new** workflow version when supported. PAN requires the same Phase 1 consent and client feature entitlement as individual verification.

## State and recovery

Starting creates `ACTION_REQUIRED`; submitting a step uses Phase 1 verification. OTP produces `ACTION_REQUIRED`, and the existing OTP completion route resumes the linked step. A completed step advances to the next configured step or reconciliation. Required failures are sent to manual review under the default rule; an administrator can configure a rejected outcome with a versioned rule. Conditional `updateMany` transitions and unique step constraints make duplicate completion delivery idempotent. Review approve/reject uses a conditional status update in the same transaction as its decision record, so competing reviewers cannot both decide.

The scheduled recovery job runs every five minutes. It expires workflows after the stored expiry date and processes terminal Phase 1 verifications whose workflow step is still active. It can relink an unlinked verification using the deterministic Phase 1 idempotency key; if no verification exists five minutes after a step was claimed, it restores the user action. An existing provider call stuck in `PROCESSING` remains for operator investigation because its outcome is ambiguous. Workflow state is in PostgreSQL, so browser closing and restarts do not lose progress. The seeded definition expires after 30 days (`expiryMinutes`); Phase 1 OTP has its own ten minute expiry. No arbitrary provider timeout is imposed by the workflow.

## Reconciliation and rules

Names are normalized with Unicode NFKD, uppercasing, punctuation removal, and whitespace collapse. Exact strings score 100. Otherwise score is `round(200 × matched tokens / total tokens)`, with matching initials accepted. Thresholds come from the workflow definition (`strong: 80`, `partial: 50` in the seed). A missing value produces `UNKNOWN`, not a mismatch. DOB compares ISO calendar dates only when both are present. Bank holder name is compared only when a provider supplies one.

The PAN flow compares the rider profile name and DOB with submitted PAN identity values and stores only the classifications and score. Sandbox PAN verifies those submitted values against PAN but Phase 1 does not persist the provider's name or DOB. Aadhaar and bank cross-source comparisons therefore remain `UNKNOWN` until an enabled provider returns safe normalized identity fields. No raw name, DOB, PAN, Aadhaar, bank account, OTP, or provider payload is stored in reconciliation details.

Decision rule JSON supports only `REQUIRED_STEP_FAILED`, `REQUIRED_STEPS_VERIFIED`, `RECONCILIATION_STATUS`, and `ALWAYS`. Rules are evaluated by ascending priority, then code. The default rules send failed required checks, partial matches, and mismatches to `MANUAL_REVIEW`; verified required checks with no concerning reconciliation result produce `VERIFIED`; all other cases produce `INSUFFICIENT_DATA` review. Rules can produce `REJECTED`, and reviewer rejection does so. Every decision is appended as history with a reason code.

## APIs and administration

All routes use the existing `/api/v1/kyc` prefix and client scoped authentication. `CLIENT_ADMIN` and `KYC_OPERATOR` roles may access them.

- `POST /workflows/start` with `riderId`, optional `workflowCode`, `reverify`, and optional `Idempotency-Key`.
- `POST /workflows/:id/steps/current` with the Phase 1 verification input and consent ID.
- `GET /workflows/:id`, `/workflows/riders/:riderId/current`, `/workflows/riders/:riderId/status`.
- `GET /admin/workflows`, `/admin/workflows/:id`, `/admin/workflow-definitions`, `/admin/workflow-definitions/:id`.
- `GET /admin/manual-reviews`, `/admin/manual-reviews/:id`.
- `POST /admin/manual-reviews/:id/approve` and `/reject` with a required reason.

The Next.js KYC page has workflows, manual review, and definition sections. Workflow details show ordered steps, safe classifications, decision history, and audit events. Review actions require confirmation and a reason. API queries always include the authenticated client's ID; no cross-client selector is exposed. Frontend role checks are supplemental to backend guards.

## Current limits

The default workflow waits for a user to provide PAN values and consent. The action mode field prepares future automatic steps, but no identity input is persisted for unattended provider calls. No Flutter or second provider work is part of this phase. Advanced package selection, configurable expiry/step conditions, identity data returned by other providers, and richer metrics/events remain future work.
