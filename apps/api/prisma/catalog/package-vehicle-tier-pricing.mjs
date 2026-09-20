// Source of truth: Package Vehicle Tier Pricing exported from the local
// development database on 2026-09-21. Each range uses volume pricing.
const defaults = {
  currency: 'INR',
  billingPeriod: 'MONTHLY',
  tierMode: 'VOLUME',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  isActive: true,
};

export const packageVehicleTierPricingCatalog = [
  { packageCode: 'BASIC', minVehicles: 1, maxVehicles: 100, pricePerVehicle: 415, ...defaults },
  { packageCode: 'BASIC', minVehicles: 101, maxVehicles: 250, pricePerVehicle: 365, ...defaults },
  { packageCode: 'BASIC', minVehicles: 251, maxVehicles: 500, pricePerVehicle: 348, ...defaults },
  { packageCode: 'BASIC', minVehicles: 501, maxVehicles: null, pricePerVehicle: 332, ...defaults },
  { packageCode: 'STANDARD', minVehicles: 1, maxVehicles: 100, pricePerVehicle: 498, ...defaults },
  { packageCode: 'STANDARD', minVehicles: 101, maxVehicles: 250, pricePerVehicle: 448, ...defaults },
  { packageCode: 'STANDARD', minVehicles: 251, maxVehicles: 500, pricePerVehicle: 432, ...defaults },
  { packageCode: 'STANDARD', minVehicles: 501, maxVehicles: null, pricePerVehicle: 415, ...defaults },
  { packageCode: 'PREMIUM', minVehicles: 1, maxVehicles: 100, pricePerVehicle: 748, ...defaults },
  { packageCode: 'PREMIUM', minVehicles: 101, maxVehicles: 250, pricePerVehicle: 715, ...defaults },
  { packageCode: 'PREMIUM', minVehicles: 251, maxVehicles: 500, pricePerVehicle: 698, ...defaults },
  { packageCode: 'PREMIUM', minVehicles: 501, maxVehicles: null, pricePerVehicle: 665, ...defaults },
];
