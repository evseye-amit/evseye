// Source of truth: the Feature Add-On catalog exported from the local
// development database on 2026-09-20. `featureCode` and `packageCode` keep
// the catalog portable across fresh databases.
const effectiveFrom = '2026-09-01';
const defaults = { currency: 'INR', effectiveFrom, effectiveTo: null, isActive: true };

export const featureAddOnCatalog = [
  { featureCode: 'EMAIL_LOGIN_OTP', code: 'EMAIL_1000_30D', name: '1000 Add on Emails for 30 Days ', description: '1000 Add on Emails for 30 Days ', quantity: 1000, costPrice: 150, salePrice: 225, discount: 10, validityDays: 30, ...defaults },
  { featureCode: 'EMAIL_LOGIN_OTP', code: 'EMAIL_2000_90D', name: '2000 Add on Emails for 90 Days', description: '2000 Add on Emails for 90 Days', quantity: 2000, costPrice: 300, salePrice: 425, discount: 15, validityDays: 90, ...defaults },
  { featureCode: 'EMAIL_LOGIN_OTP', code: 'EMAIL_5000_1Yr', name: '5000 Add on Emails for 1yr', description: '5000 Add on Emails for 1yr', quantity: 5000, costPrice: 750, salePrice: 937.5, discount: 25, validityDays: 365, ...defaults },
  { featureCode: 'SMS_LOGIN_OTP', code: 'SMS_1000_30D', name: 'SMS 1000', description: null, quantity: 1000, costPrice: 250, salePrice: 450, discount: 10, validityDays: 30, ...defaults },
  { featureCode: 'SMS_LOGIN_OTP', code: 'SMS_2000_90D', name: 'SMS 2000', description: null, quantity: 2000, costPrice: 500, salePrice: 850, discount: 15, validityDays: 90, ...defaults },
  { featureCode: 'SMS_LOGIN_OTP', code: 'SMS_5000_1Yr', name: 'SMS 5000', description: null, quantity: 5000, costPrice: 1250, salePrice: 1875, discount: 25, validityDays: 365, ...defaults },
];
