CREATE TABLE "KycVerificationOutbox" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycVerificationOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycVerificationOutbox_verificationId_key" ON "KycVerificationOutbox"("verificationId");
CREATE INDEX "KycVerificationOutbox_status_availableAt_idx" ON "KycVerificationOutbox"("status", "availableAt");
CREATE INDEX "KycVerificationOutbox_clientId_status_createdAt_idx" ON "KycVerificationOutbox"("clientId", "status", "createdAt");
ALTER TABLE "KycVerificationOutbox" ADD CONSTRAINT "KycVerificationOutbox_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
