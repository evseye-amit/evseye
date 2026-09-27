# Rider wallet Phase 2

```text
RiderWallet
├─ CASH account ─────────────┐
├─ REWARD account ───────────┤
├─ SECURITY_DEPOSIT account ─┼─ WalletTransaction → immutable WalletLedgerEntry
│  └─ WalletSecurityDeposit ──┤
│     └─ WalletHold ──────────┘
└─ client WalletPolicy → funding planner
```

## Buckets and balances

The Phase 1 journal remains the only financial source of truth. CREDIT raises rider account value; DEBIT lowers it. CASH and REWARD are distinct from SECURITY_DEPOSIT. The rider summary reports all three separately. Normal `totalBalance` and `availableBalance` include cash and rewards, never deposit. Account balance is posted credits minus posted debits, including reversing entries. Active holds reduce account availability by `amount - capturedAmount`. Cash availability also subtracts the policy minimum cash balance. A configured negative cash limit applies only to cash postings. Rewards and deposit cannot become negative. No balance cache is stored.

## Deposit lifecycle

An admin creates a requirement identified by `(client, rider, sourceType, sourceId)`. It snapshots required amount and policy version. Existing agreement-specific `RiderDeposit` records remain separate: they track rental billing obligations and are not the wallet journal. Funding is a `SECURITY_DEPOSIT` transaction: CREDIT deposit, DEBIT clearing. Overpayment is rejected under the wallet row lock. Partial funding is allowed by default. Fully funded requirements can be locked. Deposit values cannot fund ordinary charges.

An authorized deduction posts a debit to deposit and credit to clearing. Policy must explicitly allow the reason. A hold reserves deposit value without a posting. Deducting from a hold atomically posts the deduction and increments its captured amount; the remaining reservation can be released. Forfeiture is a separate transaction type and audit event. Refund eligibility checks status, active deposit holds, active allocation, active rental agreement, unpaid invoices, and positive refundable value. Future inspection, damage assessment, challan, and dispute blockers need integrations before automated refunds. A refund request reserves the requested amount with a hold but does not send money or post a refund.

Deposit summary values derive from wallet journal entries tied to the requirement and their reversals. `outstanding = max(required - funded, 0)`. `refundable = max(funded - deducted - refunded - active holds, 0)`. Lifecycle status and locked timestamp are stored domain state, not the financial record. A wallet reversal replays the deposit journal and reconciles its lifecycle status in the same transaction.

## Policy and funding

`WalletPolicy` is versioned by client; updates close the previous version and append a new one. The default denies reward usage, deposit deductions, negative cash, and refund requests. Admins can configure reward categories and cap, deposit deduction reasons, minimum cash, negative cash limit, partial deposit permission, and source priority. The funding planner uses exact decimals and returns a plan only. Default priority is REWARD, CASH, EXTERNAL_PAYMENT; rewards are subject to category and percentage rules. Security deposit is never a normal funding source. External payment is a planned remainder, not a gateway call.

## API and access

Riders read `GET /rider-app/wallet`, `/balance`, `/security-deposits`, and `/security-deposits/:id` through their authenticated rider identity. Client admins use `/wallets/policy`, `/wallets/riders/:riderId/security-deposits`, and `/wallets/security-deposits/:id` subpaths for funding, locking, holds, deductions, forfeiture, eligibility, and refund requests. `POST /wallets/:walletId/funding-plan` calculates a plan. Adjustment requests can target CASH or REWARD; deposit accounting uses its dedicated workflow. Client ID always comes from authentication context. Wallet row locks serialize money movement, holds, and deposit requirement changes. Financial operations use client-scoped idempotency keys and audit rows.

## Phase 3 boundary

No rate card charging, payment collection, provider call, external refund, or notification is performed. Before enabling automated external refunds, connect additional eligibility blockers and reconciliation. Database-backed concurrency and migration tests remain required for production rollout.
