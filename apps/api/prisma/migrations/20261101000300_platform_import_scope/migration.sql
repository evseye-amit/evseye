-- Enable platform-scoped master-data import jobs.
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'OEM';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VEHICLE_CATEGORY';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VEHICLE_TYPE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'FEATURE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'PACKAGE';

CREATE TYPE "ImportScope" AS ENUM ('CLIENT', 'PLATFORM');

ALTER TABLE "ImportJob" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "ImportJob" ADD COLUMN "scope" "ImportScope" NOT NULL DEFAULT 'CLIENT';

CREATE INDEX "ImportJob_scope_entityType_createdAt_idx"
  ON "ImportJob"("scope", "entityType", "createdAt");
