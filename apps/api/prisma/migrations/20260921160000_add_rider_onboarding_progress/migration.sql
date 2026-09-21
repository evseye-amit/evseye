CREATE TABLE "RiderOnboardingProgress" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "currentStepId" TEXT,
  "completedStepIds" JSONB NOT NULL DEFAULT '[]',
  "skippedStepIds" JSONB NOT NULL DEFAULT '[]',
  "values" JSONB NOT NULL DEFAULT '{}',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiderOnboardingProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderOnboardingProgress_userId_key" ON "RiderOnboardingProgress"("userId");
CREATE INDEX "RiderOnboardingProgress_clientId_packageId_idx" ON "RiderOnboardingProgress"("clientId", "packageId");
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
