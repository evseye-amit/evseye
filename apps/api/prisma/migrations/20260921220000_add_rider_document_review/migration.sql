ALTER TYPE "PhotoEntityType" ADD VALUE IF NOT EXISTS 'RIDER_ONBOARDING';

CREATE TYPE "RiderDocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "RiderOnboardingDocument" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "riderId" TEXT,
  "featureId" TEXT NOT NULL,
  "fieldCode" TEXT NOT NULL,
  "photoId" TEXT NOT NULL,
  "status" "RiderDocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiderOnboardingDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiderOnboardingDocument_photoId_key" ON "RiderOnboardingDocument"("photoId");
CREATE INDEX "RiderOnboardingDocument_clientId_userId_fieldCode_status_idx" ON "RiderOnboardingDocument"("clientId", "userId", "fieldCode", "status");
CREATE INDEX "RiderOnboardingDocument_clientId_riderId_status_idx" ON "RiderOnboardingDocument"("clientId", "riderId", "status");
CREATE INDEX "RiderOnboardingDocument_clientId_status_createdAt_idx" ON "RiderOnboardingDocument"("clientId", "status", "createdAt");

ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
