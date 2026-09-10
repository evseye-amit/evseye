-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PRE_ALLOCATION', 'POST_DEALLOCATION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'INITIATED',
    "allocatedAt" TIMESTAMP(3),
    "deallocatedAt" TIMESTAMP(3),
    "initiatedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "checklist" JSONB,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Allocation_tenantId_fleetId_status_idx" ON "Allocation"("tenantId", "fleetId", "status");

-- CreateIndex
CREATE INDEX "Allocation_tenantId_riderId_status_idx" ON "Allocation"("tenantId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_tenantId_idempotencyKey_key" ON "Allocation"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_status_idx" ON "Inspection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_allocationId_type_key" ON "Inspection"("allocationId", "type");

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
