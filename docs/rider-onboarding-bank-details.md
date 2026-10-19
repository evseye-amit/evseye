# Rider onboarding bank details

Bank capture is part of `CAPTURE_BANK_ACCOUNT` in the `RIDER_COMMERCIALS` (Commercial & Payment Details) step. The feature must be present and enabled in the client's published package/workflow. It is not added to packages that exclude it.

`GET /api/v1/rider-app/onboarding` returns the six field configurations and the commercial `stepId`. `GET /api/v1/riders/onboarding-configuration` exposes the same fields for panel create/edit/import. Fields share a feature ID; identify individual inputs by `fieldCode`.

Save using the existing API:

`POST /api/v1/rider-app/onboarding/steps`

```json
{
  "stepId": "<commercial step UUID from the configuration>",
  "values": {
    "BANK_ACCOUNT_NUMBER": "123456789012",
    "IFSC_CODE": "SBIN0032386",
    "BANK_NAME": "State Bank of India",
    "BANK_BRANCH": "Branch name",
    "BANK_CITY": "City",
    "BANK_STATE": "State"
  }
}
```

Include other required fields configured in the same step, if any.

- Account number and IFSC are required by default. Bank name, branch, city and state are optional.
- Account number must be a **string** of 6–40 digits. Leading zeroes are preserved; do not convert it to a number in the app or spreadsheet import.
- IFSC is trimmed and uppercased, then checked against `^[A-Z]{4}0[A-Z0-9]{6}$`.
- Optional fields are trimmed. Maximum lengths: bank name 150, branch 200, city/state 100 characters.
- Invalid bank values are rejected before saving step progress. A bank step with required bank fields cannot be skipped.
- A client's configured field-level required/editable/disabled/validation settings continue to apply.

Values are saved in onboarding progress immediately. When onboarding completes, they are stored in Rider metadata under `bankAccountNumber`, `ifscCode`, `bankName`, `bankBranch`, `bankCity`, `bankState`. Resubmitting the completed onboarding flow updates the existing rider's supplied bank values and preserves unrelated metadata.

## Optional IFSC lookup

The existing `GET /api/v1/banks/ifsc/:ifsc` is available to Riders and Fleet Managers. The app may use it to prefill:

- `ifsc` → `IFSC_CODE`
- `bankName` → `BANK_NAME`
- `branch` → `BANK_BRANCH`
- `city` → `BANK_CITY`
- `state` → `BANK_STATE`

Onboarding accepts the supplied optional descriptors; it does not call the provider automatically or verify bank-account ownership. Existing KYC verification is separate.

## Configuration and rollout

The bank feature seed now includes six field definitions. The API expands the existing bank feature into those fields, including previously published bank features with empty configuration; no published revision is rewritten and excluded/disabled bank features stay excluded.

The existing panel forms already render these fields from onboarding configuration. The Flutter app is outside this repository and must render/send these field codes. No bank schema migration or seed execution is required for the runtime support; future feature seed runs include the explicit definitions. No local API restart/deployment is included in this change.
