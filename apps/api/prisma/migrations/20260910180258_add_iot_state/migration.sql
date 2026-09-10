-- CreateEnum
CREATE TYPE "IoTEventType" AS ENUM ('LOCATION', 'HEARTBEAT', 'START', 'STOP');

-- CreateTable
CREATE TABLE "IoTDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IoTDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCurrentState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "speedKph" DECIMAL(6,2),
    "ignition" BOOLEAN,
    "lastHeartbeat" TIMESTAMP(3),
    "lastLocation" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCurrentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "IoTEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_fleetId_key" ON "IoTDevice"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_tenantId_deviceNumber_key" ON "IoTDevice"("tenantId", "deviceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_fleetId_key" ON "VehicleCurrentState"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_deviceId_key" ON "VehicleCurrentState"("deviceId");

-- CreateIndex
CREATE INDEX "VehicleCurrentState_tenantId_lastHeartbeat_idx" ON "VehicleCurrentState"("tenantId", "lastHeartbeat");

-- CreateIndex
CREATE INDEX "TelemetryEvent_tenantId_fleetId_occurredAt_idx" ON "TelemetryEvent"("tenantId", "fleetId", "occurredAt");

-- AddForeignKey
ALTER TABLE "IoTDevice" ADD CONSTRAINT "IoTDevice_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
