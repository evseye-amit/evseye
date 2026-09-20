// Source of truth: Package catalog exported from the local development
// database on 2026-09-20. The MAX_INT values represent unlimited limits.
export const packageCatalog = [
  { code: 'BASIC', name: 'Basic', description: 'Essential rider onboarding and verification', setupFee: 50000, currency: 'INR', maxFleets: 9000, maxRiders: 9000, maxAdmins: 2, maxFleetManagers: 3, maxHubs: 3, maxTeamLeaders: 10, maxClusterManagers: 2, maxUsers: 10000, trialDays: 0, displayOrder: 1, isCustom: false, isActive: true },
  { code: 'STANDARD', name: 'Standard', description: 'Basic features plus rider training', setupFee: 75000, currency: 'INR', maxFleets: 19000, maxRiders: 19000, maxAdmins: 5, maxFleetManagers: 10, maxHubs: 10, maxTeamLeaders: 50, maxClusterManagers: 20, maxUsers: 20000, trialDays: 0, displayOrder: 2, isCustom: false, isActive: true },
  { code: 'PREMIUM', name: 'Premium', description: 'Standard features plus face recognition', setupFee: 100000, currency: 'INR', maxFleets: 49000, maxRiders: 49000, maxAdmins: 50, maxFleetManagers: 100, maxHubs: 100, maxTeamLeaders: 250, maxClusterManagers: 150, maxUsers: 50000, trialDays: 0, displayOrder: 3, isCustom: false, isActive: true },
  { code: 'CUSTOM', name: 'Custom', description: 'Custom package configured for enterprise clients', setupFee: 0, currency: 'INR', maxFleets: 2147483647, maxRiders: 2147483647, maxAdmins: 2147483647, maxFleetManagers: 2147483647, maxHubs: 2147483647, maxTeamLeaders: 2147483647, maxClusterManagers: 2147483647, maxUsers: 2147483647, trialDays: 0, displayOrder: 4, isCustom: true, isActive: true },
];
