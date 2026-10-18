# Rider current deployment and Home

`GET /api/v1/mobile-deployments/rider/current` uses the Rider bearer token and
returns `{ data: ... }`.

- No Rider profile: `screen: ONBOARDING`.
- No current deployment and no previous handover: `screen: WAITING`.
- A deployment in progress: existing payment, plan acceptance, PDI and training
  routing is preserved.
- Deployed scooter: `screen: HOME` with the current allocation.
- Scooter physically submitted: `screen: HOME` with `allocation`, `workflow`,
  `payment` and `commercial` explicitly `null`. Completed/cancelled allocations
  cannot supply current scooter details. A scheduled return alone does not hide
  a scooter still with the rider.

Home responses include `wallet` (ID, status and existing wallet balance fields,
including cash, rewards and security deposit buckets) and `lastEarnings`.
Financials are scoped to the authenticated rider's wallet, independently of the
allocation. `lastEarnings` is the latest `POSTED` wallet credit of type `REWARD`,
`REFERRAL_REWARD` or `SELF_SUBMISSION_REWARD`, with ID, type, amount, currency,
description and postedAt. Top-ups, refunds, pending and reversed transactions
are excluded. This is reward earning data, not external delivery income; no
external income source exists in this backend. No posted reward means `null`.
Non-Home responses have `wallet: null` and `lastEarnings: null`.

Current scooter details include `allocation.fleet.frontPhoto`:

```json
{
  "id": "<photo ID>",
  "url": "<signed display URL>",
  "expiresAt": "2026-10-18T12:05:00.000Z"
}
```

Only completed `FRONT` photos from this allocation's `PRE_ALLOCATION` inspection
are eligible. If more than one exists, the latest uploaded photo is used.
Missing inspection or completed photo returns `frontPhoto: null`. Refresh the
API response after URL expiry. Return inspections and photos belonging to other
allocations are not used. Submission procedures remain unchanged.
