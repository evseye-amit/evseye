// Source of truth: Package Feature assignments exported from the local
// development database on 2026-09-20. Codes keep the seed portable.
const basicAllowance = {
  packageCode: 'BASIC',
  isIncluded: true,
  includedQuantity: 500,
  resetPeriod: 'MONTHLY',
  isUnlimited: false,
  rolloverAllowed: false,
  configuration: null,
};

export const packageFeatureCatalog = [
  { featureCode: 'CAPTURE_MOBILE_NUMBER', displayOrder: 10, ...basicAllowance },
  { featureCode: 'CAPTRUE_LOGIN_OTP', displayOrder: 20, ...basicAllowance },
  { featureCode: 'SMS_LOGIN_OTP', displayOrder: 30, ...basicAllowance },
  { featureCode: 'CAPTURE_AGE', displayOrder: 40, ...basicAllowance },
  { featureCode: 'CAPTURE_ADDRESS', displayOrder: 50, ...basicAllowance },
  { featureCode: 'ADDRESS_PROOF_DOCUMENT', displayOrder: 60, ...basicAllowance },
  { featureCode: 'UPLOAD_PROFILE_PHOTO', displayOrder: 70, ...basicAllowance },
  { featureCode: 'CAPTURE_AADHAAR', displayOrder: 80, ...basicAllowance },
  { featureCode: 'AADHAR_PROOF_DOCUMENT', displayOrder: 90, ...basicAllowance },
  { featureCode: 'CAPTURE_PAN', displayOrder: 100, ...basicAllowance },
  { featureCode: 'PAN_PROOF_DOCUMENT', displayOrder: 110, ...basicAllowance },
  { featureCode: 'CAPTURE_DRIVING_LICENSE', displayOrder: 120, ...basicAllowance },
  { featureCode: 'DRIVING_LICENCE_PROOF_DOCUMENT', displayOrder: 130, ...basicAllowance },
  { featureCode: 'AGE_VERIFICATION', displayOrder: 140, ...basicAllowance },
  { featureCode: 'CAPTURE_REFERENCE', displayOrder: 150, ...basicAllowance },
  { featureCode: 'CAPTURE_BANK_ACCOUNT', displayOrder: 160, ...basicAllowance },
  { featureCode: 'BANK_VERIFICATION', displayOrder: 170, ...basicAllowance },
  { featureCode: 'BANK_PROOF_DOCUMENT', displayOrder: 180, ...basicAllowance },
  { featureCode: 'SHOW_AGREEMENT_E_SIGN', displayOrder: 190, ...basicAllowance },
];
