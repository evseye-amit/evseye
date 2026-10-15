// Source of truth: 2 Fleet Manager, Team Lead, and Cluster Manager records exported from the local development database on 2026-09-21.
// Cluster Manager uses the OPERATIONS_MANAGER role in the current schema. Hub assignments are applied when the referenced client hub has been seeded.

export const clientManagerCatalog = [
  {
    "clientSlug": "yogmaya",
    "mobile": "+919200000000",
    "name": "Amit Goyal",
    "role": "FLEET_MANAGER",
    "isActive": true,
    "deletedAt": null,
    "hubAssignments": [
      {
        "hubCode": "HUB-GGN-SEC-15",
        "isPrimary": true
      }
    ],
    "teamLeaderProfile": null
  },
  {
    "clientSlug": "yogmaya",
    "mobile": "+919300000000",
    "name": "Amit TL",
    "role": "TEAM_LEAD",
    "isActive": true,
    "deletedAt": null,
    "hubAssignments": [],
    "teamLeaderProfile": {
      "employeeCode": "TL-0000001",
      "designation": "Team Lead",
      "joiningDate": "2026-09-01",
      "leavingDate": null,
      "metadata": null,
      "deletedAt": null
    }
  }
];
