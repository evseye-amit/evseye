-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'DEALLOCATION_RIDER', 'DEALLOCATION_OPERATOR', 'PHONE_VERIFICATION');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "purpose" "OtpPurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "context" JSONB,
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpRequest_phone_purpose_createdAt_idx" ON "OtpRequest"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_tenantId_status_idx" ON "OtpRequest"("tenantId", "status");
