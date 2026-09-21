-- Reconciles the original Work Vendor field with the final Work Partner terminology.
-- It is safe for databases that temporarily received both columns during development.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MobileDeploymentWorkflow'
      AND column_name = 'workVendorName'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MobileDeploymentWorkflow'
      AND column_name = 'workPartnerName'
  ) THEN
    ALTER TABLE "MobileDeploymentWorkflow"
      RENAME COLUMN "workVendorName" TO "workPartnerName";
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MobileDeploymentWorkflow'
      AND column_name = 'workVendorName'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MobileDeploymentWorkflow'
      AND column_name = 'workPartnerName'
  ) THEN
    UPDATE "MobileDeploymentWorkflow"
    SET "workPartnerName" = COALESCE("workPartnerName", "workVendorName")
    WHERE "workVendorName" IS NOT NULL;

    ALTER TABLE "MobileDeploymentWorkflow"
      DROP COLUMN "workVendorName";
  END IF;
END $$;
