CREATE TYPE "FleetOperatingMode" AS ENUM ('SIMPLE', 'ONBOARDING_EVIDENCE');

-- Simple mode is the starting policy for existing and new development clients.
-- No fleet is automatically activated and no historical photos are removed.
ALTER TABLE "Client" ADD COLUMN "fleetOperatingMode" "FleetOperatingMode" NOT NULL DEFAULT 'SIMPLE';
