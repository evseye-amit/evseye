-- Normalize the external pricing catalog's legacy labels before enforcing the
-- shared FeatureBillingUnit enum. Existing records are preserved.
UPDATE "FeaturePricing"
SET "billingUnit" = CASE "billingUnit"
  WHEN 'OTP' THEN 'API_CALL'
  WHEN 'MANDATE' THEN 'USER'
  WHEN 'SIGNATURE' THEN 'USER'
  WHEN 'TENANT_MONTH' THEN 'MONTH'
  ELSE "billingUnit"
END;

ALTER TABLE "FeaturePricing"
ALTER COLUMN "billingUnit" TYPE "FeatureBillingUnit"
USING "billingUnit"::"FeatureBillingUnit";
