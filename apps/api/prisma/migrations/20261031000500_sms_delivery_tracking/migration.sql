CREATE TABLE "SmsDelivery" (
  "id" TEXT NOT NULL,
  "otpRequestId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmsDelivery_otpRequestId_fkey" FOREIGN KEY ("otpRequestId") REFERENCES "OtpRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmsDelivery_otpRequestId_createdAt_idx" ON "SmsDelivery"("otpRequestId", "createdAt");
CREATE INDEX "SmsDelivery_provider_status_createdAt_idx" ON "SmsDelivery"("provider", "status", "createdAt");
