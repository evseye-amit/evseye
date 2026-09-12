-- Align client subscriptions with the commercial contract while preserving
-- existing subscription records.
ALTER TABLE "ClientSubscription" RENAME COLUMN "packageStartDate" TO "startDate";
ALTER TABLE "ClientSubscription" RENAME COLUMN "basePackagePrice" TO "listPrice";
ALTER TABLE "ClientSubscription" RENAME COLUMN "discount" TO "discountValue";
ALTER TABLE "ClientSubscription" RENAME COLUMN "autoRenewal" TO "autoRenew";

ALTER TABLE "ClientSubscription"
  ADD COLUMN "endDate" DATE,
  ADD COLUMN "finalPackagePrice" DECIMAL(14,2);

ALTER TABLE "ClientSubscription"
  ALTER COLUMN "startDate" TYPE DATE USING "startDate"::date,
  ALTER COLUMN "currency" TYPE VARCHAR(10),
  ALTER COLUMN "listPrice" TYPE DECIMAL(14,2),
  ALTER COLUMN "discountValue" TYPE DECIMAL(14,2);

UPDATE "ClientSubscription"
SET "finalPackagePrice" = GREATEST("listPrice" - COALESCE("discountValue", 0), 0)
WHERE "finalPackagePrice" IS NULL;

ALTER TABLE "ClientSubscription"
  ALTER COLUMN "finalPackagePrice" SET NOT NULL,
  DROP COLUMN "trialApplicable",
  DROP COLUMN "trialDays",
  DROP COLUMN "billingFrequency",
  DROP COLUMN "taxRate",
  DROP COLUMN "paymentTerms",
  DROP COLUMN "poNumber";
