-- CreateEnum
CREATE TYPE "FleetOnboardingStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VehicleSpeedType" AS ENUM ('SLOW_SPEED', 'HIGH_SPEED');

-- CreateEnum
CREATE TYPE "FleetOwnershipType" AS ENUM ('CLIENT_OWNED', 'LEASED', 'ATTACHED', 'OEM_OWNED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "BatteryType" AS ENUM ('FIXED_SINGLE', 'FIXED_DOUBLE', 'SWAP_IF', 'SWAP_BS', 'SWAP_MOVING', 'SWAP_OTHER');

-- CreateEnum
CREATE TYPE "BatteryStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'CHARGING', 'IN_SWAP', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "BatteryChemistry" AS ENUM ('LFP', 'NMC', 'LTO', 'LEAD_ACID', 'OTHER');

-- CreateEnum
CREATE TYPE "BatterySlot" AS ENUM ('PRIMARY', 'SECONDARY', 'AUXILIARY');

-- CreateEnum
CREATE TYPE "ControllerStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('THIRD_PARTY', 'COMPREHENSIVE', 'OWN_DAMAGE');

-- CreateEnum
CREATE TYPE "FleetDocumentType" AS ENUM ('RC', 'INSURANCE', 'FITNESS_CERTIFICATE', 'PERMIT', 'PUC', 'INVOICE', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "IoTDeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OFFLINE', 'DAMAGED', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "FleetTransferStatus" AS ENUM ('INITIATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "FleetStatus_new" AS ENUM ('IN_TRANSIT', 'AVAILABLE', 'RESERVED', 'ALLOCATION_IN_PROGRESS', 'ALLOCATED', 'IN_USE', 'DEALLOCATION_IN_PROGRESS', 'INSPECTION_PENDING', 'MAINTENANCE', 'OUT_OF_SERVICE');
ALTER TABLE "public"."Fleet" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Fleet" ALTER COLUMN "status" TYPE "FleetStatus_new" USING ("status"::text::"FleetStatus_new");
ALTER TYPE "FleetStatus" RENAME TO "FleetStatus_old";
ALTER TYPE "FleetStatus_new" RENAME TO "FleetStatus";
DROP TYPE "public"."FleetStatus_old";
ALTER TABLE "Fleet" ALTER COLUMN "status" SET DEFAULT 'IN_TRANSIT';
COMMIT;

-- DropForeignKey
ALTER TABLE "Battery" DROP CONSTRAINT "Battery_fleetId_fkey";

-- DropForeignKey
ALTER TABLE "Controller" DROP CONSTRAINT "Controller_fleetId_fkey";

-- DropForeignKey
ALTER TABLE "IoTDevice" DROP CONSTRAINT "IoTDevice_fleetId_fkey";

-- DropIndex
DROP INDEX "Battery_clientId_fleetId_idx";

-- DropIndex
DROP INDEX "Controller_clientId_fleetId_idx";

-- DropIndex
DROP INDEX "Controller_clientId_serialNumber_key";

-- DropIndex
DROP INDEX "Fleet_clientId_insuranceEndDate_idx";

-- DropIndex
DROP INDEX "IoTDevice_fleetId_key";

-- DropIndex
DROP INDEX "VehicleCurrentState_clientId_lastHeartbeat_idx";

-- DropIndex
DROP INDEX "VehicleCurrentState_deviceId_key";

-- AlterTable
ALTER TABLE "Battery" DROP COLUMN "capacityWh",
DROP COLUMN "fleetId",
ADD COLUMN     "ampHour" DECIMAL(8,2),
ADD COLUMN     "batteryCode" VARCHAR(50),
ADD COLUMN     "capacityKwh" DECIMAL(8,3),
ADD COLUMN     "chemistry" "BatteryChemistry",
ADD COLUMN     "currentSoc" INTEGER,
ADD COLUMN     "currentSoh" INTEGER,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "manufacturingDate" DATE,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "model" VARCHAR(100),
ADD COLUMN     "status" "BatteryStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "voltage" DECIMAL(8,2),
ADD COLUMN     "warrantyEndDate" DATE,
ADD COLUMN     "warrantyStartDate" DATE,
ALTER COLUMN "serialNumber" SET DATA TYPE VARCHAR(100),
DROP COLUMN "batteryType",
ADD COLUMN     "batteryType" "BatteryType" NOT NULL,
ALTER COLUMN "manufacturer" SET DATA TYPE VARCHAR(100);

-- AlterTable
ALTER TABLE "Controller" DROP COLUMN "fleetId",
DROP COLUMN "serialNumber",
ADD COLUMN     "controllerNumber" VARCHAR(100) NOT NULL,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "model" VARCHAR(100),
ADD COLUMN     "ratedCurrent" DECIMAL(8,2),
ADD COLUMN     "ratedVoltage" DECIMAL(8,2),
ADD COLUMN     "status" "ControllerStatus" NOT NULL DEFAULT 'AVAILABLE',
ALTER COLUMN "manufacturer" SET DATA TYPE VARCHAR(100);

-- AlterTable
ALTER TABLE "Fleet" DROP COLUMN "fitnessRenewalDate",
DROP COLUMN "insuranceEndDate",
DROP COLUMN "insuranceStartDate",
DROP COLUMN "model",
DROP COLUMN "oem",
DROP COLUMN "operationalDetails",
DROP COLUMN "registrationDate",
DROP COLUMN "vehicleType",
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "allocationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "fleetCode" VARCHAR(50) NOT NULL,
ADD COLUMN     "iotDeviceId" TEXT,
ADD COLUMN     "manufacturingMonth" INTEGER,
ADD COLUMN     "manufacturingYear" INTEGER,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "modelName" VARCHAR(100),
ADD COLUMN     "odometerKm" DECIMAL(12,2),
ADD COLUMN     "oemId" TEXT NOT NULL,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStatus" "FleetOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "ownershipType" "FleetOwnershipType" NOT NULL DEFAULT 'CLIENT_OWNED',
ADD COLUMN     "speedType" "VehicleSpeedType" NOT NULL,
ADD COLUMN     "variantName" VARCHAR(100),
ADD COLUMN     "vehicleCategoryId" TEXT NOT NULL,
ADD COLUMN     "vehicleTypeId" TEXT NOT NULL,
ADD COLUMN     "vinNumber" VARCHAR(100),
ALTER COLUMN "vehicleNumber" DROP NOT NULL,
ALTER COLUMN "vehicleNumber" SET DATA TYPE VARCHAR(30),
ALTER COLUMN "chassisNumber" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "colour" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "motorNumber" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "status" SET DEFAULT 'IN_TRANSIT';

-- AlterTable
ALTER TABLE "IoTDevice" DROP COLUMN "fleetId",
DROP COLUMN "isActive",
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "iccid" VARCHAR(30),
ADD COLUMN     "imei" VARCHAR(30),
ADD COLUMN     "installedAt" TIMESTAMP(3),
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "model" VARCHAR(100),
ADD COLUMN     "provider" VARCHAR(100),
ADD COLUMN     "simNumber" VARCHAR(30),
ADD COLUMN     "status" "IoTDeviceStatus" NOT NULL DEFAULT 'UNASSIGNED',
ALTER COLUMN "deviceNumber" SET DATA TYPE VARCHAR(100);

-- AlterTable
ALTER TABLE "VehicleCurrentState" DROP COLUMN "deviceId",
DROP COLUMN "lastHeartbeat",
DROP COLUMN "lastLocation",
ADD COLUMN     "batterySoc" INTEGER,
ADD COLUMN     "iotDeviceId" TEXT NOT NULL,
ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(10,7),
ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(10,7),
ALTER COLUMN "speedKph" SET DATA TYPE DECIMAL(8,2);

-- CreateTable
CREATE TABLE "FleetRegistration" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "registrationDate" DATE,
    "registeringAuthority" VARCHAR(150),
    "rcExpiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetInsurance" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "providerName" VARCHAR(150),
    "policyNumber" VARCHAR(100),
    "insuranceType" "InsuranceType",
    "startDate" DATE,
    "endDate" DATE,
    "idv" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetFitness" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "certificateNumber" VARCHAR(100),
    "issueDate" DATE,
    "expiryDate" DATE,
    "renewalDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetFitness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDocument" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "type" "FleetDocumentType" NOT NULL,
    "documentNumber" VARCHAR(100),
    "objectKey" VARCHAR(500) NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetBatteryHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "batteryId" TEXT NOT NULL,
    "batterySlot" "BatterySlot" NOT NULL DEFAULT 'PRIMARY',
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "installedOdometerKm" DECIMAL(12,2),
    "removedOdometerKm" DECIMAL(12,2),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetBatteryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetControllerHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetControllerHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetStatusHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromStatus" "FleetStatus",
    "toStatus" "FleetStatus" NOT NULL,
    "changedByUserId" TEXT,
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetTransfer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromHubId" TEXT,
    "toHubId" TEXT NOT NULL,
    "status" "FleetTransferStatus" NOT NULL DEFAULT 'INITIATED',
    "initiatedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FleetRegistration_fleetId_key" ON "FleetRegistration"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInsurance_fleetId_key" ON "FleetInsurance"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetFitness_fleetId_key" ON "FleetFitness"("fleetId");

-- CreateIndex
CREATE INDEX "FleetDocument_fleetId_type_idx" ON "FleetDocument"("fleetId", "type");

-- CreateIndex
CREATE INDEX "FleetDocument_expiresAt_idx" ON "FleetDocument"("expiresAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_installedAt_idx" ON "FleetBatteryHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_batteryId_installedAt_idx" ON "FleetBatteryHistory"("batteryId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_batterySlot_removedAt_idx" ON "FleetBatteryHistory"("fleetId", "batterySlot", "removedAt");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_fleetId_installedAt_idx" ON "FleetControllerHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_controllerId_installedAt_idx" ON "FleetControllerHistory"("controllerId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetStatusHistory_fleetId_createdAt_idx" ON "FleetStatusHistory"("fleetId", "createdAt");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fleetId_idx" ON "FleetTransfer"("clientId", "fleetId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fromHubId_idx" ON "FleetTransfer"("clientId", "fromHubId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_toHubId_idx" ON "FleetTransfer"("clientId", "toHubId");

-- CreateIndex
CREATE INDEX "Battery_clientId_status_idx" ON "Battery"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_batteryCode_key" ON "Battery"("clientId", "batteryCode");

-- CreateIndex
CREATE INDEX "Controller_clientId_status_idx" ON "Controller"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_clientId_controllerNumber_key" ON "Controller"("clientId", "controllerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_iotDeviceId_key" ON "Fleet"("iotDeviceId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_oemId_idx" ON "Fleet"("clientId", "oemId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleCategoryId_idx" ON "Fleet"("clientId", "vehicleCategoryId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleTypeId_idx" ON "Fleet"("clientId", "vehicleTypeId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_speedType_idx" ON "Fleet"("clientId", "speedType");

-- CreateIndex
CREATE INDEX "Fleet_clientId_onboardingStatus_idx" ON "Fleet"("clientId", "onboardingStatus");

-- CreateIndex
CREATE INDEX "Fleet_clientId_allocationEnabled_idx" ON "Fleet"("clientId", "allocationEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_fleetCode_key" ON "Fleet"("clientId", "fleetCode");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vinNumber_key" ON "Fleet"("clientId", "vinNumber");

-- CreateIndex
CREATE INDEX "IoTDevice_clientId_status_idx" ON "IoTDevice"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_iotDeviceId_key" ON "VehicleCurrentState"("iotDeviceId");

-- CreateIndex
CREATE INDEX "VehicleCurrentState_clientId_lastHeartbeatAt_idx" ON "VehicleCurrentState"("clientId", "lastHeartbeatAt");

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_oemId_fkey" FOREIGN KEY ("oemId") REFERENCES "Oem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetRegistration" ADD CONSTRAINT "FleetRegistration_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetInsurance" ADD CONSTRAINT "FleetInsurance_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetFitness" ADD CONSTRAINT "FleetFitness_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDocument" ADD CONSTRAINT "FleetDocument_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IoTDevice" ADD CONSTRAINT "IoTDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "Battery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Controller" ADD CONSTRAINT "Controller_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetStatusHistory" ADD CONSTRAINT "FleetStatusHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fromHubId_fkey" FOREIGN KEY ("fromHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_toHubId_fkey" FOREIGN KEY ("toHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ClientOperationsVehicleCategory_operationsProfileId_vehicleCate" RENAME TO "ClientOperationsVehicleCategory_operationsProfileId_vehicle_key";
