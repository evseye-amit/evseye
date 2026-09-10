-- CreateEnum
CREATE TYPE "KycType" AS ENUM ('AADHAAR', 'PAN', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'RETRY_REQUIRED');

-- CreateTable
CREATE TABLE "RiderKyc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "KycType" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT,
    "providerReference" TEXT,
    "maskedData" JSONB,
    "safeFailureCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderKyc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderKyc_tenantId_status_idx" ON "RiderKyc"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RiderKyc_provider_providerReference_idx" ON "RiderKyc"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "RiderKyc_riderId_type_key" ON "RiderKyc"("riderId", "type");

-- AddForeignKey
ALTER TABLE "RiderKyc" ADD CONSTRAINT "RiderKyc_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
