-- Package-level feature configuration is no longer supported.
-- Client-specific overrides belong to ClientWorkflowRevision instead.
ALTER TABLE "PackageFeature" DROP COLUMN IF EXISTS "configuration";
