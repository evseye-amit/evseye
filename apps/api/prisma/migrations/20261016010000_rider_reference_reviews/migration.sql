-- CreateEnum
CREATE TYPE "RiderReferenceReviewStatus" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RiderReferenceReview" (
    "id" VARCHAR(64) NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerKey" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "relation" VARCHAR(80) NOT NULL,
    "status" "RiderReferenceReviewStatus" NOT NULL,
    "rejectionReason" VARCHAR(1000),
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderReferenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderReferenceReview_clientId_ownerKey_idx" ON "RiderReferenceReview"("clientId", "ownerKey");

-- AddForeignKey
ALTER TABLE "RiderReferenceReview" ADD CONSTRAINT "RiderReferenceReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderReferenceReview" ADD CONSTRAINT "RiderReferenceReview_clientId_reviewedById_fkey" FOREIGN KEY ("clientId", "reviewedById") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A rejected reference must always explain the decision, including direct SQL writes.
ALTER TABLE "RiderReferenceReview" ADD CONSTRAINT "RiderReferenceReview_rejection_reason_check"
CHECK (("status" = 'REJECTED' AND "rejectionReason" IS NOT NULL AND "rejectionReason" ~ '[^[:space:]]')
    OR ("status" = 'APPROVED' AND "rejectionReason" IS NULL));
