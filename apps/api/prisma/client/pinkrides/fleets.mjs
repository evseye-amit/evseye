const rows = [
  ['UGLKW26065192','UGLKW26065743','UGLKW26065081','WHITE'],
  ['UGLKW26052249','UGLKW26065506','UGLKW26065056','WHITE'],
  ['UGLKW26065060','UGLKW26064897','UGLKW26065193','WHITE'],
  ['UGLKW26065097','UGLKW26065718','UGLKW26065101','WHITE'],
  ['UGLKW26065093','UGLKW26064895','UGLKW26065295','WHITE'],
  ['UGLKW26051752','UGLKW26065115','UGLKW26065088','WHITE'],
  ['UGLKW26064095','UGLKW26065549','UGLKW26065070','WHITE'],
  ['UGLKW26065067','UGLKW26064919','UGLKW26065183','BLACK'],
  ['UGLKW26065118','UGLKW26064987','UGLKW26065276','BLACK'],
  ['UGLKW26065148','UGLKW26065144','UGLKW26065283','BLACK'],
];

export const fleets = rows.map(([chassisNumber, motorNumber, controllerNumber, colour], index) => {
  const number = String(index + 1).padStart(4, '0');
  return {
    fleetCode: `ES-2W-LS-HYD-${number}`,
    vehicleNumber: null,
    chassisNumber,
    vinNumber: `PR-AP-A-${number}`,
    oemCode: 'ESPRINTO',
    vehicleCategoryCode: '2W',
    // The master catalog uses SCOOTER_ELECTRIC for the electric scooter type.
    vehicleTypeCode: 'SCOOTER_ELECTRIC',
    homeHubCode: 'HUB-TEL-01',
    currentHubCode: 'HUB-TEL-01',
    speedType: 'SLOW_SPEED',
    modelName: 'SL',
    colour,
    manufacturingYear: 2026,
    manufacturingMonth: 10,
    motorNumber,
    ownershipType: 'CLIENT_OWNED',
    status: 'PENDING_ACTIVATION',
    allocationEnabled: true,
    onboardingStatus: 'DRAFT',
    odometerKm: '10',
    metadata: { source: 'PINK RIDES DATA.csv', controllerNumber },
  };
});

export const controllers = rows.map(([, , controllerNumber]) => ({
  controllerNumber,
  manufacturer: 'ESPRINTO',
  model: 'SL',
  status: 'AVAILABLE',
}));

export const fleetComponentMappings = fleets.map((fleet, index) => ({
  fleetCode: fleet.fleetCode,
  controllerNumber: controllers[index].controllerNumber,
}));
