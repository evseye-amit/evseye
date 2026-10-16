-- CreateEnum
CREATE TYPE "KycVerificationType" AS ENUM ('PAN_VERIFICATION', 'AADHAAR_OTP', 'AADHAAR_OKYC', 'BANK_ACCOUNT_VERIFICATION', 'IFSC_VERIFICATION', 'PAN_AADHAAR_LINK', 'DIGILOCKER', 'NAME_MATCH', 'FACE_MATCH', 'LIVENESS');

-- CreateEnum
CREATE TYPE "KycVerificationStatus" AS ENUM ('CREATED', 'QUEUED', 'PROCESSING', 'ACTION_REQUIRED', 'OTP_REQUIRED', 'VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "KycProviderCode" AS ENUM ('SANDBOX', 'CASHFREE', 'SUREPASS', 'HYPERVERGE');

-- CreateEnum
CREATE TYPE "KycProviderEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "KycFailureType" AS ENUM ('BUSINESS_FAILURE', 'TECHNICAL_FAILURE');

-- CreateTable
CREATE TABLE "KycProviderConfig" (
    "id" TEXT NOT NULL,
    "code" "KycProviderCode" NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "environment" "KycProviderEnvironment" NOT NULL DEFAULT 'TEST',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderCapability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "isSupported" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxRetries" INTEGER NOT NULL DEFAULT 0,
    "costPerRequest" DECIMAL(12,4),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT,
    "environment" "KycProviderEnvironment" NOT NULL,
    "secretReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "providerId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'CREATED',
    "inputFingerprint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "consentId" TEXT,
    "finalProviderId" TEXT,
    "finalAttemptId" TEXT,
    "resultCode" TEXT,
    "resultSummary" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerificationAttempt" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "requestStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseReceivedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "providerStatus" TEXT,
    "normalizedStatus" "KycVerificationStatus" NOT NULL DEFAULT 'PROCESSING',
    "failureType" "KycFailureType",
    "failureCategory" TEXT,
    "failureCode" TEXT,
    "cost" DECIMAL(12,4),
    "currency" TEXT,
    "billable" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerificationResult" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL,
    "matchStatus" TEXT,
    "normalizedData" JSONB NOT NULL,
    "providerReference" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderConfig_code_key" ON "KycProviderConfig"("code");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderCapability_providerId_verificationType_key" ON "KycProviderCapability"("providerId", "verificationType");

-- CreateIndex
CREATE INDEX "KycProviderCredential_providerId_clientId_environment_idx" ON "KycProviderCredential"("providerId", "clientId", "environment");

-- CreateIndex
CREATE INDEX "KycConsent_clientId_riderId_verificationType_acceptedAt_idx" ON "KycConsent"("clientId", "riderId", "verificationType", "acceptedAt");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_riderId_verificationType_idx" ON "KycVerification"("clientId", "riderId", "verificationType");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_verificationType_status_idx" ON "KycVerification"("clientId", "verificationType", "status");

-- CreateIndex
CREATE INDEX "KycVerification_createdAt_idx" ON "KycVerification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_clientId_idempotencyKey_key" ON "KycVerification"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "KycVerificationAttempt_providerId_requestStartedAt_idx" ON "KycVerificationAttempt"("providerId", "requestStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerificationAttempt_verificationId_attemptNumber_key" ON "KycVerificationAttempt"("verificationId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerificationResult_attemptId_key" ON "KycVerificationResult"("attemptId");

-- CreateIndex
CREATE INDEX "KycVerificationResult_verificationId_createdAt_idx" ON "KycVerificationResult"("verificationId", "createdAt");

-- AddForeignKey
ALTER TABLE "KycProviderCapability" ADD CONSTRAINT "KycProviderCapability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderCredential" ADD CONSTRAINT "KycProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderCredential" ADD CONSTRAINT "KycProviderCredential_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "KycConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_finalProviderId_fkey" FOREIGN KEY ("finalProviderId") REFERENCES "KycProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationResult" ADD CONSTRAINT "KycVerificationResult_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationResult" ADD CONSTRAINT "KycVerificationResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "KycVerificationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
