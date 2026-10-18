# IFSC bank lookup API

`GET /api/v1/banks/ifsc/:ifsc` requires a bearer access token and is available
to the mobile `RIDER` and `FLEET_MANAGER` roles. The endpoint does not read or
write account data. Responses use the normal `{ "data": ... }` envelope.

```sh
curl "$API/api/v1/banks/ifsc/HDFC0000001" \
  -H "Authorization: Bearer $TOKEN"
```

Example response:

```json
{
  "data": {
    "ifsc": "HDFC0000001",
    "bankName": "HDFC Bank",
    "branch": "MUMBAI MAIN",
    "address": "1 Main Street",
    "city": "Mumbai",
    "district": "Mumbai Suburban",
    "state": "MAHARASHTRA",
    "micr": null
  }
}
```

The IFSC is trimmed and normalized to uppercase. It must match the Indian
11-character format: four letters, `0`, then six letters or digits.

Errors are returned in the standard error envelope:

- `400`: invalid IFSC format.
- `404`: the provider has no details for the valid IFSC.
- `502`: the provider returned an invalid or rejected response.
- `503`: the provider is unavailable or the request timed out.

Successful lookups are cached in process for five minutes, with a maximum of
256 entries. A cache is local to one API process and is not shared between
instances.
