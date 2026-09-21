// Source of truth: 1 Fleet Component Mapping records exported from the local development database on 2026-09-21.
// Current IoT assignments and battery/controller installation histories are keyed by stable component identifiers.

export const fleetComponentMappings = [
  {
    "clientSlug": "yogmaya",
    "fleetCode": "EV000001",
    "iotDeviceNumber": "IOT-0000001",
    "batteries": [
      {
        "serialNumber": "BAT-EV-0000001",
        "batterySlot": "PRIMARY",
        "installedAt": "2026-09-21T02:15:44.981Z",
        "removedAt": null,
        "installedOdometerKm": null,
        "removedOdometerKm": null,
        "reason": null
      }
    ],
    "controllers": [
      {
        "controllerNumber": "CTRL-EV-0000001",
        "installedAt": "2026-09-21T02:15:47.470Z",
        "removedAt": null,
        "reason": null
      }
    ]
  }
];
