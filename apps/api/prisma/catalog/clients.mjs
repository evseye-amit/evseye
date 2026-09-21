// Source of truth: 1 Client records and their configuration exported from the local development database on 2026-09-21.
// Uploaded documents, user credentials, and audit data are intentionally excluded from master data seeds.

export const clientCatalog = [
  {
    "client": {
      "name": "Yogmaya",
      "slug": "yogmaya",
      "companyCode": "yogmaya",
      "status": "ACTIVE",
      "isActive": true
    },
    "businessProfile": {
      "legalCompanyName": "EV SPARES INDIA PVT LTD",
      "clientType": "FLEET_OWNER",
      "businessType": "PVT_LTD",
      "industry": "LAST_MILE",
      "gstin": "06AHLPG8053D01ZM",
      "pan": "AHLPG8053D",
      "cinOrLlpin": null,
      "website": "https://www.evsparesindia.com",
      "logoObjectKey": "clients/d2f2a2b6-f6d1-4054-a786-d80fb2060b77/logo/8c6f77bc-ba09-425e-ba0f-43e1231f9f4e.jpg",
      "yearEstablished": 2025,
      "estimatedFleetSize": 100,
      "estimatedRiderCount": 10000,
      "estimatedUserCount": 100000
    },
    "contacts": [
      {
        "role": "PRIMARY",
        "name": "Amit Goyal",
        "designation": "Director",
        "mobile": "9871675222",
        "email": "evseye.amit@gmail.com",
        "alternateMobile": null
      },
      {
        "role": "ACCOUNT_ADMIN",
        "name": "Amit Goyal",
        "designation": "Director",
        "mobile": "9871675222",
        "email": "evseye.amit@gmail.com",
        "alternateMobile": null
      },
      {
        "role": "BILLING",
        "name": "Amit Goyal",
        "designation": null,
        "mobile": "9871675222",
        "email": "evseye.amit@gmail.com",
        "alternateMobile": null
      }
    ],
    "addresses": [
      {
        "type": "REGISTERED",
        "line1": "Sector 15, Part 2",
        "line2": "HOPE Apartments",
        "landmark": null,
        "city": "Gurugram",
        "district": "Gurugram",
        "state": "Haryana",
        "country": "India",
        "pinCode": "122001"
      },
      {
        "type": "BILLING",
        "line1": "Sector 15, Part 2",
        "line2": "HOPE Apartments",
        "landmark": null,
        "city": "Gurugram",
        "district": "Gurugram",
        "state": "Haryana",
        "country": "India",
        "pinCode": "122001"
      }
    ],
    "operationsProfile": {
      "fleetBusinessModel": "OWNED",
      "numberOfFleets": 50,
      "approximateRiderCount": 10000,
      "vehicleOwnership": "OWNED",
      "operationalHubCount": 1,
      "vehicleCategoryCodes": [
        "2W"
      ]
    },
    "billingProfile": {
      "billingContactName": "Amit Goyal",
      "billingEmail": "evseye.amit@gmail.com",
      "billingMobile": "9871675222",
      "purchaseOrderRequired": false,
      "poNumber": null,
      "paymentTerms": null,
      "taxApplicable": true
    },
    "agreement": {
      "authorizedSignatoryName": "Amit Goyal",
      "designation": "Director",
      "termsAcceptedAt": "2026-09-20T19:01:28.065Z",
      "privacyAcceptedAt": "2026-09-20T19:01:28.065Z",
      "dataProcessingConsentAt": "2026-09-20T19:01:28.065Z",
      "kycConsentAt": "2026-09-20T19:01:28.065Z",
      "marketingConsentAt": "2026-09-20T19:01:28.065Z",
      "submittedAt": null,
      "approvedAt": "2026-09-21T03:43:44.693Z",
      "rejectedAt": null,
      "rejectionReason": null
    },
    "branding": {
      "logoObjectKey": "clients/d2f2a2b6-f6d1-4054-a786-d80fb2060b77/logo/8c6f77bc-ba09-425e-ba0f-43e1231f9f4e.jpg",
      "faviconObjectKey": null,
      "primaryColor": "#176b4c",
      "secondaryColor": "#e4f2e9",
      "accentColor": "#27865f",
      "loginTitle": "Welcome back",
      "loginSubtitle": "Sign in to your EV fleet workspace.",
      "supportEmail": null,
      "supportPhone": null
    },
    "domains": [],
    "subscriptions": [
      {
        "billingCycle": "MONTHLY",
        "status": "ACTIVE",
        "vehicleCount": 50,
        "tierMinVehicles": 1,
        "tierMaxVehicles": 100,
        "tierMode": "VOLUME",
        "currency": "INR",
        "autoRenew": true,
        "packageCode": "BASIC",
        "startDate": "2026-09-20",
        "endDate": null,
        "setupFee": "50000",
        "pricePerVehicle": "415",
        "recurringAmount": "20750"
      }
    ]
  }
];
