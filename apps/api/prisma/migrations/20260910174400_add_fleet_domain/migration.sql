-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ALLOCATION_IN_PROGRESS', 'ALLOCATED', 'IN_USE', 'DEALLOCATION_IN_PROGRESS', 'INSPECTION_PENDING', 'MAINTENANCE', 'OUT_OF_SERVICE', 'OFFLINE');

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hubId" TEXT,
    "vehicleNumber" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "oem" TEXT,
    "model" TEXT,
    "colour" TEXT,
    "vehicleType" TEXT,
    "motorNumber" TEXT,
    "registrationDate" TIMESTAMP(3),
    "insuranceStartDate" TIMESTAMP(3),
    "insuranceEndDate" TIMESTAMP(3),
    "fitnessRenewalDate" TIMESTAMP(3),
    "status" "FleetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "operationalDetails" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Battery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "batteryType" TEXT,
    "capacityWh" INTEGER,
    "manufacturer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Controller" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Controller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Zone_tenantId_code_key" ON "Zone"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Hub_tenantId_zoneId_idx" ON "Hub"("tenantId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_tenantId_code_key" ON "Hub"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Fleet_tenantId_status_idx" ON "Fleet"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Fleet_tenantId_hubId_idx" ON "Fleet"("tenantId", "hubId");

-- CreateIndex
CREATE INDEX "Fleet_tenantId_insuranceEndDate_idx" ON "Fleet"("tenantId", "insuranceEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_tenantId_vehicleNumber_key" ON "Fleet"("tenantId", "vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_tenantId_chassisNumber_key" ON "Fleet"("tenantId", "chassisNumber");

-- CreateIndex
CREATE INDEX "Battery_tenantId_fleetId_idx" ON "Battery"("tenantId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_tenantId_serialNumber_key" ON "Battery"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "Controller_tenantId_fleetId_idx" ON "Controller"("tenantId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_tenantId_serialNumber_key" ON "Controller"("tenantId", "serialNumber");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Controller" ADD CONSTRAINT "Controller_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
