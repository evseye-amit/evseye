CREATE TABLE "SmsProviderPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "primaryProvider" TEXT NOT NULL,
  "fallbackProvider" TEXT,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "SmsProviderPolicy_pkey" PRIMARY KEY ("id")
);
