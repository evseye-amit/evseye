# Commercial catalog and subscriptions

The platform uses a master commercial catalog and client snapshots. Master package and feature prices are never changed when a client receives a negotiated rate.

## Admin endpoints

- `POST /api/v1/platform/commercial/subscriptions/quote`
- `POST /api/v1/platform/commercial/subscriptions`
- `PATCH /api/v1/platform/commercial/subscriptions/:id/vehicle-count`
- `POST /api/v1/platform/commercial/packages/:packageId/vehicle-tiers`
- `POST /api/v1/platform/commercial/feature-addons`
- `POST /api/v1/platform/commercial/clients/:clientId/addon-purchases`
- `POST /api/v1/platform/commercial/clients/:clientId/feature-usage/consume`
- `POST /api/v1/platform/commercial/maintenance/run`

All endpoints require a Super Admin session.

## Quote example

```json
POST /api/v1/platform/commercial/subscriptions/quote
{
  "clientId": "client-id",
  "packageCode": "BASIC",
  "vehicleCount": 50,
  "billingCycle": "MONTHLY"
}
```

The quote returns the matched tier, per vehicle price, recurring amount, setup fee, included features, available add-ons, and applicable client adjustments. It never includes feature cost prices.

## Seeded commercial values

| Package | Setup fee | 1–99 | 100–249 | 250–499 | 500+ |
| --- | ---: | ---: | ---: | ---: | ---: |
| BASIC | ₹50,000 | ₹249 | ₹219 | unconfigured | ₹199 |
| STANDARD | ₹75,000 | ₹299 | ₹269 | unconfigured | ₹249 |
| PREMIUM | ₹100,000 | ₹449 | ₹429 | unconfigured | ₹399 |

The 250–499 tier intentionally has no seed price. Quote creation returns a pricing configuration error until an administrator configures that tier.

The seed also creates SMS Notification with ₹0.20 cost and ₹0.50 sale price, BASIC's monthly 1,200 SMS allowance, and the SMS 1,000/2,000/5,000 add-ons specified in the business requirements.

## Allowance and credit maintenance

Commercial maintenance runs automatically at midnight in the `Asia/Kolkata` timezone. `POST /api/v1/platform/commercial/maintenance/run` remains available for a manual recovery run. The process is safe to retry and safe to run from more than one worker:

- It grants each recurring package allowance only once for its subscription period.
- It expires remaining credits in expired lots and records an `EXPIRE` ledger entry.
- It marks expired add-on purchases as `EXPIRED`.
- It removes unused package allowance at a reset only when that feature does not allow rollover.

The manual endpoint is intentionally restricted to Super Admins; local development can call it after signing in as a Super Admin.
