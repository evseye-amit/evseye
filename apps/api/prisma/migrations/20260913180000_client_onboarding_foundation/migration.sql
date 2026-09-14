-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('OPERATIONS', 'PARKING', 'CHARGING', 'BATTERY_SWAP', 'MAINTENANCE', 'WAREHOUSE', 'DELIVERY', 'MIXED');

-- CreateEnum
CREATE TYPE "HubStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED', 'UNDER_MAINTENANCE', 'FULL');

-- CreateEnum
CREATE TYPE "ClientOnboardingStep" AS ENUM ('HUBS', 'FLEET_MANAGERS', 'TEAM_LEADERS', 'FLEETS', 'RIDERS', 'REVIEW');

-- CreateEnum
CREATE TYPE "ClientOnboardingStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('HUB', 'FLEET_MANAGER', 'TEAM_LEADER', 'FLEET', 'RIDER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PASS', 'PARTIAL_PASS', 'FAIL');

-- AlterEnum
BEGIN;
CREATE TYPE "RiderStatus_new" AS ENUM ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'EXITED');
ALTER TABLE "public"."Rider" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Rider" ALTER COLUMN "status" TYPE "RiderStatus_new" USING ("status"::text::"RiderStatus_new");
ALTER TYPE "RiderStatus" RENAME TO "RiderStatus_old";
ALTER TYPE "RiderStatus_new" RENAME TO "RiderStatus";
DROP TYPE "public"."RiderStatus_old";
ALTER TABLE "Rider" ALTER COLUMN "status" SET DEFAULT 'ONBOARDING';
COMMIT;

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'TEAM_LEAD';

-- DropForeignKey
ALTER TABLE "Fleet" DROP CONSTRAINT "Fleet_hubId_fkey";

-- DropForeignKey
ALTER TABLE "Hub" DROP CONSTRAINT "Hub_clientId_fkey";

-- DropIndex
DROP INDEX "Fleet_clientId_hubId_idx";

-- AlterTable
ALTER TABLE "Fleet" DROP COLUMN "hubId",
ADD COLUMN     "currentHubId" TEXT,
ADD COLUMN     "homeHubId" TEXT;

-- AlterTable
ALTER TABLE "Hub" ADD COLUMN     "addressLine1" VARCHAR(255),
ADD COLUMN     "addressLine2" VARCHAR(255),
ADD COLUMN     "batteryCapacity" INTEGER,
ADD COLUMN     "chargingPoints" INTEGER,
ADD COLUMN     "city" VARCHAR(100) NOT NULL DEFAULT '',
ADD COLUMN     "closingTime" VARCHAR(5),
ADD COLUMN     "contactEmail" VARCHAR(150),
ADD COLUMN     "contactName" VARCHAR(150),
ADD COLUMN     "contactPhone" VARCHAR(20),
ADD COLUMN     "country" VARCHAR(100) NOT NULL DEFAULT 'India',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "district" VARCHAR(100),
ADD COLUMN     "is24x7" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "landmark" VARCHAR(150),
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "openingTime" VARCHAR(5),
ADD COLUMN     "parentHubId" TEXT,
ADD COLUMN     "parkingSlots" INTEGER,
ADD COLUMN     "postalCode" VARCHAR(10),
ADD COLUMN     "riderCapacity" INTEGER,
ADD COLUMN     "state" VARCHAR(100) NOT NULL DEFAULT '',
ADD COLUMN     "status" "HubStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supportsAllocation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsBatterySwapping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsCharging" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsDeallocation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsMaintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsPdi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "swappingPoints" INTEGER,
ADD COLUMN     "type" "HubType" NOT NULL DEFAULT 'OPERATIONS',
ADD COLUMN     "vehicleCapacity" INTEGER,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(150),
ALTER COLUMN "code" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "addressLine1" VARCHAR(255),
ADD COLUMN     "addressLine2" VARCHAR(255),
ADD COLUMN     "city" VARCHAR(100),
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "emergencyContactMobile" VARCHAR(20),
ADD COLUMN     "emergencyContactName" VARCHAR(150),
ADD COLUMN     "exitDate" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "joiningDate" DATE,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "postalCode" VARCHAR(10),
ADD COLUMN     "riderCode" VARCHAR(50),
ADD COLUMN     "state" VARCHAR(100),
ALTER COLUMN "status" SET DEFAULT 'ONBOARDING';

-- CreateTable
CREATE TABLE "UserHub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" VARCHAR(50),
    "designation" VARCHAR(100),
    "joiningDate" DATE,
    "leavingDate" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TeamLeaderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderRider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamLeaderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamLeaderRider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentStep" "ClientOnboardingStep" NOT NULL DEFAULT 'HUBS',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingStepRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "step" "ClientOnboardingStep" NOT NULL,
    "status" "ClientOnboardingStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "savedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingStepRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "passedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "failureReportKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserHub_clientId_hubId_idx" ON "UserHub"("clientId", "hubId");

-- CreateIndex
CREATE INDEX "UserHub_clientId_userId_idx" ON "UserHub"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserHub_userId_hubId_key" ON "UserHub"("userId", "hubId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_userId_key" ON "TeamLeaderProfile"("userId");

-- CreateIndex
CREATE INDEX "TeamLeaderProfile_clientId_deletedAt_idx" ON "TeamLeaderProfile"("clientId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_clientId_employeeCode_key" ON "TeamLeaderProfile"("clientId", "employeeCode");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_teamLeaderId_isActive_idx" ON "TeamLeaderRider"("clientId", "teamLeaderId", "isActive");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_riderId_isActive_idx" ON "TeamLeaderRider"("clientId", "riderId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderRider_teamLeaderId_riderId_key" ON "TeamLeaderRider"("teamLeaderId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingProgress_clientId_key" ON "ClientOnboardingProgress"("clientId");

-- CreateIndex
CREATE INDEX "ClientOnboardingStepRecord_clientId_step_status_idx" ON "ClientOnboardingStepRecord"("clientId", "step", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingStepRecord_progressId_step_key" ON "ClientOnboardingStepRecord"("progressId", "step");

-- CreateIndex
CREATE INDEX "ImportJob_clientId_entityType_createdAt_idx" ON "ImportJob"("clientId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "Fleet_clientId_homeHubId_idx" ON "Fleet"("clientId", "homeHubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_currentHubId_idx" ON "Fleet"("clientId", "currentHubId");

-- CreateIndex
CREATE INDEX "Hub_clientId_status_idx" ON "Hub"("clientId", "status");

-- CreateIndex
CREATE INDEX "Hub_clientId_city_idx" ON "Hub"("clientId", "city");

-- CreateIndex
CREATE INDEX "Hub_parentHubId_idx" ON "Hub"("parentHubId");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_riderCode_key" ON "Rider"("clientId", "riderCode");

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_parentHubId_fkey" FOREIGN KEY ("parentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_homeHubId_fkey" FOREIGN KEY ("homeHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_currentHubId_fkey" FOREIGN KEY ("currentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_teamLeaderId_fkey" FOREIGN KEY ("teamLeaderId") REFERENCES "TeamLeaderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingProgress" ADD CONSTRAINT "ClientOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "ClientOnboardingProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

