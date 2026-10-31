CREATE TABLE "ClientOnboardingRejection" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "submissionId" TEXT,
  "section" VARCHAR(60) NOT NULL,
  "reasonCode" VARCHAR(80) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "blocking" BOOLEAN NOT NULL DEFAULT true,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientOnboardingRejection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientOnboardingRejection_clientId_resolvedAt_blocking_idx" ON "ClientOnboardingRejection"("clientId", "resolvedAt", "blocking");
CREATE INDEX "ClientOnboardingRejection_clientId_createdAt_idx" ON "ClientOnboardingRejection"("clientId", "createdAt");
ALTER TABLE "ClientOnboardingRejection" ADD CONSTRAINT "ClientOnboardingRejection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
