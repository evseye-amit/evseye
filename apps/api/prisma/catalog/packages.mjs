// Imported from the approved package_master workbook. This catalog owns only
// package-master data; package features are configured separately.
export const packageCatalog = [
  {
    code: 'BASIC',
    name: 'Basic',
    description: 'Essential rider onboarding and verification',
    setupFee: 50000,
    currency: 'INR',
    displayOrder: 1,
    isCustom: false,
    isActive: true,
  },
  {
    code: 'STANDARD',
    name: 'Standard',
    description: 'Basic features plus rider training',
    setupFee: 75000,
    currency: 'INR',
    displayOrder: 2,
    isCustom: false,
    isActive: true,
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    description: 'Standard features plus face recognition',
    setupFee: 100000,
    currency: 'INR',
    displayOrder: 3,
    isCustom: false,
    isActive: true,
  },
  {
    code: 'CUSTOM',
    name: 'Custom',
    description: 'Custom package configured for enterprise clients',
    currency: 'INR',
    displayOrder: 4,
    isCustom: true,
    isActive: true,
  },
];
