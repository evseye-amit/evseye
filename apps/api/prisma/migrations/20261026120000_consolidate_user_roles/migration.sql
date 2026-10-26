-- Consolidate legacy role values while retaining their existing user and legal-document assignments.
-- Rebuild the enum because ADVISOR and FLEET_MANAGER already exist alongside their legacy aliases.
CREATE TYPE "UserRole_consolidated" AS ENUM (
  'ADVISOR',
  'QC_MANAGER',
  'SUPER_ADMIN',
  'CLIENT_ADMIN',
  'FLEET_MANAGER',
  'TEAM_LEAD',
  'KYC_OPERATOR',
  'RIDER'
);

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_consolidated"
  USING (
    CASE "role"::text
      WHEN 'RFD_MANAGER' THEN 'ADVISOR'
      WHEN 'OPERATIONS_MANAGER' THEN 'FLEET_MANAGER'
      ELSE "role"::text
    END
  )::"UserRole_consolidated";

ALTER TABLE "AppLegalDocument"
  ALTER COLUMN "role" TYPE "UserRole_consolidated"
  USING (
    CASE "role"::text
      WHEN 'RFD_MANAGER' THEN 'ADVISOR'
      WHEN 'OPERATIONS_MANAGER' THEN 'FLEET_MANAGER'
      ELSE "role"::text
    END
  )::"UserRole_consolidated";

ALTER TABLE "AppLegalTemplate"
  ALTER COLUMN "role" TYPE "UserRole_consolidated"
  USING (
    CASE "role"::text
      WHEN 'RFD_MANAGER' THEN 'ADVISOR'
      WHEN 'OPERATIONS_MANAGER' THEN 'FLEET_MANAGER'
      ELSE "role"::text
    END
  )::"UserRole_consolidated";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_consolidated" RENAME TO "UserRole";
