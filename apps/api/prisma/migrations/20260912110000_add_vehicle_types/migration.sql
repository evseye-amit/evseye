CREATE TYPE "EnergyType" AS ENUM ('ELECTRIC', 'HYBRID', 'PETROL', 'DIESEL', 'CNG', 'HYDROGEN', 'OTHER', 'LPG');
CREATE TYPE "VehicleUsageType" AS ENUM ('PRIVATE', 'PASSENGER', 'GOODS', 'DELIVERY', 'SHARED_MOBILITY', 'PUBLIC_TRANSPORT', 'STAFF_TRANSPORT', 'SCHOOL_TRANSPORT', 'EMERGENCY', 'AGRICULTURAL', 'CONSTRUCTION', 'INDUSTRIAL', 'RENTAL', 'GOVERNMENT', 'SPECIAL_PURPOSE');

CREATE TABLE "VehicleType" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subCategory" TEXT,
  "description" TEXT,
  "energyType" "EnergyType" NOT NULL,
  "usageType" "VehicleUsageType",
  "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleType_code_key" ON "VehicleType"("code");
CREATE INDEX "VehicleType_categoryId_status_name_idx" ON "VehicleType"("categoryId", "status", "name");
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
